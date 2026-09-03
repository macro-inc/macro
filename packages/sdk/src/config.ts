export type Env = 'dev' | 'prod' | 'local';

/** The backend services the SDK talks to. Note `search` and `properties` are
 * served on the storage host, so they point there. */
export type ServiceName =
  | 'agent-harness'
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
  | 'unfurl';

export const WEB_APP_URLS: Record<Env, string> = {
  dev: 'https://dev.macro.com',
  prod: 'https://macro.com',
  local: 'http://localhost:3000',
};

export const HOSTS: Record<Env, Record<ServiceName, string>> = {
  dev: {
    'agent-harness': 'https://dev-gateway.macro.com/agent-harness',
    storage: 'https://dev-gateway.macro.com/dss',
    auth: 'https://auth-service-dev.macro.com',
    email: 'https://email-service-dev.macro.com',
    cognition: 'https://document-cognition-dev.macro.com',
    notification: 'https://dev-gateway.macro.com/notification',
    properties: 'https://dev-gateway.macro.com/dss',
    search: 'https://dev-gateway.macro.com/dss',
    'scheduled-action': 'https://dev-gateway.macro.com/scheduled-action',
    'static-files': 'https://static-file-service-dev.macro.com',
    connection: 'https://dev-gateway.macro.com/connection-gateway',
    contacts: 'https://dev-gateway.macro.com/contacts',
    unfurl: 'https://dev-gateway.macro.com/unfurl',
  },
  prod: {
    'agent-harness': 'https://gateway.macro.com/agent-harness',
    storage: 'https://gateway.macro.com/dss',
    auth: 'https://auth-service.macro.com',
    email: 'https://email-service.macro.com',
    cognition: 'https://document-cognition.macro.com',
    notification: 'https://gateway.macro.com/notification',
    properties: 'https://gateway.macro.com/dss',
    search: 'https://gateway.macro.com/dss',
    'scheduled-action': 'https://gateway.macro.com/scheduled-action',
    'static-files': 'https://static-file-service.macro.com',
    connection: 'https://gateway.macro.com/connection-gateway',
    contacts: 'https://gateway.macro.com/contacts',
    unfurl: 'https://gateway.macro.com/unfurl',
  },
  local: {
    'agent-harness': 'http://localhost:8101',
    storage: 'http://localhost:8086',
    auth: 'http://localhost:8080',
    email: 'http://localhost:8087',
    cognition: 'http://localhost:8085',
    notification: 'http://localhost:8089',
    properties: 'http://localhost:8086',
    search: 'http://localhost:8086',
    'scheduled-action': 'http://localhost:8099',
    'static-files': 'http://localhost:8100',
    connection: 'http://localhost:8082',
    contacts: 'http://localhost:8083',
    unfurl: 'http://localhost:8095',
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
  /** Which Macro environment to talk to. Falls back to the MACRO_ENV env
   * var, then `'dev'`. */
  env?: Env;
  /** Override individual service hosts (e.g. point one at localhost). */
  hosts?: Partial<Record<ServiceName, string>>;
  /** Override the web app base URL (e.g. for local frontend dev). Also reads MACRO_WEB_URL. */
  webAppUrl?: string;
  /**
   * Signing secret for verifying incoming persisted-webhook deliveries.
   * Required only for `macro.events.webhook()` / `macro.events.handle()`.
   * SSE via `macro.events.listen()` uses the API token and does not need
   * this. Falls back to MACRO_WEBHOOK_SECRET.
   */
  webhookSecret?: string;
  wsVerify?: string;
  /** User id the bot acts for, sent as `x-macro-bot-for-macro-user-id` on
   * every request. Bot auth only. Set via `macro.requestedAs(user)` rather
   * than directly. */
  requestedAs?: string;
}
