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
  'deleteTeamInviteHandler',
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
  'getReferralCode',
  // Renewal and scheduled-plan details are part of the app's billing settings.
  'getSubscriptionStatus',
  'getTeamByInviteLink',
  'getTeamInviteLink',
  'getTeamInvites',
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
  'inviteToTeam',
  'joinTeam',
  'joinTeamByInviteLink',
  'listCodexEnvironments',
  'listCursorModels',
  'listGtmInviteLinks',
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
  'postProfilePictures',
  'putAgentApiKey',
  'putCursorApiKey',
  'putCursorDefaultModel',
  'putProfilePicture',
  'putUserLanguage',
  'putUserName',
  'redeemGtmInviteLink',
  'refresh',
  'rejectInvitation',
  'removeUserFromTeam',
  'resendFusionauthVerifyUserEmail',
  'resolveGtmInviteLink',
  'revokeGtmInviteLink',
  'sendMobileWelcomeEmail',
  'sendReferralCode',
  'sessionCreation',
  'sessionLogin',
  'setGithubPullRequestDraft',
  'setGithubPullRequestState',
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
  'completePipedreamMcpConnection',
  'createPipedreamMcpToken',
  'deletePipedreamMcpConnection',
  'deleteMcpServer',
  'getBatchPreview',
  'getChatHistoryBatchMessagesHandler',
  'getChatPermissions',
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
  'removeUnsubscribeItem',
  'unsubscribeAll',
  'unsubscribeEmail',
  'unsubscribeItem',
] as const satisfies readonly (keyof NotificationSdk)[];

export const notificationBacklog =
  [] as const satisfies readonly (keyof NotificationSdk)[];

export const propertiesExcluded = [
  'ensureTagSet',
  'mergeTag',
  'promoteTag',
] as const satisfies readonly (keyof PropertiesSdk)[];

export const propertiesBacklog =
  [] as const satisfies readonly (keyof PropertiesSdk)[];

export const scheduledActionExcluded = [
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
  'checkActiveCall',
  'createChannelScopedBot',
  'createCollabSurfaceToken',
  'createInstructionsHandler',
  'createViewHandler',
  // Declining a ringing call is a live-device session flow, like leaving.
  'declineCall',
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
  'getBatchCallRecordPreview',
  'getBatchChannelPreview',
  'getActiveCalls',
  'getBatchProjectPreview',
  'getBotOwnerProfiles',
  'getCollabSurface',
  // Storage for the web app's saved questions, not a user-facing surface.
  'getDatabaseQuery',
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
  'leaveOrEndCall',
  // Live meeting admission and participant previews are app session flows.
  'meetingGuestJoin',
  // Browser setup reserves an empty RTC room before creating a meeting.
  'meetingPrepare',
  'meetingCancelPreparation',
  'meetingGuestParticipants',
  'meetingJoin',
  'meetingLeave',
  'meetingParticipants',
  'mentionPreviews',
  'patchViewHandler',
  'postItemsSoup',
  'postItemsSoupAstGrouped',
  'removeBotFromChannelByBot',
  // Storage for the web app's saved questions, not a user-facing surface.
  'saveDatabaseQuery',
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
  'whatsappPairing',
  'whatsappPasskey',
] as const satisfies readonly (keyof StorageSdk)[];

export const storageBacklog =
  [] as const satisfies readonly (keyof StorageSdk)[];

export const unfurlExcluded = [
  'proxyRequestHandler',
] as const satisfies readonly (keyof UnfurlSdk)[];

export const unfurlBacklog = [] as const satisfies readonly (keyof UnfurlSdk)[];
