import { createHash, randomUUID } from 'node:crypto';

import { redactCredentialText } from '@agent-workbench/security';
import type { RawRef } from '@agent-workbench/observation-schema';
import type { ReviewEvidencePackage } from './evidence.js';
import type {
  Evidence,
  EvidenceTargetType,
  ModelJudgement,
  ModelUsage,
  ReviewCase,
  ReviewCategory,
  ReviewRunResult,
  ReviewSeverity,
  ReviewStore,
  Reviewability,
} from './types.js';
import { assertReviewEvidencePackage } from './validate.js';

export const DEFAULT_REVIEW_SYSTEM_PROMPT = `You are an evidence-bound reviewer. Review only the supplied evidence package. Do not infer facts that are not supported by a cited target. Every judgement must include at least one evidence item. Use reviewability to mark conclusions that need raw logs or project context. Return only the requested structured output.`;

export type ReviewModelDescriptor = {
  provider: string;
  model: string;
  modelVersion?: string;
  transport: string;
};

export type ReviewModelEvidence = {
  evidenceType: string;
  targetType: EvidenceTargetType;
  targetId: string;
  description: string;
  cachedExcerpt: string;
  contentHash: string;
};

export type ReviewModelJudgement = {
  category: ReviewCategory;
  title: string;
  summary: string;
  severity: ReviewSeverity;
  confidence: number;
  impact: string;
  alternativeExplanation: string;
  recommendation: string;
  reviewability: Reviewability;
  issueFingerprint: string;
  evidence: ReviewModelEvidence[];
};

export type ReviewModelOutput = {
  judgements: ReviewModelJudgement[];
};

export type ReviewModelRequest = {
  runId: string;
  reviewCase: ReviewCase;
  evidencePackage: ReviewEvidencePackage;
  systemPrompt: string;
  outputSchema: Record<string, unknown>;
};

export type ReviewModelResponse = {
  output: unknown;
  usage?: ModelUsage;
  actualCost?: number;
};

export type ReviewModelAdapter = {
  descriptor: ReviewModelDescriptor;
  review(request: ReviewModelRequest): Promise<ReviewModelResponse>;
};

export type ExecuteReviewInput = {
  reviewCase: ReviewCase;
  evidencePackage: ReviewEvidencePackage;
  promptVersion: string;
  reviewPolicyVersion: string;
  systemPrompt?: string;
};

export type ReviewExecutor = {
  execute(input: ExecuteReviewInput): Promise<ReviewRunResult>;
};

export type ReviewExecutorOptions = {
  store: ReviewStore;
  adapter: ReviewModelAdapter;
  readRawReference?: (rawRef: RawRef) => Promise<string | undefined> | string | undefined;
  now?: () => Date;
  createId?: (kind: 'run' | 'judgement' | 'evidence') => string;
};

