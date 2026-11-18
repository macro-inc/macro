import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ResultError } from '@core/util/result';
import { type BaseFetchErrorCode, statusError } from '@core/util/safeFetch';
import { ok } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  AgentVoice,
  CreateTeamAgent,
  TeamAgent,
  TeamAgents,
} from './generated/schemas';

export type {
  AgentVoice,
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

export type SetAgentVoiceErrorCode =
  | 'INVALID_VOICE'
  | 'AGENTS_NOT_ENABLED'
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

async function setVoiceError(
  response: Response
): Promise<ResultError<BaseFetchErrorCode | SetAgentVoiceErrorCode>> {
  const code = match(response.status)
    .returnType<SetAgentVoiceErrorCode | undefined>()
    .with(400, () => 'INVALID_VOICE')
    .with(403, () => 'AGENTS_NOT_ENABLED')
    .with(502, () => 'REPOSITORY_FAILED')
    .otherwise(() => undefined);
  if (!code) return statusError(response.status);
  return { code, message: await serverMessage(response) };
}

const voiceUrl = (agentUserId: string) =>
  `${base}/${encodeURIComponent(agentUserId)}/voice`;

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
  /** The agent's call voice; `null` when none is set and calls use the default. */
  voice: async (agentUserId: string) => {
    const result = await fetchWithToken<AgentVoice>(voiceUrl(agentUserId));
    if (
      result.isErr() &&
      result.error.some((error) => error.code === 'NOT_FOUND')
    )
      return ok(null);
    return result;
  },
  /** Used from the agent's next call. */
  setVoice: (agentUserId: string, voice: AgentVoice) =>
    fetchWithToken<AgentVoice, SetAgentVoiceErrorCode>(voiceUrl(agentUserId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(voice),
      errorResponseHandler: setVoiceError,
    }),
};
