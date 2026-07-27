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
  type MacroOpts,
  type ServiceName,
  WEB_APP_URLS,
} from '../config';
import { MacroEvents } from '../events/receiver';

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
  private readonly token: string | (() => string | Promise<string>);
  private readonly requestedAs?: string;

  constructor(opts: MacroOpts) {
    const env: Env = opts.env ?? 'dev';
    const hosts = { ...HOSTS[env], ...opts.hosts };
    const envWebUrl =
      typeof process !== 'undefined' ? process.env.MACRO_WEB_URL : undefined;
    this.webAppUrl = opts.webAppUrl ?? envWebUrl ?? WEB_APP_URLS[env];
    const env_token =
      typeof process !== 'undefined' ? process.env.MACRO_API_KEY : undefined;
    this.token =
      opts.token ??
      env_token ??
      (() => {
        throw new Error(
          'no Macro API token — set MACRO_API_KEY or pass token to new Macro()',
        );
      });
    this.wsVerify = opts.wsVerify;
    this.requestedAs = opts.requestedAs;

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
      const tok =
        typeof this.token === 'function' ? await this.token() : this.token;
      request.headers.set('Authorization', `Bearer ${tok}`);
      if (this.requestedAs) {
        request.headers.set('x-macro-bot-for-macro-user-id', this.requestedAs);
      }
      return request;
    });
    return c;
  }
}

export type { ServiceName };
