import type { MacroOpts } from './config';
import { AccountManagerNamespace } from './entities/account-managers/namespace';
import { ActivityNamespace } from './entities/activity/namespace';
import { AgentSessionNamespace } from './entities/agent-sessions/namespace';
import { AgentNamespace } from './entities/agents/namespace';
import { AiNamespace } from './entities/ai/namespace';
import { ApiKeyNamespace } from './entities/api-keys/namespace';
import { BotsNamespace } from './entities/bots/namespace';
import { CalendarNamespace } from './entities/calendar/namespace';
import { CallRecordNamespace } from './entities/calls/namespace';
import { ChannelNamespace } from './entities/channels/namespace';
import { ChatNamespace } from './entities/chats/namespace';
import { ConnectedAppNamespace } from './entities/connected-apps/namespace';
import { CrmNamespace } from './entities/crm/namespace';
import { DatabaseNamespace } from './entities/databases/namespace';
import { DocumentNamespace } from './entities/documents/namespace';
import { EmailNamespace } from './entities/email/namespace';
import { EntityMentionNamespace } from './entities/entity-mentions/namespace';
import { ExternalChatsNamespace } from './entities/external-chat/namespace';
import { FavoritesNamespace } from './entities/favorites/namespace';
import { ForeignEntityNamespace } from './entities/foreign/namespace';
import { FormNamespace } from './entities/forms/namespace';
import { GithubPullRequestNamespace } from './entities/github-pull-requests/namespace';
import { HarnessNamespace } from './entities/harnesses/namespace';
import { ImagesNamespace } from './entities/images/namespace';
import { InitiativeNamespace } from './entities/initiatives/namespace';
import { MeNamespace } from './entities/me/namespace';
import { MeetingNamespace } from './entities/meetings/namespace';
import { MemoryNamespace } from './entities/memory/namespace';
import { NotificationNamespace } from './entities/notifications/namespace';
import { PinsNamespace } from './entities/pins/namespace';
import { ProjectNamespace } from './entities/projects/namespace';
import { PropertiesNamespace } from './entities/properties/namespace';
import { ReferralNamespace } from './entities/referrals/namespace';
import { RoutineNamespace } from './entities/routines/namespace';
import { SavedViewsNamespace } from './entities/saved-views/namespace';
import { SearchNamespace } from './entities/search/namespace';
import { TaskNamespace } from './entities/tasks/namespace';
import { TeamNamespace } from './entities/teams/namespace';
import { UnfurlNamespace } from './entities/unfurls/namespace';
import { UserNamespace } from './entities/users/namespace';
import type { User } from './entities/users/user';
import { WebNamespace } from './entities/web/namespace';
import { WebhooksNamespace } from './entities/webhooks/namespace';
import { WhatsAppNamespace } from './entities/whatsapp/namespace';
import { WorkspaceNamespace } from './entities/workspace/namespace';
import type { MacroEvents } from './events/receiver';
import { MacroClient } from './utils/client';

