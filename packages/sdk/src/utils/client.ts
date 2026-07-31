import { Sdk as AuthSdk } from '../../generated/auth/sdk.gen';
import { Sdk as CognitionSdk } from '../../generated/cognition/sdk.gen';
import { Sdk as ContactsSdk } from '../../generated/contacts/sdk.gen';
import { Sdk as EmailSdk } from '../../generated/email/sdk.gen';
import { Sdk as NotificationSdk } from '../../generated/notification/sdk.gen';
import { Sdk as PropertiesSdk } from '../../generated/properties/sdk.gen';
import { Sdk as SearchSdk } from '../../generated/search/sdk.gen';
import { createClient } from '../../generated/storage/client';
import { Sdk as StorageSdk } from '../../generated/storage/sdk.gen';
import {
  type Env,
  HOSTS,
  type MacroAuth,
  type MacroOpts,
  type ServiceName,
  WEB_APP_URLS,
} from '../config';
import { MacroEvents } from '../events/receiver';
import { resolveLocalPortmap } from '../local-portmap';

export class MacroClient {
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
  readonly events?: MacroEvents;
  /** Resolved authentication config (distinct from `auth`, the auth-service SDK). */
  readonly authConfig: MacroAuth;
  private readonly requestedAs?: string;

  constructor(opts: MacroOpts) {
    const env: Env = opts.env ?? 'dev';
    const localPortmap =
      env === 'local' ? resolveLocalPortmap() : undefined;
    const hosts = { ...HOSTS[env], ...localPortmap?.hosts, ...opts.hosts };
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
    if (webhookSecret) {
      this.events = new MacroEvents(this, webhookSecret);
    }
  }

  private makeClient(baseUrl: string) {
    const c = createClient({ baseUrl });
    c.interceptors.request.use(async (request) => {
      const source = this.authConfig.token;
      const tok = typeof source === 'function' ? await source() : source;
      if (this.authConfig.type === 'bot') {
        request.headers.set('x-macro-bot-token', tok);
        request.headers.set(
          'x-macro-bot-scope',
          this.authConfig.scope ?? (this.requestedAs ? 'user' : 'team'),
        );
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
