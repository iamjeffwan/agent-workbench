import {
  assertObservationSession,
  type CapabilityManifest,
  type ObservationEvent,
  type ObservationSession,
} from '@agent-workbench/observation-schema';
import type {
  EnvironmentDelta,
  EnvironmentSnapshot,
  ProjectProfile,
  TurnDiff,
} from '@agent-workbench/project-observation';

import type {
  ReviewCase,
  Reviewability,
  ReviewTurnRef,
} from './types.js';

export const REVIEW_EVIDENCE_SCHEMA_VERSION = 'review-evidence-1' as const;

export type ProjectObservationEvidence = {
  sessionId: string;
  turnId: string;
  status: 'available' | 'unavailable';
  turnDiff?: TurnDiff;
  projectProfile?: ProjectProfile;
  environmentSnapshot?: EnvironmentSnapshot;
  environmentDelta?: EnvironmentDelta | null;
  unavailableReason?: string;
};

export type ReviewEvidenceGapCode =
  | 'missing_turn'
  | 'missing_user_input'
  | 'project_observation_unavailable';

export type ReviewEvidenceGap = {
  code: ReviewEvidenceGapCode;
  sessionId: string;
  turnId: string;
  description: string;
};

export type ReviewTurnProjectContext = {
  turnDiff: TurnDiff;
  projectProfile: ProjectProfile;
  environmentSnapshot: EnvironmentSnapshot;
  environmentDelta: EnvironmentDelta | null;
};

export type ReviewEvidenceTurn = {
  sessionId: string;
  turnId: string;
  sequence: number;
  status: 'completed' | 'aborted' | 'in_progress';
  userInput: string;
  events: ObservationEvent[];
  source: {
    agent: string;
    sourceVersion: string;
    adapterVersion: string;
    model?: string;
    capabilityManifest: CapabilityManifest;
  };
  projectContext?: ReviewTurnProjectContext;
};

export type ReviewEvidencePackage = {
  schemaVersion: '1.0-draft';
  evidenceSchemaVersion: typeof REVIEW_EVIDENCE_SCHEMA_VERSION;
  caseId: string;
  projectId: string;
  builtAt: string;
  reviewability: Reviewability;
  gaps: ReviewEvidenceGap[];
  turns: ReviewEvidenceTurn[];
};

export type BuildReviewEvidencePackageInput = {
  reviewCase: ReviewCase;
  sessions: ObservationSession[];
  projectObservations?: ProjectObservationEvidence[];
  builtAt?: Date;
};

export function buildReviewEvidencePackage(
  input: BuildReviewEvidencePackageInput,
): ReviewEvidencePackage {
  assertUniqueTurnRefs(input.reviewCase.turns);
  input.sessions.forEach(assertObservationSession);
  const sessions = uniqueSessions(input.sessions);
  const observations = observationIndex(input.projectObservations ?? []);
  const gaps: ReviewEvidenceGap[] = [];
  const turns: ReviewEvidenceTurn[] = [];

  for (const reference of input.reviewCase.turns) {
    const session = sessions.get(reference.sessionId);
    const turn = session?.turns.find(candidate => candidate.turnId === reference.turnId);
    if (!session || !turn || !belongsToProject(session, input.reviewCase.projectId)) {
      gaps.push(gap('missing_turn', reference, 'The selected canonical turn is unavailable.'));
      continue;
    }

    const userInput = turn.events
      .filter(event => event.type === 'message' && event.actor === 'user')
      .map(event => event.content?.trim())
      .filter((value): value is string => Boolean(value))
      .join('\n\n');
    if (!userInput) {
      gaps.push(gap('missing_user_input', reference, 'The selected turn has no normalized user input.'));
    }

    const observation = observations.get(turnKey(reference));
    const projectContext = projectContextFor(
      observation,
      reference,
      input.reviewCase.projectId,
      gaps,
    );
    turns.push({
      sessionId: reference.sessionId,
      turnId: reference.turnId,
      sequence: turn.sequence,
      status: turn.status ?? 'in_progress',
      userInput,
      events: structuredClone(turn.events),
      source: {
        agent: session.session.sourceAgent,
        sourceVersion: session.session.sourceVersion,
        adapterVersion: session.session.adapterVersion,
        ...(turn.model ?? session.session.model ? { model: turn.model ?? session.session.model } : {}),
        capabilityManifest: structuredClone(session.capabilityManifest),
      },
      ...(projectContext ? { projectContext } : {}),
    });
  }

  return {
    schemaVersion: '1.0-draft',
    evidenceSchemaVersion: REVIEW_EVIDENCE_SCHEMA_VERSION,
    caseId: input.reviewCase.caseId,
    projectId: input.reviewCase.projectId,
    builtAt: (input.builtAt ?? new Date()).toISOString(),
    reviewability: packageReviewability(gaps),
    gaps,
    turns,
  };
}

