import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { statusError } from '@core/util/safeFetch';
import { Telemetry } from '@macro-inc/observability';
import type {
  ReviewDecision_Deserialize,
  ReviewRecord_Serialize,
} from '@service-agent-reviews/generated/types';

const host = SERVER_HOSTS['agent-harness'];

/** A decision the server refused, with its reason for the account holder. */
export const INVALID_REVIEW_DECISION = 'INVALID_REVIEW_DECISION';

/** Persisted reviews use the ordinary authenticated session API. */
export const agentReviewClient = {
  get(session: string, review: string) {
    return fetchWithToken<ReviewRecord_Serialize>(
      `${host}/agent-sessions/${session}/reviews/${review}`,
      { method: 'GET' }
    );
  },
  async decide(
    session: string,
    review: string,
    decision: ReviewDecision_Deserialize
  ) {
    const span = Telemetry.span('agent.review.decide', { kind: 'client' });
    span.setAttr('agent.session.id', session);
    span.setAttr('agent.review.id', review);
    span.setAttr('agent.review.action', decision.action);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    span.injectTraceHeaders(headers);
    try {
      const result = await fetchWithToken<
        ReviewRecord_Serialize,
        typeof INVALID_REVIEW_DECISION
      >(`${host}/agent-sessions/${session}/reviews/${review}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(decision),
        errorResponseHandler: async (response) =>
          response.status === 400
            ? { code: INVALID_REVIEW_DECISION, message: await response.text() }
            : statusError(response.status),
        trace: { parentSpan: span },
      });
      if (result.isErr()) span.error('Review decision failed');
      return result;
    } finally {
      span.end();
    }
  },
};
