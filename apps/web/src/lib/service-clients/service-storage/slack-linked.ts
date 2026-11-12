/** DSS's `/slack-linked` routes (`/slack` is the export importer's): Slack web-client sessions linked per workspace. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import type { ExternalChatAdded } from './generated/schemas/externalChatAdded';
import { type SlackErrorCode, slackErrorResponse } from './slack-errors';
import type {
  SlackAccount,
  SlackAccountDisconnectRequest,
  SlackAccountList,
  SlackChatAdd,
  SlackConversationList,
  SlackHistoryImport,
  SlackLogin,
  SlackSessionLoginRequest,
} from './slack-linked-wire';

const host = SERVER_HOSTS['document-storage-service'];
const root = `${host}/slack-linked`;
const login = (id: string) => `${root}/login/${encodeURIComponent(id)}`;

function send<T extends ObjectLike>(
  url: string,
  method: 'POST' | 'DELETE',
  body?: unknown
) {
  return fetchWithToken<T, SlackErrorCode>(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    // Login steps carry codes and sessions; never let the browser keep them.
    cache: 'no-store',
    errorResponseHandler: slackErrorResponse,
  });
}

export const slackLinkedClient = {
  /** Starts an email sign-in; cancels the caller's earlier open attempt. */
  startEmailLogin: (email: string) =>
    send<SlackLogin>(`${root}/login`, 'POST', { email }),
  /** Signs in with a pasted session, or one Macro desktop captured. */
  startSessionLogin: (request: SlackSessionLoginRequest) =>
    send<SlackLogin>(`${root}/login/session`, 'POST', request),
  login: (id: string) =>
    fetchWithToken<SlackLogin, SlackErrorCode>(login(id), {
      cache: 'no-store',
      errorResponseHandler: slackErrorResponse,
    }),
  submitCaptcha: (id: string, solution: string) =>
    send<SlackLogin>(`${login(id)}/captcha`, 'POST', { solution }),
  submitCode: (id: string, code: string) =>
    send<SlackLogin>(`${login(id)}/code`, 'POST', { code }),
  pickWorkspaces: (id: string, teamIds: string[]) =>
    send<SlackLogin>(`${login(id)}/workspaces`, 'POST', { teamIds }),
  submitTwoFactor: (id: string, code: string) =>
    send<SlackLogin>(`${login(id)}/two-factor`, 'POST', { code }),
  cancelLogin: (id: string) => send<SlackLogin>(login(id), 'DELETE'),
  accounts: () =>
    fetchWithToken<SlackAccountList, SlackErrorCode>(`${root}/accounts`, {
      errorResponseHandler: slackErrorResponse,
    }),
  disconnect: (accountId: string, request: SlackAccountDisconnectRequest) =>
    send<SlackAccount>(
      `${root}/accounts/${encodeURIComponent(accountId)}/disconnect`,
      'POST',
      request
    ),
  /** The Slack Connect catalogue; asks each account for a refresh. */
  conversations: () =>
    fetchWithToken<SlackConversationList, SlackErrorCode>(
      `${root}/conversations`,
      { errorResponseHandler: slackErrorResponse }
    ),
  /** Imports another 1,000 earlier messages of one of the caller's chats. */
  importHistory: (chatId: string) =>
    send<SlackHistoryImport>(
      `${root}/chats/${encodeURIComponent(chatId)}/history-import`,
      'POST',
      {}
    ),
  // TODO(slack-web): use `externalChatsClient.add` once the generated
  // `ExternalChatProvider` has `slack`.
  addChat: (request: SlackChatAdd) =>
    send<ExternalChatAdded>(`${host}/external-chats`, 'POST', request),
};
