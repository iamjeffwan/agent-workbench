import type {
  TimelineEvidenceRef,
  TimelineNode,
  TimelineRoot,
} from './build-timeline.js';

export type ValidationCheckKind = 'command' | 'test' | 'build' | 'lint' | 'playwright' | 'artifact';

export type ValidationCheck = {
  id: string;
  label: string;
  kind: ValidationCheckKind;
  required?: boolean;
};

export type ValidationProfile = {
  id: string;
  checks: ValidationCheck[];
};

export type ValidationCheckResult = {
  id: string;
  label?: string;
  command?: string;
  result?: string;
  kind?: ValidationCheckKind;
  status: 'passed' | 'failed' | 'incomplete' | 'not_run' | 'unknown';
  summary?: string;
  durationMs?: number | null;
  artifacts?: Array<{
    path: string;
    kind: 'screenshot' | 'trace' | 'video' | 'report' | 'other';
  }>;
};

export type ValidationResult = {
  version: 1;
  profileId: string;
  status: 'passed' | 'failed' | 'incomplete' | 'unknown';
  checks: ValidationCheckResult[];
  generatedAt?: string;
  sessionId?: string;
  generationId?: string;
};

export type ReviewFinding = {
  id: string;
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  title: string;
  summary: string;
  status: 'open';
  eventIds: string[];
  evidenceIds: string[];
  expected?: string;
  actual?: string;
};

export type ResultReview = {
  status: 'passed' | 'failed' | 'incomplete' | 'unknown';
  profileId: string | null;
  checkedEventCount: number;
  checkedEventIds: string[];
  checks: ValidationCheckResult[];
  evidence: TimelineEvidenceRef[];
  findings: ReviewFinding[];
};

export type ResultReviewOptions = {
  profile?: ValidationProfile | null;
  results?: ValidationResult | null;
};

/**
 * Review only observable result evidence. This deliberately does not infer
 * correctness from assistant prose or call an external model.
 */
export function reviewTimelineResults(
  roots: TimelineRoot[],
  options: ResultReviewOptions = {},
): ResultReview {
  const nodes = roots.flatMap(collectNodes);
  const findings: ReviewFinding[] = [];
  const validationNodes = nodes.filter(isValidationNode);
  const profile = options.profile;
  const result = options.results;

  for (const node of validationNodes) {
    if (validationStatusForNode(node) !== 'failed') continue;
    const evidenceIds = evidenceIdsFor(node);
    findings.push({
      id: `review:${node.id}:failed`,
      ruleId: ruleForNode(node),
      severity: 'error',
      title: `${node.name || 'Validation'} failed`,
      summary: node.error ? String(node.error) : 'The validation event reported a failure.',
      status: 'open',
      eventIds: [node.id],
      evidenceIds,
      actual: 'failed',
    });
  }

  if (result) {
    for (const check of result.checks) {
      if (check.status !== 'failed') continue;
      const profileCheck = profile?.checks.find(item => item.id === check.id);
      const label = check.label || profileCheck?.label || check.id;
      findings.push({
        id: `review:validation:${check.id}:failed`,
        ruleId: (check.kind || profileCheck?.kind) === 'playwright'
          ? 'playwright-assertion-failed'
          : 'validation-check-failed',
        severity: 'error',
        title: `${label} failed`,
        summary: check.summary || 'The structured validation result reported a failure.',
        status: 'open',
        eventIds: [],
        evidenceIds: evidenceIdsForValidationCheck(check),
        actual: 'failed',
      });
    }
  }

  if (profile && !result) {
    const required = profile.checks.filter(check => check.required !== false);
    if (required.length > 0) {
      findings.push({
        id: `review:${profile.id}:not-run`,
        ruleId: 'verification-not-run',
        severity: 'warning',
        title: 'Required verification was not run',
        summary: `No structured result was recorded for validation profile ${profile.id}.`,
        status: 'open',
        eventIds: [],
        evidenceIds: [],
        expected: required.map(check => check.label).join(', '),
        actual: 'not_run',
      });
    }
  }

  if (result && profile) {
    const resultById = new Map(result.checks.map(check => [check.id, check]));
    for (const check of profile.checks.filter(item => item.required !== false)) {
      const recorded = resultById.get(check.id);
      if (recorded && recorded.status === 'passed') continue;
      if (findings.some(finding => finding.id === `review:validation:${check.id}:failed`)) continue;
      findings.push({
        id: `review:validation:${check.id}:incomplete`,
        ruleId: 'verification-incomplete',
        severity: 'warning',
        title: `${check.label} was not verified`,
        summary: recorded?.summary || 'The required validation check did not produce a passing result.',
        status: 'open',
        eventIds: [],
        evidenceIds: [],
        expected: 'passed',
        actual: recorded?.status || 'not_run',
      });
    }
  }

  if (result && !profile) {
    for (const check of result.checks) {
      if (check.status === 'passed' || check.status === 'failed') continue;
      findings.push({
        id: `review:validation:${check.id}:incomplete`,
        ruleId: 'verification-incomplete',
        severity: 'warning',
        title: `${check.label || check.id} was not verified`,
        summary: check.summary || 'The structured validation result is incomplete.',
        status: 'open',
        eventIds: [],
        evidenceIds: evidenceIdsForValidationCheck(check),
        expected: 'passed',
        actual: check.status,
      });
    }
  }

  if (!profile && !result && validationNodes.length === 0 && nodes.length > 0) {
    findings.push({
      id: 'review:verification:missing',
      ruleId: 'verification-missing',
      severity: 'info',
      title: 'No verification evidence',
      summary: 'The observed task has no test, build, or structured validation result.',
      status: 'open',
      eventIds: [],
      evidenceIds: [],
      actual: 'unknown',
    });
  }

  const checks = [
    ...validationNodes.map(validationCheckForNode),
    ...(result?.checks ?? []),
  ];
  const evidence = uniqueEvidence([
    ...validationNodes.flatMap(node => node.evidenceRefs ?? []),
    ...(result?.checks ?? []).flatMap(validationEvidenceForCheck),
  ]);
  const status = findings.some(finding => finding.severity === 'error') || result?.status === 'failed'
    ? 'failed'
    : findings.some(finding => finding.ruleId === 'verification-not-run' || finding.ruleId === 'verification-incomplete')
      ? 'incomplete'
    : findings.some(finding => finding.ruleId === 'verification-missing')
      ? 'unknown'
        : result?.status === 'incomplete'
          ? 'incomplete'
          : result?.status === 'unknown'
            ? 'unknown'
            : 'passed';

  return {
    status,
    profileId: profile?.id ?? result?.profileId ?? null,
    checkedEventCount: checks.length,
    checkedEventIds: validationNodes.map(node => node.id),
    checks,
    evidence,
    findings,
  };
}