export type { MacroOpts } from './config';
export type {
  ActivityAction,
  ActivityEvent,
  ActivityRange,
} from './entities/activity/namespace';
export { CodeExecution } from './entities/agent-sessions/code-execution';
export type {
  DecisionRequest,
  DecisionResponse,
  StructuredCompletionRequest,
  StructuredCompletionResponse,
} from './entities/ai/namespace';
export { CallRecord } from './entities/calls/call-record';
export { CallConnection, type JoinOptions } from './entities/calls/connection';
export {
  AlreadyConnectedError,
  CallEndedError,
  InOtherCallError,
} from './entities/calls/errors';
export type { CallMessage } from './entities/calls/message';
export type { CallSummary } from './entities/calls/namespace';
export { CallParticipant } from './entities/calls/participant';
export {
  ConnectedApp,
  ConnectedTool,
} from './entities/connected-apps/connected-app';
export { Connector } from './entities/connected-apps/connector';
export { ConnectedAppNamespace } from './entities/connected-apps/namespace';
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
  type SavedFormResponse,
} from './entities/forms/form';
export { FormOption, FormQuestion } from './entities/forms/question';
export { FormResponse } from './entities/forms/response';
export { FormSection } from './entities/forms/section';
export type { CreatedEntity } from './entities/routines/namespace';
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
/**
 * The authenticated SDK client; every namespace hangs off it.
 *
 * @routing Use when a request is only about the Macro SDK client itself or its shared plumbing, such as live events or an item's access requests; not any request about the user's content, people or settings.
 */
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

  /** accountManagers resources and operations. */
  readonly accountManagers: AccountManagerNamespace;

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

  /** Chats from external providers (WhatsApp) added to Macro: read, share and send. */
  readonly externalChats: ExternalChatsNamespace;

  /** The current user's WhatsApp account and chat list; add chats from it. */
  readonly whatsapp: WhatsAppNamespace;

  readonly chats: ChatNamespace;

  readonly crm: CrmNamespace;

  readonly databases: DatabaseNamespace;

  readonly documents: DocumentNamespace;

  readonly email: EmailNamespace;

  /** Call the user's connected apps and MCP servers from a code execution. */
  readonly connectedApps: ConnectedAppNamespace;

  readonly favorites: FavoritesNamespace;

  readonly foreignEntities: ForeignEntityNamespace;

  /** Build forms and submit answers without granting respondents database access. */
  readonly forms: FormNamespace;

  /** Generate images with AI and attach them to messages. */
  readonly images: ImagesNamespace;
  /** Search the public web and read web pages. */
  readonly web: WebNamespace;

  /** The acting user's private explicit memory. */
  readonly memory: MemoryNamespace;

  /** The acting user's own action history. */
  readonly activity: ActivityNamespace;
  /** Your own profile: set your name and profile picture. */
  readonly me: MeNamespace;

  readonly notifications: NotificationNamespace;

  readonly pins: PinsNamespace;

  readonly projects: ProjectNamespace;

  readonly properties: PropertiesNamespace;

  /** Share the caller's referral link and email invites to join Macro. */
  readonly referrals: ReferralNamespace;

  /** Saved views: named filter definitions shown in a surface's sidebar, such as Email. */
  readonly savedViews: SavedViewsNamespace;

  readonly tasks: TaskNamespace;

  /** Search every kind of item at once: documents, email, channels, calls, events, sessions and chats. */
  readonly search: SearchNamespace;

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
    this.accountManagers = new AccountManagerNamespace(client);
    this.me = new MeNamespace(client);
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
    this.externalChats = new ExternalChatsNamespace(client);
    this.whatsapp = new WhatsAppNamespace(client);
    this.chats = new ChatNamespace(client);
    this.crm = new CrmNamespace(client);
    this.databases = new DatabaseNamespace(client);
    this.documents = new DocumentNamespace(client);
    this.email = new EmailNamespace(client);
    this.connectedApps = new ConnectedAppNamespace(client);
    this.favorites = new FavoritesNamespace(client);
    this.foreignEntities = new ForeignEntityNamespace(client);
    this.forms = new FormNamespace(client);
    this.images = new ImagesNamespace(client);
    this.web = new WebNamespace(client);
    this.memory = new MemoryNamespace(client);
    this.activity = new ActivityNamespace(client);
    this.notifications = new NotificationNamespace(client);
    this.pins = new PinsNamespace(client);
    this.projects = new ProjectNamespace(client);
    this.properties = new PropertiesNamespace(client);
    this.referrals = new ReferralNamespace(client);
    this.savedViews = new SavedViewsNamespace(client);
    this.search = new SearchNamespace(client);
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
   *
   * @readonly
   */
  myPrincipalId(): Promise<string> {
    return this._client.myPrincipalId();
  }

  /** Clone of this SDK acting on behalf of `user` (sent as
   * `x-macro-bot-for-macro-user-id`). Bot auth only — throws for user auth,
   * since a user token always acts as its own user.
   *
   * @readonly
   * @mcp-exclude Returns a new SDK client, which an MCP result cannot carry.
   */
  requestedAs(user: User): Macro<T> {
    return new Macro({ ...this.opts, requestedAs: user.id });
  }
}

