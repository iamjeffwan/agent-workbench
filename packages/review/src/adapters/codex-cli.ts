import {
  CodexCliInvocationError,
  createCodexCliStructuredModel,
} from '@agent-workbench/codex-cli-model';
import type {
  CodexCliCommand,
  CodexCliCommandRunner,
  CodexCliProvider,
} from '@agent-workbench/codex-cli-model';

import type {
  ReviewModelAdapter,
  ReviewModelRequest,
  ReviewModelResponse,
} from '../execution.js';
import { ReviewModelAdapterError } from '../execution.js';

export type { CodexCliCommand, CodexCliCommandRunner };
export type CodexCliCustomProvider = CodexCliProvider;

export type CodexCliReviewModelAdapterOptions = {
  artifactDirectory: string;
  workingDirectory: string;
  model?: string;
  modelVersion?: string;
  executable?: string;
  serviceTier?: 'fast' | 'flex';
  customProvider?: CodexCliCustomProvider;
  runCommand?: CodexCliCommandRunner;
};

export function createCodexCliReviewModelAdapter(
  options: CodexCliReviewModelAdapterOptions,
): ReviewModelAdapter {
  const model = createCodexCliStructuredModel({
    artifactDirectory: options.artifactDirectory,
    workingDirectory: options.workingDirectory,
    ...(options.model ? { model: options.model } : {}),
    ...(options.modelVersion ? { modelVersion: options.modelVersion } : {}),
    ...(options.executable ? { executable: options.executable } : {}),
    ...(options.serviceTier ? { serviceTier: options.serviceTier } : {}),
    ...(options.customProvider ? { provider: options.customProvider } : {}),
    ...(options.runCommand ? { runCommand: options.runCommand } : {}),
  });

  return {
    descriptor: model.descriptor,
    async review(request): Promise<ReviewModelResponse> {
      try {
        return await model.invoke({
          invocationId: request.runId,
          prompt: buildPrompt(request),
          outputSchema: request.outputSchema,
        });
      } catch (error) {
        if (error instanceof CodexCliInvocationError) {
          throw new ReviewModelAdapterError(error.message, error.artifacts);
        }
        throw error;
      }
    },
  };
}

function buildPrompt(request: ReviewModelRequest): string {
  return `${request.systemPrompt}\n\nReview case:\n${JSON.stringify(request.reviewCase)}\n\nEvidence package:\n${JSON.stringify(request.evidencePackage)}`;
}
