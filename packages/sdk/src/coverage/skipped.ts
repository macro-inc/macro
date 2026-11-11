// Endpoints deliberately NOT wrapped by the hand-written SDK, split by intent:
//
//   <service>Excluded — policy: auth/session flows, infra, app internals.
//     These are not SDK surface and are expected to stay here.
//   <service>Backlog  — debt: endpoints that DO fit the SDK's entity model
//     but have not been wrapped yet. Wrapping one means deleting it here.
//
// Both lists are hand-maintained, on purpose — never generated. When the
// backend adds an endpoint, `just coverage` fails until you wrap it or type
// it into one of these lists by hand, as a conscious decision.

import type { Sdk as AgentHarnessSdk } from '../../generated/agent-harness/sdk.gen';
import type { Sdk as AuthSdk } from '../../generated/auth/sdk.gen';
import type { Sdk as CalendarSdk } from '../../generated/calendar/sdk.gen';
import type { Sdk as CognitionSdk } from '../../generated/cognition/sdk.gen';
import type { Sdk as ConnectionSdk } from '../../generated/connection/sdk.gen';
import type { Sdk as ContactsSdk } from '../../generated/contacts/sdk.gen';
import type { Sdk as EmailSdk } from '../../generated/email/sdk.gen';
import type { Sdk as NotificationSdk } from '../../generated/notification/sdk.gen';
import type { Sdk as PropertiesSdk } from '../../generated/properties/sdk.gen';
import type { Sdk as ScheduledActionSdk } from '../../generated/scheduled-action/sdk.gen';
import type { Sdk as SearchSdk } from '../../generated/search/sdk.gen';
import type { Sdk as StaticFilesSdk } from '../../generated/static-files/sdk.gen';
import type { Sdk as StorageSdk } from '../../generated/storage/sdk.gen';
import type { Sdk as UnfurlSdk } from '../../generated/unfurl/sdk.gen';

export const agentHarnessExcluded = [
  'classify', // Command K inference is app-internal.
  'extract', // Command K inference is app-internal.
  'loadAgentModelsHandler',
  'discoverAgentCapabilitiesHandler',
  'previewAgentSessions',
  // Batch form of agentSessionsForPullRequest that feeds the web Reviews list.
  'agentSessionsForPullRequests',
  // Speculative page warm-up requires a signed-in user and is app-internal.
  'warmAgentSessionHandler',
  // The connect chip's continuation after an app connects is app-internal.
  'reportAgentSessionAppConnected',
] as const satisfies readonly (keyof AgentHarnessSdk)[];

export const agentHarnessBacklog =
  [] as const satisfies readonly (keyof AgentHarnessSdk)[];