function collectNodes(root: TimelineRoot | TimelineNode): TimelineNode[] {
  return [root, ...(root.children ?? []).flatMap(collectNodes)];
}

function isValidationNode(node: TimelineNode): boolean {
  return node.eventKind === 'test_result' || ['TEST', 'BUILD', 'LINT'].includes(String(node.method));
}

function ruleForNode(node: TimelineNode): string {
  if (node.method === 'BUILD') return 'build-failed';
  if (node.method === 'LINT') return 'lint-failed';
  return 'test-failed';
}

function validationCheckForNode(node: TimelineNode): ValidationCheckResult {
  return {
    id: node.id,
    label: node.name || 'Validation event',
    command: commandForNode(node),
    result: resultForNode(node),
    kind: validationKindForNode(node),
    status: validationStatusForNode(node),
    summary: node.error ? String(node.error) : undefined,
    durationMs: typeof node.durationMs === 'number' ? node.durationMs : null,
  };
}

function commandForNode(node: TimelineNode): string | undefined {
  const argumentsValue = node.arguments;
  if (typeof argumentsValue === 'string' && argumentsValue.trim()) return argumentsValue.trim();
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) return undefined;
  const argumentsRecord = argumentsValue as Record<string, unknown>;
  for (const key of ['command', 'cmd']) {
    const command = argumentsRecord[key];
    if (typeof command === 'string' && command.trim()) return command.trim();
  }
  return undefined;
}

function resultForNode(node: TimelineNode): string | undefined {
  if (node.error != null) return String(node.error);
  if (typeof node.output === 'string' && node.output.trim()) return node.output.trim();
  if (node.output !== undefined && node.output !== null) {
    try {
      return JSON.stringify(node.output, null, 2) ?? String(node.output);
    } catch {
      return String(node.output);
    }
  }
  const status = validationStatusForNode(node);
  if (status === 'passed') return 'Completed successfully.';
  if (status === 'failed') return 'The command failed.';
  if (status === 'incomplete') return 'The command did not finish.';
  return 'The command result is unknown.';
}

function validationKindForNode(node: TimelineNode): ValidationCheckKind {
  if (node.method === 'BUILD') return 'build';
  if (node.method === 'LINT') return 'lint';
  if (node.eventKind === 'command') return 'command';
  return 'test';
}

function validationStatusForNode(node: TimelineNode): ValidationCheckResult['status'] {
  const status = `${node.status ?? ''}`.toLowerCase();
  if (node.failed || node.error != null || status === 'error' || status === 'failed') {
    return 'failed';
  }
  if (status === 'pending' || status === 'running') return 'incomplete';
  if (status === 'completed' || status === 'passed' || status === 'success') return 'passed';
  return 'unknown';
}

function evidenceIdsFor(node: TimelineNode): string[] {
  return (node.evidenceRefs ?? []).map((evidence: TimelineEvidenceRef) => evidence.id);
}

function evidenceIdsForValidationCheck(check: ValidationCheckResult): string[] {
  return [
    `evidence:validation:${check.id}`,
    ...(check.artifacts ?? []).map(artifact => `artifact:validation:${check.id}:${artifact.path}`),
  ];
}

function validationEvidenceForCheck(check: ValidationCheckResult): TimelineEvidenceRef[] {
  return [
    {
      id: `evidence:validation:${check.id}`,
      kind: check.kind === 'test' ? 'test_result' : 'validation_result',
      summary: check.summary || `${check.label || check.id} validation result`,
      data: {
        status: check.status,
        durationMs: check.durationMs ?? null,
      },
    },
    ...(check.artifacts ?? []).map(artifact => ({
      id: `artifact:validation:${check.id}:${artifact.path}`,
      kind: 'artifact' as const,
      summary: `${artifact.kind} artifact: ${artifact.path}`,
      source: { path: artifact.path },
    })),
  ];
}

function uniqueEvidence(evidence: TimelineEvidenceRef[]): TimelineEvidenceRef[] {
  const seen = new Set<string>();
  return evidence.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
