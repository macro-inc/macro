import type { MacroOpts } from './config';
import { AgentSessionNamespace } from './entities/agent-sessions/namespace';
import { AgentNamespace } from './entities/agents/namespace';
import { AiNamespace } from './entities/ai/namespace';
import { ApiKeyNamespace } from './entities/api-keys/namespace';
import { BotsNamespace } from './entities/bots/namespace';
import { CalendarNamespace } from './entities/calendar/namespace';
import { CallRecordNamespace } from './entities/calls/namespace';
import { ChannelNamespace } from './entities/channels/namespace';
import { ChatNamespace } from './entities/chats/namespace';
import { CrmNamespace } from './entities/crm/namespace';
import { DatabaseNamespace } from './entities/databases/namespace';
import { DocumentNamespace } from './entities/documents/namespace';
import { EmailNamespace } from './entities/email/namespace';
import { EntityMentionNamespace } from './entities/entity-mentions/namespace';
import { FavoritesNamespace } from './entities/favorites/namespace';
import { ForeignEntityNamespace } from './entities/foreign/namespace';
import { FormNamespace } from './entities/forms/namespace';
import { GithubPullRequestNamespace } from './entities/github-pull-requests/namespace';
import { HarnessNamespace } from './entities/harnesses/namespace';
import { InitiativeNamespace } from './entities/initiatives/namespace';
import { MeetingNamespace } from './entities/meetings/namespace';
import { NotificationNamespace } from './entities/notifications/namespace';
import { PinsNamespace } from './entities/pins/namespace';
import { ProjectNamespace } from './entities/projects/namespace';
import { PropertiesNamespace } from './entities/properties/namespace';
import { RoutineNamespace } from './entities/routines/namespace';
import { TaskNamespace } from './entities/tasks/namespace';
import { TeamNamespace } from './entities/teams/namespace';
import { UnfurlNamespace } from './entities/unfurls/namespace';
import { UserNamespace } from './entities/users/namespace';
import type { User } from './entities/users/user';
import { WebhooksNamespace } from './entities/webhooks/namespace';
import { WorkspaceNamespace } from './entities/workspace/namespace';
import type { MacroEvents } from './events/receiver';
import { MacroClient } from './utils/client';

export type { MacroOpts } from './config';
export { CodeExecution } from './entities/agent-sessions/code-execution';
export type {
  DecisionRequest,
  DecisionResponse,
  StructuredCompletionRequest,
  StructuredCompletionResponse,
} from './entities/ai/namespace';
export type { CallMessage } from './entities/calls/message';
export {
  type AddColumnOptions,
  type ApplyOpsOptions,
  type ChangeColumnTypeOptions,
  type ColumnType,
  type ConvertIntoNewColumnOptions,
  MacroOpRefusedError,
  type OpResultOf,
} from './entities/databases/database';
export {
  Form,
  type FormAnswer,
  type FormAnswerValue,
  type FormBookingStep,
  type FormBookingTarget,
  type FormEntityHandle,
  type FormLayoutResult,
  type FormQuestionPlacement,
  type FormQuestionTally,
  FormReference,
  type FormResponseSummary,
  type FormRules,
  type FormRuleTest,
  type FormSectionPlacement,
  type FormSubmissionOutcome,
  type MyFormResponse,
} from './entities/forms/form';
export { FormOption, FormQuestion } from './entities/forms/question';
export { FormResponse } from './entities/forms/response';
export { FormSection } from './entities/forms/section';
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
export type { RequestActivity } from './utils/activity';
export class Macro<T extends MacroOpts = MacroOpts> {
  /** routines resources and operations. */
  readonly routines: RoutineNamespace;

  /** unfurls resources and operations. */
  readonly unfurls: UnfurlNamespace;

  /** agents resources and operations. */
  readonly agents: AgentNamespace;

  /** initiatives resources and operations. */
  readonly initiatives: InitiativeNamespace;

  /** apiKeys resources and operations. */
  readonly apiKeys: ApiKeyNamespace;

  /** harnesses resources and operations. */
  readonly harnesses: HarnessNamespace;

  /** meetings resources and operations. */
  readonly meetings: MeetingNamespace;

  /** githubPullRequests resources and operations. */
  readonly githubPullRequests: GithubPullRequestNamespace;

  /** entityMentions resources and operations. */
  readonly entityMentions: EntityMentionNamespace;

  readonly agentSessions: AgentSessionNamespace;

  readonly ai: AiNamespace;

  readonly bots: BotsNamespace;

  readonly calendar: CalendarNamespace;

  readonly calls: CallRecordNamespace;

  readonly channels: ChannelNamespace;

  readonly chats: ChatNamespace;

  readonly crm: CrmNamespace;

  readonly databases: DatabaseNamespace;

  readonly documents: DocumentNamespace;

  readonly email: EmailNamespace;

  readonly favorites: FavoritesNamespace;

  readonly foreignEntities: ForeignEntityNamespace;