export function createReviewExecutor(options: ReviewExecutorOptions): ReviewExecutor {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? ((kind: string) => `${kind}_${randomUUID()}`);

  return {
    async execute(input) {
      assertReviewEvidencePackage(input.evidencePackage);
      assertMatchingInput(input);
      const runId = createId('run');
      const startedAt = now();
      const invocation = {
        provider: options.adapter.descriptor.provider,
        model: options.adapter.descriptor.model,
        ...(options.adapter.descriptor.modelVersion
          ? { modelVersion: options.adapter.descriptor.modelVersion }
          : {}),
        promptVersion: input.promptVersion,
        reviewPolicyVersion: input.reviewPolicyVersion,
        evidenceSchemaVersion: input.evidencePackage.evidenceSchemaVersion,
      };
      options.store.recordRun({
        run: {
          runId,
          caseId: input.reviewCase.caseId,
          invocation,
          startedAt: startedAt.toISOString(),
          status: 'running',
        },
        judgements: [],
        evidence: [],
      });

      try {
        if (input.evidencePackage.reviewability === 'insufficient') {
          throw new Error('The evidence package is insufficient for model review.');
        }
        const baseSystemPrompt = input.systemPrompt ?? DEFAULT_REVIEW_SYSTEM_PROMPT;
        const rawReferenceInstruction = options.readRawReference
          ? 'Exact raw record content is available to the executor. Cite raw_ref only when the selected source line supports the judgement.'
          : 'Exact raw record content is unavailable to the executor. Do not cite raw_ref; use needs_raw when a judgement requires the original record.';
        const response = await options.adapter.review({
          runId,
          reviewCase: structuredClone(input.reviewCase),
          evidencePackage: structuredClone(input.evidencePackage),
          systemPrompt: `${baseSystemPrompt}\n\n${rawReferenceInstruction}`,
          outputSchema: structuredClone(REVIEW_MODEL_OUTPUT_SCHEMA),
        });
        const output = assertReviewModelOutput(response.output);
        const evidenceTargets = await assertEvidenceTargets(
          output,
          input.evidencePackage,
          options.readRawReference,
        );
        const completedAt = now();
        const result = materializeResult(
          output,
          runId,
          input.reviewCase.caseId,
          invocation,
          startedAt,
          completedAt,
          response,
          createId,
          evidenceTargets,
        );
        options.store.recordRun(result);
        return structuredClone(result);
      } catch (error) {
        const completedAt = now();
        const result: ReviewRunResult = {
          run: {
            runId,
            caseId: input.reviewCase.caseId,
            invocation,
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            status: 'failed',
            latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
            failureReason: errorMessage(error),
          },
          judgements: [],
          evidence: [],
        };
        options.store.recordRun(result);
        return structuredClone(result);
      }
    },
  };
}

export function assertReviewModelOutput(value: unknown): ReviewModelOutput {
  if (!isRecord(value) || !Array.isArray(value.judgements)) invalidOutput('judgements must be an array');
  const output = value as { judgements: unknown[] };
  output.judgements.forEach((judgement, index) => assertJudgement(judgement, index));
  return structuredClone(value) as ReviewModelOutput;
}