export const authExcluded = [
  'appleLogin',
  'cancelCodexLogin',
  'changePlan',
  'checkGithubLinkStatus',
  'checkGmailLinkStatus',
  'configureCodex',
  'createAiCreditCheckout',
  'createCheckoutSessionV2',
  'createGtmInviteLink',
  'createInProgressLink',
  'createMergeRequest',
  'createPortalSession',
  'createTeam',
  'createTeamInviteLink',
  // An agent's own API key is a credential managed in the app's agent settings.
  'deleteAgentApiKey',
  'deleteCursorApiKey',
  'deleteGithubLink',
  'deleteTeam',
  'deleteTeamInviteLink',
  'deleteUser',
  'disconnectCodex',
  'enrichGithubPullRequests',
  'generateEmailLink',
  'getAgentApiKey',
  'getAiBillingPlans',
  'getAiBillingSummary',
  'getCodexConnection',
  'getCursorApiKey',
  'getGithubPullRequestMergeability',
  'getGtmInviteOffer',
  'getLegacyUserPermissions',
  'getPermissions',
  // Renewal and scheduled-plan details are part of the app's billing settings.
  'getSubscriptionStatus',
  'getTeamByInviteLink',
  'getTeamInviteLink',
  'getSystemStatus',
  // Introductory offers belong to the app's subscription checkout flow.
  'getTrialEligibility',
  'getUserInvites',
  // The interface language is an app setting, not SDK surface.
  'getUserLanguage',
  'getUserLinkExists',
  'getUserName',
  'getUserNames',
  'getUserOrganization',
  'getUserPermissions',
  'getUserQuota',
  'healthHandler',
  'initGithubLink',
  'initGmailLink',
  'initOutlookLink',
  'joinTeam',
  'joinTeamByInviteLink',
  'listCodexEnvironments',
  'listCursorModels',
  'listGtmInviteLinks',
  'listSystemStatusHistory',
  'logout',
  'mergeGithubPullRequest',
  'oauth2Callback',
  'oauthRedirect',
  'passwordLogin',
  'passwordlessCallback',
  'passwordlessLogin',
  'patchTeam',
  'patchTeamCrmSettings',
  'patchTeamMemberPlan',
  'patchUserGroup',
  'patchUserOnboarding',
  'patchUserTutorial',
  'pollCodexLogin',
  'purchaseAiCredits',
  'putAgentApiKey',
  'putCursorApiKey',
  'putCursorDefaultModel',
  'putProfilePicture',
  // Internal to the web app's agent signup; the token is shown in its modal.
  'agentSetup',
  'putUserLanguage',
  'redeemGtmInviteLink',
  'refresh',
  'rejectInvitation',
  'removeUserFromTeam',
  'resendFusionauthVerifyUserEmail',
  'resolveGtmInviteLink',
  'revokeGtmInviteLink',
  'sendMobileWelcomeEmail',
  'sendTeamDomainNotice',
  'sessionCreation',
  'sessionLogin',
  'setGithubPullRequestDraft',
  'setGithubPullRequestState',
  'setSystemStatus',
  'ssoLogin',
  'startCodexLogin',
  'toggleTeamAutoJoinDomain',
  'toggleTeamNonAdminInvites',
  'updateAiBillingAutoReload',
  'updateAiBillingOverage',
  'verifyEmailLink',
  'verifyFusionauthUserEmail',
  'verifyMergeRequest',
];

export const authBacklog = [] as const satisfies readonly (keyof AuthSdk)[];

export const calendarExcluded = [
  // Health probe is infra, not SDK surface.
  'healthHandler',
  // Answering a request to join a channel-shared event is a web-app action.
  'respondToJoinRequest',
] as const satisfies readonly (keyof CalendarSdk)[];

export const calendarBacklog =
  [] as const satisfies readonly (keyof CalendarSdk)[];

export const cognitionExcluded = [
  'addMcpServer',
  'browsePipedreamMcpCatalog',
  'callTool',
  'completePipedreamMcpConnect',
  'completePipedreamMcpConnection',
  'createPipedreamMcpToken',
  'deletePipedreamMcpConnection',
  'deleteMcpServer',
  'getBatchPreview',
  'getChatHistoryBatchMessagesHandler',
  'getChatsForAttachmentHandler',
  'getCitationHandler',
  'getMemoryHandler',
  'healthHandler',
  'listMcpServers',
  'listPipedreamMcpConnections',
  'listPipedreamMcpOverlays',
  'mcpAuthCallback',
  'mcpOauthClientMetadata',
  'recoverPipedreamMcpConnection',
  'rejectToolCall',
  // Channel discovery shares the app-only import workflow below.
  'discoverHandler',
  'runImportHandler',
  // Workspace reports and cancel routes back the in-chat import review card.
  'notionReportHandler',
  'cancelNotionHandler',
  'cancelWorkspaceHandler',
  'workspaceReportHandler',
  'getStateHandler',
  'getStateHandler2',
  'completeHandler',
  // Sidebar setup and import cards remember dismissals per user (web app only).
  'dismissedPromptsHandler',
  'dismissPromptHandler',
  // Proposes SQL for the web app's in-browser engine to execute.
  'generateDatabaseQuery',
  'setPricingHandler',
  'startMcpAuth',
  'updateMcpServer',
  'updatePipedreamMcpConnection',
  'updateToolCall',
  'updateToolResponse',
  'upsertAiProjection',
] as const satisfies readonly (keyof CognitionSdk)[];