  /** Build forms and submit answers without granting respondents database access. */
  readonly forms: FormNamespace;

  readonly notifications: NotificationNamespace;

  readonly pins: PinsNamespace;

  readonly projects: ProjectNamespace;

  readonly properties: PropertiesNamespace;

  readonly tasks: TaskNamespace;

  readonly teams: TeamNamespace;

  readonly users: UserNamespace;

  readonly webhooks: WebhooksNamespace;

  /** Browse workspace activity with type, task, time, tag and inbox filters. */
  readonly workspace: WorkspaceNamespace;

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
    this.routines = new RoutineNamespace(client);
    this.unfurls = new UnfurlNamespace(client);
    this.agents = new AgentNamespace(client);
    this.initiatives = new InitiativeNamespace(client);
    this.apiKeys = new ApiKeyNamespace(client);
    this.harnesses = new HarnessNamespace(client);
    this.meetings = new MeetingNamespace(client);
    this.githubPullRequests = new GithubPullRequestNamespace(client);
    this.entityMentions = new EntityMentionNamespace(client);
    this.agentSessions = new AgentSessionNamespace(client);
    this.ai = new AiNamespace(client);
    this.bots = new BotsNamespace(client);
    this.calendar = new CalendarNamespace(client);
    this.calls = new CallRecordNamespace(client);
    this.channels = new ChannelNamespace(client);
    this.chats = new ChatNamespace(client);
    this.crm = new CrmNamespace(client);
    this.databases = new DatabaseNamespace(client);
    this.documents = new DocumentNamespace(client);
    this.email = new EmailNamespace(client);
    this.favorites = new FavoritesNamespace(client);
    this.foreignEntities = new ForeignEntityNamespace(client);
    this.forms = new FormNamespace(client);
    this.notifications = new NotificationNamespace(client);
    this.pins = new PinsNamespace(client);
    this.projects = new ProjectNamespace(client);
    this.properties = new PropertiesNamespace(client);
    this.tasks = new TaskNamespace(client);
    this.teams = new TeamNamespace(client);
    this.users = new UserNamespace(client);
    this.webhooks = new WebhooksNamespace(client);
    this.workspace = new WorkspaceNamespace(client);
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

export type { FoldedAgentSessionLog } from './entities/agent-sessions/agent-session';
export type { CodeResult } from './entities/agent-sessions/code-execution';
export {
  AgentConversation,
  ConversationTurn,
} from './entities/agent-sessions/conversation';
export type {
  CreateReviewOptions,
  ReviewCalendarDraft,
  ReviewEmailDraft,
} from './entities/agent-sessions/review';
export { ReviewItem, SessionReview } from './entities/agent-sessions/review';
export { ToolApproval } from './entities/agent-sessions/tool-approval';
export { Agent, type AgentOptions } from './entities/agents/agent';
export { UserApiKey } from './entities/api-keys/api-key';
export { ChannelAccessRequest } from './entities/channels/access-request';
export { ChannelActivity } from './entities/channels/activity';
export { ChannelPicture } from './entities/channels/picture';
export { ChatGeneration, ChatMessage } from './entities/chats/generation';
export {
  CrmPipeline,
  PipelineColumn,
  PipelineRow,
  PipelineTable,
} from './entities/crm/pipeline';
export type {
  DatabaseQueryOptions,
  DatabaseQueryResult,
  QueryColumn,
  QueryResultSet,
  QueryStatement,
  QueryTableVersion,
} from './entities/databases/query';
export { DocumentAnchor } from './entities/documents/anchor';
export { DocumentVersion } from './entities/documents/version';
export {
  DraftAttachment,
  type DraftOptions,
  EmailDraft,
} from './entities/email/draft';
export { EmailFilter, type EmailFilterOptions } from './entities/email/filter';
export { EntityMention } from './entities/entity-mentions/mention';
export {
  GithubPullRequest,
  PullRequestChangeset,
} from './entities/github-pull-requests/pull-request';
export { Harness } from './entities/harnesses/harness';
export { DevicePairing, HarnessPairing } from './entities/harnesses/pairing';
export {
  Initiative,
  type InitiativeOptions,
} from './entities/initiatives/initiative';
export { Meeting } from './entities/meetings/meeting';
export type { TimelineOptions } from './entities/messages/thread';
export { type MessageParent, MessageThread } from './entities/messages/thread';
export type { EntityReference } from './entities/reference';
export type {
  RoutineEventFilter,
  RoutineTriggerOptions,
  SingleRoutineTrigger,
} from './entities/routines/routine';
export {
  Routine,
  RoutineExecution,
  type RoutineOptions,
} from './entities/routines/routine';
export { AccessRequest, EntityAccess } from './entities/sharing/access';
export type { SharePermissionOptions } from './entities/sharing/permissions';
export type {
  WorkspaceFilters,
  WorkspaceItem,
  WorkspaceListOptions,
  WorkspacePage,
  WorkspacePageOptions,
  WorkspaceTag,
  WorkspaceType,
} from './entities/workspace/types';
