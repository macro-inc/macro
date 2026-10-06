import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ErrorResponseHandler } from '@core/util/safeFetch';
import type {
  Comment,
  Comparison,
  FileDiff,
  Location,
  Review,
  ReviewLink,
} from './generated/schemas';

const reviewError: ErrorResponseHandler<never> = async (response) => {
  const data = await response.json().catch(() => undefined);
  return {
    code:
      response.status === 401
        ? 'UNAUTHORIZED'
        : response.status === 409
          ? 'CONFLICT'
          : 'HTTP_ERROR',
    message: data?.message ?? `Review request failed (${response.status})`,
  };
};
const endpoint = (session: string) =>
  `${SERVER_HOSTS['agent-harness']}/agent-sessions/${encodeURIComponent(session)}/review`;
function post<T extends object>(
  session: string,
  action: string,
  body: unknown
) {
  return fetchWithToken<T>(`${endpoint(session)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    errorResponseHandler: reviewError,
  });
}
export const agentReviewClient = {
  view(session: string, revision?: number, signal?: AbortSignal) {
    return fetchWithToken<{ review: Review | null }>(
      `${endpoint(session)}${revision ? `?revision=${revision}` : ''}`,
      { method: 'GET', signal, errorResponseHandler: reviewError }
    );
  },
  file(session: string, revision: number, path: string, signal?: AbortSignal) {
    return fetchWithToken<FileDiff>(
      `${endpoint(session)}/file?${new URLSearchParams({ revision: String(revision), path })}`,
      { method: 'GET', signal, errorResponseHandler: reviewError }
    );
  },
  capture: (session: string, comparison: Comparison = {}) =>
    post<ReviewLink>(session, 'capture', comparison),
  comment: (session: string, comment: Comment) =>
    post<ReviewLink>(session, 'comment', comment),
  link: (session: string, revision: number, location: Location) =>
    post<ReviewLink>(session, 'link', { revision, location }),
  resolve: (session: string, thread: string, resolved: boolean) =>
    post<{ resolved: boolean }>(session, 'resolve', { thread, resolved }),
};
