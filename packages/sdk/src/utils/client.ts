import { Sdk as AgentHarnessSdk } from '../../generated/agent-harness/sdk.gen';
import { Sdk as AuthSdk } from '../../generated/auth/sdk.gen';
import { Sdk as CognitionSdk } from '../../generated/cognition/sdk.gen';
import { Sdk as ContactsSdk } from '../../generated/contacts/sdk.gen';
import { Sdk as EmailSdk } from '../../generated/email/sdk.gen';
import { Sdk as NotificationSdk } from '../../generated/notification/sdk.gen';
import { Sdk as PropertiesSdk } from '../../generated/properties/sdk.gen';
import { Sdk as SearchSdk } from '../../generated/search/sdk.gen';
import { createClient } from '../../generated/storage/client';
import { Sdk as StorageSdk } from '../../generated/storage/sdk.gen';
import type { Bot } from '../../generated/storage/types.gen';
import {
  type Env,
  HOSTS,
  type MacroAuth,
  type MacroOpts,
  type ServiceName,
  WEB_APP_URLS,
} from '../config';
import { BotsNamespace } from '../entities/bots/namespace';
import { User } from '../entities/users/user';
import { MacroEvents } from '../events/receiver';
import { type LocalPortmap, resolveLocalPortmap } from '../local-portmap';

export class MacroClient {
  readonly agentHarness: AgentHarnessSdk;
  readonly auth: AuthSdk;
  readonly cognition: CognitionSdk;
  readonly contacts: ContactsSdk;
  readonly email: EmailSdk;
  readonly notification: NotificationSdk;
  readonly properties: PropertiesSdk;
  readonly search: SearchSdk;
  readonly storage: StorageSdk;
  readonly webAppUrl: string;
  readonly wsVerify?: string;
  readonly events: MacroEvents;
  /** Resolved authentication config (distinct from `auth`, the auth-service SDK). */
  readonly authConfig: MacroAuth;
  /** Resolved service base urls: env defaults, then the local-stack portmap,
   * then `opts.hosts` overrides. */
  readonly hosts: Record<ServiceName, string>;
  /** The local stack's generated port map; only set when env is `local`. */
  readonly localPortmap?: LocalPortmap;
  private readonly requestedAs?: string;
  private selfBotRecord?: Promise<Bot>;
  private selfPrincipal?: Promise<string>;

  constructor(opts: MacroOpts) {
    const env = resolveEnv(opts);
    const localPortmap = env === 'local' ? resolveLocalPortmap() : undefined;
    const hosts = { ...HOSTS[env], ...localPortmap?.hosts, ...opts.hosts };
    this.hosts = hosts;
    this.localPortmap = localPortmap;
    const envWebUrl =
      typeof process !== 'undefined' ? process.env.MACRO_WEB_URL : undefined;
    this.webAppUrl =
      opts.webAppUrl ??
      envWebUrl ??
      localPortmap?.webAppUrl ??
      WEB_APP_URLS[env];
    this.authConfig = resolveAuth(opts);
    this.requestedAs = opts.requestedAs;
    if (this.requestedAs && this.authConfig.type !== 'bot') {
      throw new Error(
        'requestedAs() requires bot auth — a user token always acts as its own user',
      );
    }
    this.wsVerify = opts.wsVerify;

    this.agentHarness = new AgentHarnessSdk({
      client: this.makeClient(hosts['agent-harness']),
    });
    this.auth = new AuthSdk({ client: this.makeClient(hosts.auth) });
    this.cognition = new CognitionSdk({
      client: this.makeClient(hosts.cognition),
    });
    this.contacts = new ContactsSdk({
      client: this.makeClient(hosts.contacts),
    });
    this.email = new EmailSdk({ client: this.makeClient(hosts.email) });
    this.notification = new NotificationSdk({
      client: this.makeClient(hosts.notification),
    });
    this.properties = new PropertiesSdk({
      client: this.makeClient(hosts.properties),
    });
    this.search = new SearchSdk({ client: this.makeClient(hosts.search) });
    this.storage = new StorageSdk({ client: this.makeClient(hosts.storage) });

    const envWebhookSecret =
      typeof process !== 'undefined'
        ? process.env.MACRO_WEBHOOK_SECRET
        : undefined;
    const webhookSecret = opts.webhookSecret ?? envWebhookSecret;
    this.events = new MacroEvents(this, webhookSecret);
  }

