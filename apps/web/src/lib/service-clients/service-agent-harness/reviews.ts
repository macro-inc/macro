import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
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
  decide(session: string, review: string, decision: ReviewDecision) {
    return fetchWithToken<ReviewRecord>(
      `${host}/agent-sessions/${session}/reviews/${review}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision),
      }
    );
  },
};
