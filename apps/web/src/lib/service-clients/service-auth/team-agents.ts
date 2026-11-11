import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { match } from 'ts-pattern';
import type {
  CreateTeamAgent,
  TeamAgent,
  TeamAgents,
} from './generated/schemas';

export type {
  CreateTeamAgent,
  TeamAgent,
  TeamAgentStatus,
  TeamAgents,
} from './generated/schemas';

export type CreateTeamAgentErrorCode =
  | 'INVALID_AGENT'
  | 'AGENTS_NOT_ENABLED'
  | 'COMPUTER_UNAVAILABLE'
  | 'REPOSITORY_FAILED';

const base = `${SERVER_HOSTS['auth-service']}/team_agents`;

/** The server's client-safe `{ message }`, or the status's generic text. */
async function serverMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (
    typeof body === 'object' &&
    body !== null &&
    'message' in body &&
    typeof body.message === 'string'
  ) {
    return body.message;
  }
  return statusError(response.status).message;
}

async function createError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | CreateTeamAgentErrorCode>> {
  const code = match(response.status)
    .returnType<CreateTeamAgentErrorCode | undefined>()
    .with(400, () => 'INVALID_AGENT')
    .with(403, () => 'AGENTS_NOT_ENABLED')
    .with(409, () => 'COMPUTER_UNAVAILABLE')
    .with(502, () => 'REPOSITORY_FAILED')
    .otherwise(() => undefined);
  if (!code) return statusError(response.status);
  return { code, message: await serverMessage(response) };
}

/** The caller's current team's agent teammates. Writes need team admin. */
export const teamAgentsClient = {
  list: () => fetchWithToken<TeamAgents>(base),
  create: (request: CreateTeamAgent) =>
    fetchWithToken<TeamAgent, CreateTeamAgentErrorCode>(base, {
      method: 'POST',
      body: JSON.stringify(request),
      errorResponseHandler: createError,
    }),
  remove: (agentUserId: string) =>
    fetchWithToken(`${base}/${encodeURIComponent(agentUserId)}`, {
      method: 'DELETE',
    }),
};