export const cognitionBacklog =
  [] as const satisfies readonly (keyof CognitionSdk)[];

export const connectionExcluded = [
  'batchSendMessageHandler',
  'broadcastMessageHandler',
  'getEntityHandler',
  'sendMessageHandler',
] as const satisfies readonly (keyof ConnectionSdk)[];

export const connectionBacklog =
  [] as const satisfies readonly (keyof ConnectionSdk)[];

export const contactsExcluded = [
  'addContact',
] as const satisfies readonly (keyof ContactsSdk)[];

export const contactsBacklog =
  [] as const satisfies readonly (keyof ContactsSdk)[];

export const emailExcluded = [
  'cancelBackfillGmail',
  'deleteLink',
  'disableLinkCalendar',
  'disableSync',
  'getBackfillGmail',
  'getBackfillGmailActive',
  'getMessagesBatch',
  'getReadReceiptPixel',
  'healthCheckLinks',
  'healthHandler',
  'initUser',
  'listBackfillGmail',
  'patchSettings',
  'resyncLink',
] as const satisfies readonly (keyof EmailSdk)[];

export const emailBacklog = [
  // Belongs on CalendarEvent beside inviteGuests; the first release keeps
  // forwarding to the app's own surfaces, since the SDK also reaches agents.
  'forwardCalendarEvent',
] as const satisfies readonly (keyof EmailSdk)[];

export const notificationExcluded = [
  'bulkGetTypedNotificationsByEventItemIds',
  'getTypedNotificationsByEventItemId',
  'getUnsubscribes',
  'healthHandler',
  'removeUnsubscribeAll',
  'removeUnsubscribeItems',
  'unsubscribeAll',
  'unsubscribeEmail',
  'unsubscribeItems',
] as const satisfies readonly (keyof NotificationSdk)[];

export const notificationBacklog =
  [] as const satisfies readonly (keyof NotificationSdk)[];

export const propertiesExcluded = [
  'mergeTag',
  'promoteTag',
] as const satisfies readonly (keyof PropertiesSdk)[];

export const propertiesBacklog =
  [] as const satisfies readonly (keyof PropertiesSdk)[];

export const scheduledActionExcluded = [
  'draftRoutine', // The routine editor's AI drafting; agents use CreateRoutine.
  'listScheduledActionCodeUpgrades', // The routine page's review of SDK upgrades.
  'routineCatalog', // The new-routine flow's templates.
  'listRoutineSuggestions', // The app's suggestion surfaces; agents use CreateRoutine.
  'generateRoutineSuggestions', // The app starts suggestions once the inbox connects.
  'dismissRoutineSuggestion', // The app's suggestion surfaces.
  'scheduledActionHealth',
] as const satisfies readonly (keyof ScheduledActionSdk)[];

export const scheduledActionBacklog =
  [] as const satisfies readonly (keyof ScheduledActionSdk)[];

export const searchExcluded = [
  'simpleUnifiedSearch',
] as const satisfies readonly (keyof SearchSdk)[];

export const searchBacklog = [] as const satisfies readonly (keyof SearchSdk)[];

export const staticFilesExcluded = [
  'getFileDocumentation',
  'handleBulkDeleteFile',
  'handleDeleteFile',
  'handleGetMetadata',
  'putPresignedUrl',
] as const satisfies readonly (keyof StaticFilesSdk)[];

export const staticFilesBacklog =
  [] as const satisfies readonly (keyof StaticFilesSdk)[];