  /** Whether requests have a user identity accepted by acting-user endpoints. */
  hasActingUser(): boolean {
    return this.authConfig.type === 'user' || this.requestedAs !== undefined;
  }

  /**
   * The authenticated bot's own record, fetched once and cached. Bot auth
   * only. Failed lookups are not cached, so a later call retries.
   */
  selfBot(): Promise<Bot> {
    this.selfBotRecord ??= new BotsNamespace(this).me().catch((error) => {
      this.selfBotRecord = undefined;
      throw error;
    });
    return this.selfBotRecord;
  }

  /**
   * The authenticated caller's mentionable principal — `bot|<uuid>` for bot
   * auth, `macro|<email>` for user auth — fetched once and cached. Failed
   * lookups are not cached, so a later call retries.
   */
  myPrincipalId(): Promise<string> {
    this.selfPrincipal ??= (
      this.authConfig.type === 'bot'
        ? this.selfBot().then((bot) => `bot|${bot.id}`)
        : User.me(this).then((user) => user.id)
    ).catch((error) => {
      this.selfPrincipal = undefined;
      throw error;
    });
    return this.selfPrincipal;
  }

  private makeClient(baseUrl: string) {
    const c = createClient({ baseUrl });
    c.interceptors.request.use(async (request) => {
      const source = this.authConfig.token;
      const tok = typeof source === 'function' ? await source() : source;
      if (this.authConfig.type === 'bot') {
        request.headers.set('x-macro-bot-token', tok);
        // A per-call scope wins: the channel webhook fallback pins `user`,
        // the only scope a user-owned bot can present (a team scope with no
        // owning team is rejected outright).
        if (!request.headers.has('x-macro-bot-scope')) {
          request.headers.set(
            'x-macro-bot-scope',
            this.authConfig.scope ?? (this.requestedAs ? 'user' : 'team'),
          );
        }
        if (this.requestedAs) {
          request.headers.set(
            'x-macro-bot-for-macro-user-id',
            this.requestedAs,
          );
        }
      } else {
        if (tok.startsWith('mbot_')) {
          throw new Error(
            "bot API key passed as a user token — use auth: { type: 'bot', token } (or MACRO_BOT_TOKEN)",
          );
        }
        request.headers.set('Authorization', `Bearer ${tok}`);
      }
      return request;
    });
    return c;
  }
}

function resolveEnv(opts: MacroOpts): Env {
  if (opts.env) return opts.env;
  const fromEnv =
    typeof process !== 'undefined' ? process.env.MACRO_ENV : undefined;
  if (!fromEnv) return 'dev';
  if (!(fromEnv in HOSTS)) {
    throw new Error(
      `invalid MACRO_ENV "${fromEnv}" — expected local, dev, or prod`,
    );
  }
  return fromEnv as Env;
}

function resolveAuth(opts: MacroOpts): MacroAuth {
  if (opts.auth) return opts.auth;
  if (opts.token) return { type: 'user', token: opts.token };
  const envApiKey =
    typeof process !== 'undefined' ? process.env.MACRO_API_KEY : undefined;
  const envBotToken =
    typeof process !== 'undefined' ? process.env.MACRO_BOT_TOKEN : undefined;
  if (envApiKey && envBotToken) {
    throw new Error(
      'both MACRO_API_KEY and MACRO_BOT_TOKEN are set — pass auth to new Macro() to pick one',
    );
  }
  if (envBotToken) return { type: 'bot', token: envBotToken };
  return {
    type: 'user',
    token:
      envApiKey ??
      (() => {
        throw new Error(
          'no Macro API token — set MACRO_API_KEY / MACRO_BOT_TOKEN or pass token/auth to new Macro()',
        );
      }),
  };
}

export type { ServiceName };
