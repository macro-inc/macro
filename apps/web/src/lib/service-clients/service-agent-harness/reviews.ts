import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import type { ReviewDecision, ReviewRecord } from './generated/schemas';

const host = SERVER_HOSTS['agent-harness'];

/** Persisted reviews use the ordinary authenticated session API. */
export const agentReviewClient = {
  get(session: string, review: string) {
    return fetchWithToken<ReviewRecord>(
      `${host}/agent-sessions/${session}/reviews/${review}`,
      { method: 'GET' }
    );
  },
  async decide(session: string, review: string, decision: ReviewDecision) {
    const span = Telemetry.clientSpan('agent.review.decide');
    span.setAttr('agent.session.id', session);
    span.setAttr('agent.review.id', review);
    span.setAttr('agent.review.action', decision.action);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    span.injectTraceHeaders(headers);
    try {
      const result = await fetchWithToken<ReviewRecord>(
        `${host}/agent-sessions/${session}/reviews/${review}`,
        { method: 'POST', headers, body: JSON.stringify(decision) }
      );
      if (result.isErr()) span.error('Review decision failed');
      return result;
    } finally {
      span.end();
    }
  },
};