export const storageExcluded = [
  // Opening a host to a team takes its owner's own session: an agent can ask for
  // access but never grant it.
  'setHarnessTeamAccess',
  // Asking to join a channel-shared event, and its sharer's request list,
  // are web-app actions.
  'listJoinRequests',
  'requestToJoin',
  // Browser Loro-session initialization/publication; SDK layout writes use putFormLayout.
  'collaborateForm',
  // Slack archive imports are browser-admin workflows, not SDK surface in v1.
  'cancelSlackImport',
  'completeSlackImportUploads',
  'createSlackImport',
  'finalizeSlackImport',
  'getSlackImport',
  'listSlackImports',
  'registerSlackImportUploads',
  'bulkWakeupSyncServiceDocuments',
  'callWebhook',
  'createChannelScopedBot',
  'createCollabSurfaceToken',
  'createInstructionsHandler',
  'createViewHandler',
  'declineRing',
  'deleteCollabSurface',
  'ensureCollabSurface',
  // First-run sample content is provisioned by the app's feature-gated onboarding.
  'ensureStarterHandler',
  'deleteHistoryHandler',
  'deleteUserDocumentViewLocation',
  'deleteViewHandler',
  // Called by third parties holding a webhook's URL; its token, not the
  // SDK's credentials, authenticates it.
  'deliverDatabaseWebhook',
  // Old numeric comment links resolve inside the web app only.
  'entityMessageLegacy',
  'excludeDefaultViewHandler',
  'getAttachmentReferences',
  'getBatchChannelPreview',
  'getActiveCalls',
  'getBatchProjectPreview',
  'getBotOwnerProfiles',
  'getCollabSurface',
  // The web grid's incremental refresh after a version ping, not a user-facing surface.
  'getDatabaseTableChanges',
  'getDocumentListHandler',
  'getDocumentLocationV3',
  'getDocumentProcessingResult',
  'getDocumentViewsHandler',
  'getHistoryHandler',
  'getInstructionsHandler',
  'getItemsSoup',
  'getLocationHandler',
  // Legacy GET can start and ring a call; SDK starts use POST.
  'getOrCreateCall',
  'getPendingProjectsHandler',
  'getProjectsHandler',
  'getRingStatus',
  'getUserDocumentViewLocation',
  'getViewsHandler',
  // Guest chat uses a live RTC session token, not SDK account credentials.
  'guestCallChatPost',
  'guestCallChatRead',
  'handler',
  'healthHandler',
  'ingestTranscript',
  'initializeUserDocuments',
  'installSync',
  'jobProcessingResultHandler',
  'joinChannelByCode',
  // Legacy channel-scoped leave could leave a newer call; SDK leaves by call id.
  'leaveOrEndCall',
  // Live participant previews and browser session cleanup remain app flows.
  // Browser setup reserves an empty RTC room before creating a meeting.
  'meetingPrepare',
  'meetingCancelPreparation',
  'meetingGuestParticipants',
  'meetingLeave',
  'meetingParticipants',
  'mentionPreviews',
  'patchViewHandler',
  'postItemsSoup',
  'postItemsSoupAstGrouped',
  // Live presence between viewers of a database, internal to the web app.
  'shareDatabaseAwareness',
  // Composer dictation is an app-internal, user-only upload flow.
  'transcribeDictation',
  // The web app's Ctrl+Z over the viewer's own session edits; the SDK's
  // applyOps does not surface the journal changes an undo names.
  'undoDatabaseChange',
  'uploadExtractFolderHandler',
  'uploadFolderHandler',
  'upsertHistoryHandler',
  'upsertUserDocumentViewLocation',
  // WhatsApp pairing, passkey handoff, and rollout configuration belong to the app session.
  'whatsappCancelPairing',
  'whatsappConnect',
  'whatsappDisconnect',
  // History imports and phone-number lookups need the owner's own session:
  // each wakes their phone, and WhatsApp bans bulk checks.
  'whatsappImportHistory',
  'whatsappLookup',
  'whatsappPairing',
  'whatsappPasskey',
  'whatsappStartLookup',
] as const satisfies readonly (keyof StorageSdk)[];

export const storageBacklog = [
  // CRM privacy settings use the generated client.
  'getCrmEmailPrivacy',
  'updateCrmEmailPrivacy',
] as const satisfies readonly (keyof StorageSdk)[];

export const unfurlExcluded = [
  'proxyRequestHandler',
] as const satisfies readonly (keyof UnfurlSdk)[];

export const unfurlBacklog = [] as const satisfies readonly (keyof UnfurlSdk)[];
