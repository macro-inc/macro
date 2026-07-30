export type Env = 'dev' | 'prod' | 'local';

/** The backend services the SDK talks to. Note `search` and `properties` are
 * served on the storage host, so they point there. */
export type ServiceName =
  | 'storage'
  | 'auth'
  | 'email'
  | 'cognition'
  | 'notification'
  | 'properties'
  | 'search'
  | 'scheduled-action'
  | 'static-files'
  | 'connection'
  | 'contacts'
  | 'unfurl'
  | 'agent-proxy';

export const WEB_APP_URLS: Record<Env, string> = {
  dev: 'https://dev.macro.com',
  prod: 'https://macro.com',
  local: 'http://localhost:3000',
};

export const HOSTS: Record<Env, Record<ServiceName, string>> = {
  dev: {
    storage: 'https://cloud-storage-dev.macro.com',
    auth: 'https://auth-service-dev.macro.com',
    email: 'https://email-service-dev.macro.com',
    cognition: 'https://document-cognition-dev.macro.com',
    notification: 'https://notifications-dev.macro.com',
    properties: 'https://cloud-storage-dev.macro.com',
    search: 'https://cloud-storage-dev.macro.com',
    'scheduled-action': 'https://agent-schedule-dev.macro.com',
    'static-files': 'https://static-file-service-dev.macro.com',
    connection: 'https://connection-gateway-dev.macro.com',
    contacts: 'https://contacts-dev.macro.com',
    unfurl: 'https://unfurl-service-dev.macro.com',
    'agent-proxy': 'https://agent-proxy-dev.macro.com',
  },
  prod: {
    storage: 'https://cloud-storage.macro.com',
    auth: 'https://auth-service.macro.com',
    email: 'https://email-service.macro.com',
    cognition: 'https://document-cognition.macro.com',
    notification: 'https://notifications.macro.com',
    properties: 'https://cloud-storage.macro.com',
    search: 'https://cloud-storage.macro.com',
    'scheduled-action': 'https://agent-schedule.macro.com',
    'static-files': 'https://static-file-service.macro.com',
    connection: 'https://connection-gateway.macro.com',
    contacts: 'https://contacts.macro.com',
    unfurl: 'https://unfurl-service.macro.com',
    'agent-proxy': 'https://agent-proxy.macro.com',
  },
  local: {
    storage: 'http://localhost:8086',
    auth: 'http://localhost:8080',
    email: 'http://localhost:8087',
    cognition: 'http://localhost:8085',
    notification: 'http://localhost:8089',
    properties: 'http://localhost:8086',
    search: 'http://localhost:8086',
    'scheduled-action': 'http://localhost:8098',
    'static-files': 'http://localhost:8100',
    connection: 'http://localhost:8082',
    contacts: 'http://localhost:8083',
    unfurl: 'http://localhost:8095',
    'agent-proxy': 'http://localhost:8091',
  },
};

/** A bearer token, or a (possibly async) function that returns one — the
 * function form lets you refresh tokens without reconfiguring. */
export type TokenSource = string | (() => string | Promise<string>);

/** Access scope for bot-authenticated requests. `user` acts with the
 * requested-as user's access (requires `requestedAs`); `team` acts with the
 * bot's owning team's access (team-owned bots only). */
export type BotScope = 'user' | 'team';

/** How the SDK authenticates with Macro.
 *
 * - `user`: a human's Macro API token, sent as `Authorization: Bearer`.
 * - `bot`: an `mbot_` API key, sent as `x-macro-bot-token` together with
 *   `x-macro-bot-scope`. When `scope` is omitted it defaults to `user` when
 *   `requestedAs` is set (user scope requires an acting user) and `team`
 *   otherwise.
 */
export type MacroAuth =
  | { type: 'user'; token: TokenSource }
  | { type: 'bot'; token: TokenSource; scope?: BotScope };

/** Options passed to `new Macro(opts)` and stored on `MacroClient`. */
export interface MacroOpts {
  /** How to authenticate. Takes precedence over `token`. Falls back to the
   * MACRO_API_KEY (user auth) or MACRO_BOT_TOKEN (bot auth) env var. */
  auth?: MacroAuth;
  /** Shorthand for `auth: { type: 'user', token }`. */
  token?: TokenSource;
  env?: Env;
  /** Override individual service hosts (e.g. point one at localhost). */
  hosts?: Partial<Record<ServiceName, string>>;
  /** Override the web app base URL (e.g. for local frontend dev). Also reads MACRO_WEB_URL. */
  webAppUrl?: string;
  /** Signing secret for verifying incoming webhooks. Falls back to MACRO_WEBHOOK_SECRET. */
  webhookSecret?: string;
  wsVerify?: string;
  /** User id the bot acts for, sent as `x-macro-bot-for-macro-user-id` on
   * every request. Bot auth only. Set via `macro.requestedAs(userId)` rather
   * than directly. */
  requestedAs?: string;
}
