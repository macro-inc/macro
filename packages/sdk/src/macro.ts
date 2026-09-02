import type { MacroOpts } from './config';
import { AgentSessionNamespace } from './entities/agent-sessions/namespace';
import { BotsNamespace } from './entities/bots/namespace';
import { CallRecordNamespace } from './entities/calls/namespace';
import { ChannelNamespace } from './entities/channels/namespace';
import { ChatNamespace } from './entities/chats/namespace';
import { CrmNamespace } from './entities/crm/namespace';
import { DocumentNamespace } from './entities/documents/namespace';
import { EmailNamespace } from './entities/email/namespace';
import { FavoritesNamespace } from './entities/favorites/namespace';
import { ForeignEntityNamespace } from './entities/foreign/namespace';
import { NotificationNamespace } from './entities/notifications/namespace';
import { PinsNamespace } from './entities/pins/namespace';
import { ProjectNamespace } from './entities/projects/namespace';
import { PropertiesNamespace } from './entities/properties/namespace';
import { TaskNamespace } from './entities/tasks/namespace';
import { TeamNamespace } from './entities/teams/namespace';
import { UserNamespace } from './entities/users/namespace';
import type { User } from './entities/users/user';
import { WebhooksNamespace } from './entities/webhooks/namespace';
import type { MacroEvents } from './events/receiver';
import { MacroClient } from './utils/client';

export type { MacroOpts } from './config';
export type { ListenOptions, MacroEvents } from './events/receiver';
export {
  here,
  type Interpolation,
  type Mentionable,
  type MentionPart,
  msg,
  type RichMessage,
  type SimpleMention,
  toBody,
  wrapXml,
} from './mentions';

export class Macro<T extends MacroOpts = MacroOpts> {
  readonly agentSessions: AgentSessionNamespace;
  readonly bots: BotsNamespace;
  readonly calls: CallRecordNamespace;
  readonly channels: ChannelNamespace;
  readonly chats: ChatNamespace;
  readonly crm: CrmNamespace;
  readonly documents: DocumentNamespace;
  readonly email: EmailNamespace;
  readonly favorites: FavoritesNamespace;
  readonly foreignEntities: ForeignEntityNamespace;
  readonly notifications: NotificationNamespace;
  readonly pins: PinsNamespace;
  readonly projects: ProjectNamespace;
  readonly properties: PropertiesNamespace;
  readonly tasks: TaskNamespace;
  readonly teams: TeamNamespace;
  readonly users: UserNamespace;
  readonly webhooks: WebhooksNamespace;
  readonly events: MacroEvents;
  /** Base URL of the Macro web app, used to build entity URLs. */
  readonly webAppUrl: string;
  /** Direct access to the underlying hey-api service clients. */
  readonly _client: MacroClient;
  private readonly opts: T;

  constructor(opts: T) {
    this.opts = opts;
    const client = new MacroClient(opts);
    this._client = client;
    this.agentSessions = new AgentSessionNamespace(client);
    this.bots = new BotsNamespace(client);
    this.calls = new CallRecordNamespace(client);
    this.channels = new ChannelNamespace(client);
    this.chats = new ChatNamespace(client);
    this.crm = new CrmNamespace(client);
    this.documents = new DocumentNamespace(client);
    this.email = new EmailNamespace(client);
    this.favorites = new FavoritesNamespace(client);
    this.foreignEntities = new ForeignEntityNamespace(client);
    this.notifications = new NotificationNamespace(client);
    this.pins = new PinsNamespace(client);
    this.projects = new ProjectNamespace(client);
    this.properties = new PropertiesNamespace(client);
    this.tasks = new TaskNamespace(client);
    this.teams = new TeamNamespace(client);
    this.users = new UserNamespace(client);
    this.webhooks = new WebhooksNamespace(client);
    this.events = client.events;
    this.webAppUrl = client.webAppUrl;
  }

  /**
   * The authenticated caller's mentionable principal — `bot|<uuid>` for bot
   * auth, `macro|<email>` for user auth — fetched once and cached.
   */
  myPrincipalId(): Promise<string> {
    return this._client.myPrincipalId();
  }

  /** Clone of this SDK acting on behalf of `user` (sent as
   * `x-macro-bot-for-macro-user-id`). Bot auth only — throws for user auth,
   * since a user token always acts as its own user. */
  requestedAs(user: User): Macro<T> {
    return new Macro({ ...this.opts, requestedAs: user.id });
  }
}
