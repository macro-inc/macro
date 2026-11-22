import { createQueryKeys } from '@lukemorales/query-key-factory';

/** Keyed by `containerKey`: one read serves every response in the container. */
export const agentFeedbackKeys = createQueryKeys('agentFeedback', {
  mine: (container: string) => [container],
});
