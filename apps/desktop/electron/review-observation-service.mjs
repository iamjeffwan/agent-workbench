import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { adaptCodexSession } from '@agent-workbench/codex-adapter';
import {
  buildReviewEvidencePackage,
  enrichReviewEvidencePackageFromProject,
} from '@agent-workbench/review';

const SOURCE = 'review-observation';

/**
 * Turns a user-selected task or Codex turn selection into the stable Review
 * inputs. The service only prepares evidence; choosing and invoking a review
 * model remains a separate concern.
 */
export function createReviewObservationService({
  resolveSessionFiles,
  readTask,
  readProjectObservation,
  adaptSession = adaptCodexSession,
  buildEvidence = buildReviewEvidencePackage,
  enrichEvidence = enrichReviewEvidencePackageFromProject,
  now = () => new Date(),
  createId = () => randomUUID(),
} = {}) {
  if (typeof resolveSessionFiles !== 'function') {
    throw new Error('resolveSessionFiles is required');
  }
  if (typeof readProjectObservation !== 'function') {
    throw new Error('readProjectObservation is required');
  }

  return {
    async prepareFromTask(taskId, options = {}) {
      if (typeof readTask !== 'function') return failed(null, 'Task selection is unavailable.');
      const taskResult = readTask(taskId);
      if (taskResult?.status !== 'ready' || !taskResult.data) {
        return failed(null, taskResult?.error ?? 'The selected task is unavailable.');
      }
      const task = taskResult.data;
      return prepare({
        projectRoot: task.projectRoot,
        sessionId: task.sessionId,
        turnIds: task.turnIds,
        sourceType: 'task',
        sourceTaskId: task.id,
        revision: options.revision,
      });
    },

    async prepareFromTurns(input) {
      return prepare({ ...input, sourceType: 'manual_turn_selection' });
    },
  };

  async function prepare(input) {
    const selection = normalizeSelection(input);
    if (!selection) {
      return failed(null, 'Project, session and one or more turns are required.');
    }

    try {
      const resolution = resolveSessionFiles(selection.projectRoot, [selection.sessionId]);
      if (resolution?.status !== 'ready' || resolution.data?.sessionFiles?.length !== 1) {
        return failed(null, resolution?.error ?? 'The selected session source cannot be resolved exactly.');
      }

      const [sessionFile] = resolution.data.sessionFiles;
      const projectState = readProjectObservation(selection.projectRoot);
      const projectId = projectState?.status === 'ready'
        ? projectState.data?.projectId
        : null;
      if (typeof projectId !== 'string' || !projectId) {
        return failed(null, projectState?.error ?? 'The selected project observation is unavailable.');
      }

      const session = adaptSession(sessionFile, { projectId });
      if (session.session.sessionId !== selection.sessionId) {
        return failed(null, 'The resolved session source does not match the selected session.');
      }

      const reviewCase = {
        caseId: `case_${createId()}`,
        projectId,
        sourceType: selection.sourceType,
        ...(selection.sourceTaskId ? { sourceTaskId: selection.sourceTaskId } : {}),
        turns: selection.turnIds.map(turnId => ({ sessionId: selection.sessionId, turnId })),
        createdAt: now().toISOString(),
      };
      const evidencePackage = buildEvidence({
        reviewCase,
        sessions: [session],
        projectObservations: projectObservationsForSelection(
          projectState?.status === 'ready' ? projectState.data : null,
          projectId,
          selection.sessionId,
          selection.turnIds,
        ),
      });
      const enrichedEvidence = await enrichEvidence({
        evidencePackage,
        repositoryRoot: selection.projectRoot,
        ...(selection.revision ? { revision: selection.revision } : {}),
      });

      return ready({
        reviewCase,
        evidencePackage: enrichedEvidence,
        selection: {
          projectRoot: selection.projectRoot,
          sessionId: selection.sessionId,
          turnIds: selection.turnIds,
          sessionFile: path.resolve(sessionFile),
        },
      });
    } catch (error) {
      return failed(null, error instanceof Error ? error.message : 'Unable to prepare the review evidence.');
    }
  }
}

function projectObservationsForSelection(store, projectId, sessionId, turnIds) {
  return turnIds.map(turnId => {
    const turn = store?.turns?.[turnKey(sessionId, turnId)];
    if (turn?.status === 'completed'
      && turn.facts?.turnDiff
      && turn.facts?.environmentDelta
      && turn.after?.profile
      && turn.after?.snapshot) {
      return {
        sessionId,
        turnId,
        status: 'available',
        turnDiff: turn.facts.turnDiff,
        projectProfile: turn.after.profile,
        environmentSnapshot: turn.after.snapshot,
        environmentDelta: turn.facts.environmentDelta,
      };
    }
    return {
      sessionId,
      turnId,
      status: 'unavailable',
      unavailableReason: unavailableReason(turn, projectId),
    };
  });
}

function unavailableReason(turn, projectId) {
  if (!turn) return 'No persisted project observation exists for this selected turn.';
  if (turn.status === 'unavailable') return `Project observation is unavailable: ${turn.reason ?? 'unknown reason'}.`;
  if (turn.status === 'observing') return 'The selected turn is still being observed.';
  if (turn.status === 'error') return `Project observation failed: ${turn.error ?? 'unknown error'}.`;
  if (turn.after?.snapshot?.projectId && turn.after.snapshot.projectId !== projectId) {
    return 'Persisted project observation does not match the selected project.';
  }
  return 'The selected turn has no complete persisted project observation.';
}

function normalizeSelection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const projectRoot = string(input.projectRoot);
  const sessionId = string(input.sessionId);
  const turnIds = Array.isArray(input.turnIds)
    ? [...new Set(input.turnIds.map(string).filter(Boolean))]
    : [];
  const sourceType = input.sourceType === 'task' ? 'task' : 'manual_turn_selection';
  const sourceTaskId = string(input.sourceTaskId);
  const revision = string(input.revision);
  if (!projectRoot || !sessionId || turnIds.length === 0) return null;
  return {
    projectRoot: path.resolve(projectRoot),
    sessionId,
    turnIds,
    sourceType,
    ...(sourceTaskId ? { sourceTaskId } : {}),
    ...(revision ? { revision } : {}),
  };
}

function turnKey(sessionId, turnId) {
  return `${sessionId}\0${turnId}`;
}

function string(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ready(data) {
  return { status: 'ready', source: SOURCE, data, error: null };
}

function failed(data, error) {
  return { status: 'error', source: SOURCE, data, error };
}