export const REVIEW_MODEL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['judgements'],
  properties: {
    judgements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'title', 'summary', 'severity', 'confidence', 'impact', 'alternativeExplanation', 'recommendation', 'reviewability', 'issueFingerprint', 'evidence'],
        properties: {
          category: { type: 'string', enum: ['process_efficiency', 'tool_usage', 'repeated_failure', 'architecture', 'maintainability', 'performance', 'security', 'testability'] },
          title: { type: 'string', minLength: 1 },
          summary: { type: 'string', minLength: 1 },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          impact: { type: 'string', minLength: 1 },
          alternativeExplanation: { type: 'string', minLength: 1 },
          recommendation: { type: 'string', minLength: 1 },
          reviewability: { type: 'string', enum: ['sufficient', 'insufficient', 'needs_raw', 'needs_project_context'] },
          issueFingerprint: { type: 'string' },
          evidence: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['evidenceType', 'targetType', 'targetId', 'description', 'cachedExcerpt', 'contentHash'],
              properties: {
                evidenceType: { type: 'string', minLength: 1 },
                targetType: { type: 'string', enum: ['event', 'turn_diff', 'project_profile', 'environment_snapshot', 'environment_delta', 'project_diff', 'raw_ref', 'project_file'] },
                targetId: { type: 'string', minLength: 1 },
                description: { type: 'string', minLength: 1 },
                cachedExcerpt: { type: 'string' },
                contentHash: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

function materializeResult(
  output: ReviewModelOutput,
  runId: string,
  caseId: string,
  invocation: ReviewRunResult['run']['invocation'],
  startedAt: Date,
  completedAt: Date,
  response: ReviewModelResponse,
  createId: (kind: 'run' | 'judgement' | 'evidence') => string,
  evidenceTargets: EvidenceTargetIndex,
): ReviewRunResult {
  const evidence: Evidence[] = [];
  const judgements: ModelJudgement[] = output.judgements.map(item => {
    const judgementId = createId('judgement');
    evidence.push(...item.evidence.map(source => {
      const target = requiredEvidenceTarget(evidenceTargets, source);
      return {
        evidenceId: createId('evidence'),
        judgementId,
        evidenceType: source.evidenceType,
        targetType: source.targetType,
        targetId: source.targetId,
        description: source.description,
        cachedExcerpt: target.excerpt,
        contentHash: target.contentHash,
      };
    }));
    return {
      judgementId,
      runId,
      category: item.category,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      confidence: item.confidence,
      impact: item.impact,
      alternativeExplanation: item.alternativeExplanation,
      recommendation: item.recommendation,
      reviewability: item.reviewability,
      ...(item.issueFingerprint ? { issueFingerprint: item.issueFingerprint } : {}),
      createdAt: completedAt.toISOString(),
    };
  });
  return {
    run: {
      runId,
      caseId,
      invocation,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      status: 'completed',
      ...(response.usage ? { usage: response.usage } : {}),
      ...(response.actualCost !== undefined ? { actualCost: response.actualCost } : {}),
      latencyMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    },
    judgements,
    evidence,
  };
}

function assertMatchingInput(input: ExecuteReviewInput): void {
  if (input.reviewCase.caseId !== input.evidencePackage.caseId
    || input.reviewCase.projectId !== input.evidencePackage.projectId) {
    throw new TypeError('Review case and evidence package identities do not match.');
  }
}

type EvidenceTarget = {
  content: string;
  excerpt: string;
  contentHash: string;
};

type EvidenceTargetIndex = Map<EvidenceTargetType, Map<string, EvidenceTarget>>;

async function assertEvidenceTargets(
  output: ReviewModelOutput,
  evidencePackage: ReviewEvidencePackage,
  readRawReference?: ReviewExecutorOptions['readRawReference'],
): Promise<EvidenceTargetIndex> {
  const targets: EvidenceTargetIndex = new Map(TARGET_TYPES.map(type => [type, new Map()]));
  for (const turn of evidencePackage.turns) {
    for (const event of turn.events) {
      const content = event.content ?? event;
      addEvidenceTarget(targets, 'event', event.eventId, content);
      if (readRawReference) {
        for (const rawReference of [event.rawRef, ...(event.relatedRawRefs ?? [])]) {
          const rawContent = await readRawReference(rawReference);
          if (rawContent !== undefined) {
            addEvidenceTarget(
              targets,
              'raw_ref',
              `${rawReference.sourceFile}:${rawReference.line}`,
              rawContent,
            );
          }
        }
      }
    }
    const context = turn.projectContext;
    if (!context) continue;
    addEvidenceTarget(targets, 'turn_diff', context.turnDiff.diffId, context.turnDiff.unifiedDiff, context.turnDiff.contentHash);
    addEvidenceTarget(targets, 'project_profile', context.projectProfile.profileId, context.projectProfile);
    addEvidenceTarget(targets, 'environment_snapshot', context.environmentSnapshot.snapshotId, context.environmentSnapshot);
    if (context.environmentDelta) addEvidenceTarget(targets, 'environment_delta', context.environmentDelta.deltaId, context.environmentDelta);
  }
  const projectContext = evidencePackage.projectContext;
  if (projectContext?.diff) {
    addEvidenceTarget(
      targets,
      'project_diff',
      projectContext.diff.targetId,
      projectContext.diff.content,
      projectContext.diff.contentHash,
    );
  }
  for (const file of projectContext?.files ?? []) {
    addEvidenceTarget(targets, 'project_file', file.path, file.content, file.contentHash);
  }
  for (const judgement of output.judgements) {
    for (const evidence of judgement.evidence) {
      if (!targets.get(evidence.targetType)?.has(evidence.targetId)) {
        invalidOutput(`evidence target does not exist in the package: ${evidence.targetType}:${evidence.targetId}`);
      }
    }
  }
  return targets;
}

function requiredEvidenceTarget(index: EvidenceTargetIndex, source: ReviewModelEvidence): EvidenceTarget {
  const target = index.get(source.targetType)?.get(source.targetId);
  if (!target) invalidOutput(`evidence target does not exist in the package: ${source.targetType}:${source.targetId}`);
  return target;
}

function addEvidenceTarget(
  index: EvidenceTargetIndex,
  targetType: EvidenceTargetType,
  targetId: string,
  value: unknown,
  contentHash?: string,
): void {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  const target = {
    content,
    excerpt: redactCredentialText(content, { context: 'auto' }).slice(0, 1_000),
    contentHash: contentHash || hash(content),
  };
  const bucket = index.get(targetType);
  const existing = bucket?.get(targetId);
  if (existing) {
    if (existing.content !== target.content || existing.contentHash !== target.contentHash) {
      throw new TypeError(`Conflicting evidence target: ${targetType}:${targetId}`);
    }
    return;
  }
  bucket?.set(targetId, target);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertJudgement(value: unknown, index: number): void {
  if (!isRecord(value)) invalidOutput(`judgements[${index}] must be an object`);
  const judgement = value as Record<string, unknown>;
  const requiredStrings = ['title', 'summary', 'impact', 'alternativeExplanation', 'recommendation', 'issueFingerprint'];
  for (const key of requiredStrings) {
    if (typeof judgement[key] !== 'string' || (key !== 'issueFingerprint' && !judgement[key])) {
      invalidOutput(`judgements[${index}].${key} must be a valid string`);
    }
  }
  if (!CATEGORIES.includes(judgement.category as ReviewCategory)) invalidOutput(`judgements[${index}].category is invalid`);
  if (!SEVERITIES.includes(judgement.severity as ReviewSeverity)) invalidOutput(`judgements[${index}].severity is invalid`);
  if (!REVIEWABILITIES.includes(judgement.reviewability as Reviewability)) invalidOutput(`judgements[${index}].reviewability is invalid`);
  if (typeof judgement.confidence !== 'number' || judgement.confidence < 0 || judgement.confidence > 1) {
    invalidOutput(`judgements[${index}].confidence must be between 0 and 1`);
  }
  if (!Array.isArray(judgement.evidence) || judgement.evidence.length === 0) {
    invalidOutput(`judgements[${index}].evidence must contain at least one item`);
  }
  judgement.evidence.forEach((item, evidenceIndex) => assertEvidence(item, index, evidenceIndex));
}

function assertEvidence(value: unknown, judgementIndex: number, evidenceIndex: number): void {
  if (!isRecord(value)) invalidOutput(`judgements[${judgementIndex}].evidence[${evidenceIndex}] must be an object`);
  const evidence = value as Record<string, unknown>;
  for (const key of ['evidenceType', 'targetId', 'description']) {
    if (typeof evidence[key] !== 'string' || !evidence[key]) invalidOutput(`evidence.${key} must be a non-empty string`);
  }
  for (const key of ['cachedExcerpt', 'contentHash']) {
    if (typeof evidence[key] !== 'string') invalidOutput(`evidence.${key} must be a string`);
  }
  if (!TARGET_TYPES.includes(evidence.targetType as EvidenceTargetType)) invalidOutput('evidence.targetType is invalid');
}

function invalidOutput(message: string): never {
  throw new TypeError(`Invalid review model output: ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const CATEGORIES: ReviewCategory[] = ['process_efficiency', 'tool_usage', 'repeated_failure', 'architecture', 'maintainability', 'performance', 'security', 'testability'];
const SEVERITIES: ReviewSeverity[] = ['low', 'medium', 'high', 'critical'];
const REVIEWABILITIES: Reviewability[] = ['sufficient', 'insufficient', 'needs_raw', 'needs_project_context'];
const TARGET_TYPES: EvidenceTargetType[] = ['event', 'turn_diff', 'project_profile', 'environment_snapshot', 'environment_delta', 'project_diff', 'raw_ref', 'project_file'];