export {
  type AgentActivity,
  type AgentActivityOptions,
  AgentInvocation,
} from './entities/agent-sessions/activity';
export type {
  AgentSessionUpdate,
  AgentSessionUpdates,
  ArchiveCause,
  AutoArchiveOverrides,
  FoldedAgentSessionLog,
  LinkedTask,
  PendingToolApproval,
  SessionAutoArchive,
} from './entities/agent-sessions/agent-session';
export type { CodeResult } from './entities/agent-sessions/code-execution';
export {
  AgentConversation,
  ConversationTurn,
} from './entities/agent-sessions/conversation';
export type {
  SessionOrigin,
  SessionOriginCaller,
  SessionOriginLineage,
  SessionOriginRoot,
} from './entities/agent-sessions/origin';
export type {
  CreateReviewOptions,
  ReviewCalendarDraft,
  ReviewDraft,
  ReviewEmailDraft,
} from './entities/agent-sessions/review';
export { ReviewItem, SessionReview } from './entities/agent-sessions/review';
export { ToolApproval } from './entities/agent-sessions/tool-approval';
export type { SessionView } from './entities/agent-sessions/view';
export {
  Agent,
  type AgentApps,
  type AgentOptions,
  type AgentPatch,
} from './entities/agents/agent';
export type { CodingAgent } from './entities/agents/namespace';
export { UserApiKey } from './entities/api-keys/api-key';
export {
  Bot,
  type BotOwner,
  type BotWebhook,
  type CreateBotOptions,
  type UpdateBotOptions,
} from './entities/bots/bot';
export { BotToken } from './entities/bots/token';
export {
  Canvas,
  type CanvasApplyOptions,
  type CanvasApplyResult,
  type CanvasBounds,
  type CanvasEditOptions,
  CanvasEditRejectedError,
  type CanvasEditResult,
  CanvasRenderImage,
  type CanvasRenderObject,
  type CanvasRenderOptions,
  CanvasRevisionConflictError,
  type CanvasScene,
  type CanvasSceneItem,
  type CanvasSceneOptions,
  type CanvasTextLayout,
  type CanvasUnavailable,
} from './entities/canvases/canvas';
export { ChannelAccessRequest } from './entities/channels/access-request';
export { ChannelActivity } from './entities/channels/activity';
export { ChannelPicture } from './entities/channels/picture';
export { ChatGeneration, ChatMessage } from './entities/chats/generation';
export type {
  ConnectedAppKind,
  ConnectedToolResult,
} from './entities/connected-apps/connected-app';
export type {
  ConnectorAction,
  ConnectorInspection,
} from './entities/connected-apps/connector';
export type { ConnectMcpServerResponse } from './entities/connected-apps/namespace';
export {
  CrmPipeline,
  PipelineColumn,
  PipelineRow,
  type PipelineStageRequirement,
  PipelineTable,
  PipelineView,
} from './entities/crm/pipeline';
export {
  type CompanyImport,
  PipelineEntry,
  type PipelineField,
  type PipelineFieldChange,
  type PipelineFieldInput,
  type PipelineFieldInputs,
  type PipelineFieldTotal,
  type PipelineFieldValue,
  type PipelineImport,
  type PipelineImportSkip,
  type PipelineOptionCounts,
  type PipelineRecordInput,
} from './entities/crm/pipeline-entry';
export type {
  DatabaseQueryOptions,
  DatabaseQueryResult,
  QueryColumn,
  QueryResultSet,
  QueryStatement,
  QueryTableVersion,
} from './entities/databases/query';
export {
  SAVED_QUERY_CHART_MODES,
  SAVED_QUERY_HEIGHT_RANGE,
  SAVED_QUERY_MAX_SERIES,
  SavedQuery,
  type SavedQueryChart,
  type SavedQueryChartMode,
  type SavedQueryDisplay,
  type SavedQueryDisplayMode,
  type SavedQueryView,
  type SaveQueryOptions,
} from './entities/databases/saved-query';
export {
  type DocumentEditOptions,
  DocumentEditRefusedError,
  type DocumentEditResult,
  EditOutcomeUnknownError,
} from './entities/documents/ai-edit';
export { DocumentAnchor } from './entities/documents/anchor';
export {
  DocumentChangedError,
  type DocumentMarkdown,
  type DocumentMarkdownWritten,
  type SetContentOptions,
} from './entities/documents/markdown';
export type { FileContent } from './entities/documents/namespace';
export {
  CommentQuoteNotPlacedError,
  type TextComment,
  type TextCommentOptions,
} from './entities/documents/text-comment';
export { DocumentVersion } from './entities/documents/version';
export {
  DraftAttachment,
  type DraftOptions,
  type DraftSendOptions,
  EmailDraft,
} from './entities/email/draft';
export { EmailFilter, type EmailFilterOptions } from './entities/email/filter';
export { EntityMention } from './entities/entity-mentions/mention';
export {
  ExternalChat,
  type ExternalChatContent,
} from './entities/external-chat/chat';
export { ExternalChatMessage } from './entities/external-chat/message';
export { ExternalChatParticipant } from './entities/external-chat/participant';
export { ExternalChatSend } from './entities/external-chat/send';
export { ExternalChatUpload } from './entities/external-chat/upload';
export {
  GithubPullRequest,
  PullRequestChangeset,
} from './entities/github-pull-requests/pull-request';
export { Harness } from './entities/harnesses/harness';
export { DevicePairing, HarnessPairing } from './entities/harnesses/pairing';
export { GeneratedImage, StaticImage } from './entities/images/image';
export type {
  GenerateImageAspectRatio,
  GenerateImageOptions,
} from './entities/images/namespace';
export {
  Initiative,
  type InitiativeActivityEntry,
  type InitiativeOptions,
} from './entities/initiatives/initiative';
export type {
  InitiativeListing,
  InitiativeListOptions,
  InitiativePriority,
  InitiativeStatus,
  InitiativeSummary,
} from './entities/initiatives/namespace';
export {
  MeNamespace,
  type UpdateMeOptions,
  type UploadProfilePictureOptions,
} from './entities/me/namespace';
export { Meeting } from './entities/meetings/meeting';
export type {
  ExplicitMemory,
  MemoryEdit,
} from './entities/memory/namespace';
export type { TimelineOptions } from './entities/messages/thread';
export { type MessageParent, MessageThread } from './entities/messages/thread';
export type { EntityReference } from './entities/reference';
export type { ReferralLink } from './entities/referrals/namespace';
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
export {
  SavedView,
  type SavedViewConfig,
} from './entities/saved-views/saved-view';
export type { SearchOn, SearchOpts } from './entities/search/options';
export type {
  SearchOptions,
  SearchPage,
  SearchPageOptions,
  SearchResult,
  SearchType,
} from './entities/search/types';
export { AccessRequest, EntityAccess } from './entities/sharing/access';
export type { SharePermissionOptions } from './entities/sharing/permissions';
export {
  RevisionConflictError,
  Spreadsheet,
  type SpreadsheetCalculateOptions,
  type SpreadsheetCalculation,
  type SpreadsheetEdited,
  type SpreadsheetEditOptions,
  type SpreadsheetRead,
  type SpreadsheetReadOptions,
  type SpreadsheetSheet,
} from './entities/spreadsheets/spreadsheet';
export type { TaskSummary } from './entities/tasks/task';
export { TeamInvite } from './entities/teams/invite';
export {
  ExternalProfilePicture,
  type ProfilePicture,
} from './entities/users/profile-picture';
export type { ActivityReport } from './entities/users/user';
export type {
  WebFetchOptions,
  WebFetchResponse,
  WebSearchOptions,
  WebSearchResult,
  WebSearchTopic,
} from './entities/web/namespace';
export { WhatsAppAccount } from './entities/whatsapp/account';
export {
  WhatsAppChat,
  type WhatsAppCommunity,
} from './entities/whatsapp/chat';
export type {
  WorkspaceFilters,
  WorkspaceItem,
  WorkspaceListOptions,
  WorkspacePage,
  WorkspacePageOptions,
  WorkspaceTag,
  WorkspaceType,
} from './entities/workspace/types';
