import type {
  ReviewModelAdapter,
  ReviewModelDescriptor,
  ReviewModelRequest,
  ReviewModelResponse,
} from '../execution.js';

export type InMemoryReviewModelAdapter = ReviewModelAdapter & {
  requests: ReviewModelRequest[];
};

export type InMemoryReviewModelAdapterOptions = {
  descriptor?: Partial<ReviewModelDescriptor>;
  response?: ReviewModelResponse;
  error?: Error;
};

export function createInMemoryReviewModelAdapter(
  options: InMemoryReviewModelAdapterOptions = {},
): InMemoryReviewModelAdapter {
  const requests: ReviewModelRequest[] = [];
  return {
    descriptor: {
      provider: options.descriptor?.provider ?? 'in-memory',
      model: options.descriptor?.model ?? 'deterministic-review-model',
      ...(options.descriptor?.modelVersion ? { modelVersion: options.descriptor.modelVersion } : {}),
      transport: options.descriptor?.transport ?? 'in-memory',
    },
    requests,
    async review(request) {
      requests.push(structuredClone(request));
      if (options.error) throw options.error;
      return structuredClone(options.response ?? { output: { judgements: [] } });
    },
  };
}