function projectContextFor(
  observation: ProjectObservationEvidence | undefined,
  reference: ReviewTurnRef,
  projectId: string,
  gaps: ReviewEvidenceGap[],
): ReviewTurnProjectContext | undefined {
  if (!observation || observation.status === 'unavailable') {
    gaps.push(gap(
      'project_observation_unavailable',
      reference,
      observation?.unavailableReason ?? 'Project observation is unavailable for the selected turn.',
    ));
    return undefined;
  }
  if (!observation.turnDiff || !observation.projectProfile || !observation.environmentSnapshot) {
    throw new TypeError(`Available project observation is incomplete: ${turnKey(reference)}`);
  }
  assertProjectIdentity(observation, reference, projectId);
  return {
    turnDiff: structuredClone(observation.turnDiff),
    projectProfile: structuredClone(observation.projectProfile),
    environmentSnapshot: structuredClone(observation.environmentSnapshot),
    environmentDelta: observation.environmentDelta ? structuredClone(observation.environmentDelta) : null,
  };
}

function assertProjectIdentity(
  observation: ProjectObservationEvidence,
  reference: ReviewTurnRef,
  projectId: string,
): void {
  const values = [observation.turnDiff, observation.environmentSnapshot, observation.environmentDelta]
    .filter(Boolean) as Array<{ projectId: string; sessionId: string; turnId?: string }>;
  if (observation.projectProfile?.projectId !== projectId
    || values.some(value => (
      value.projectId !== projectId
      || value.sessionId !== reference.sessionId
      || ('turnId' in value && value.turnId !== reference.turnId)
    ))) {
    throw new TypeError(`Project observation identity does not match: ${turnKey(reference)}`);
  }
}

function observationIndex(values: ProjectObservationEvidence[]): Map<string, ProjectObservationEvidence> {
  const result = new Map<string, ProjectObservationEvidence>();
  for (const value of values) {
    const key = turnKey(value);
    if (result.has(key)) throw new TypeError(`Duplicate project observation: ${key}`);
    result.set(key, value);
  }
  return result;
}

function uniqueSessions(values: ObservationSession[]): Map<string, ObservationSession> {
  const result = new Map<string, ObservationSession>();
  for (const value of values) {
    if (result.has(value.session.sessionId)) throw new TypeError(`Duplicate observation session: ${value.session.sessionId}`);
    result.set(value.session.sessionId, value);
  }
  return result;
}

function assertUniqueTurnRefs(values: ReviewTurnRef[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = turnKey(value);
    if (seen.has(key)) throw new TypeError(`Duplicate review turn: ${key}`);
    seen.add(key);
  }
}

function belongsToProject(session: ObservationSession, projectId: string): boolean {
  return !session.session.projectId || session.session.projectId === projectId;
}

function packageReviewability(gaps: ReviewEvidenceGap[]): Reviewability {
  if (gaps.some(item => item.code === 'missing_turn' || item.code === 'missing_user_input')) return 'insufficient';
  if (gaps.some(item => item.code === 'project_observation_unavailable')) return 'needs_project_context';
  return 'sufficient';
}

function gap(code: ReviewEvidenceGapCode, reference: ReviewTurnRef, description: string): ReviewEvidenceGap {
  return { code, sessionId: reference.sessionId, turnId: reference.turnId, description };
}

function turnKey(value: ReviewTurnRef): string {
  return `${value.sessionId}:${value.turnId}`;
}
