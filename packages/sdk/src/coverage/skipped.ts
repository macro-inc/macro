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
  // Claude Cloud sign-in is an app-internal auth flow, not SDK surface.
  'complete',
  'disconnect',
  'start',
  'status',
  'loadAgentModelsHandler',
  'discoverAgentCapabilitiesHandler',
  'previewAgentSessions',
  // Batch form of agentSessionsForPullRequest that feeds the web Reviews list.
  'agentSessionsForPullRequests',
  // Speculative page warm-up requires a signed-in user and is app-internal.
  'warmAgentSessionHandler',
] as const satisfies readonly (keyof AgentHarnessSdk)[];

export const agentHarnessBacklog = [
  'answerAgentSessionToolApproval',
  'getAgentSessionPermissions',
  'updateAgentSessionPermissions',
] as const satisfies readonly (keyof AgentHarnessSdk)[];

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
  'createUser',
  'deleteCursorApiKey',
  'deleteGithubLink',
  'deleteTeam',
  'deleteTeamInviteHandler',
  'deleteUser',
  'disconnectCodex',
  'enrichGithubPullRequests',
  'generateEmailLink',
  'getAiBillingPlans',
  'getAiBillingSummary',
  'getCodexConnection',
  'getCursorApiKey',
  'getGtmInviteOffer',
  'getLegacyUserPermissions',
  'getPermissions',
  'getReferralCode',
  'getTeamInvites',
  'getUserInvites',
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
  'putCursorApiKey',
  'putCursorDefaultModel',
  'putProfilePicture',
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

export const authBacklog = [
  'macroApiToken',
] as const satisfies readonly (keyof AuthSdk)[];

export const calendarExcluded = [
  // Health probe is infra, not SDK surface.
  'healthHandler',
] as const satisfies readonly (keyof CalendarSdk)[];

export const calendarBacklog = [
  // Team sharing and availability preferences use the generated client for now.
  'getAvailabilityCalendars',
  'getTeamSharing',
  'setAvailabilityCalendar',
  'setTeamSharing',
] as const satisfies readonly (keyof CalendarSdk)[];

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
  'mcpAuthCallback',
  'mcpOauthClientMetadata',
  'rejectToolCall',
  // Channel discovery shares the app-only import workflow below.
  'discoverHandler',
  'runImportHandler',
  'dismissRunHandler',
  'retryGatherHandler',
  'getStateHandler',
  'getStateHandler2',
  'completeHandler',
  'setPricingHandler',
  'startMcpAuth',
  'updateMcpServer',
  'updatePipedreamMcpConnection',
  'updateToolCall',
  'updateToolResponse',
  'upsertAiProjection',
] as const satisfies readonly (keyof CognitionSdk)[];

export const cognitionBacklog = [
  'getUsageHandler',
  'sendChatMessage',
  'stopChatStream',
  'structuredCompletion',
] as const satisfies readonly (keyof CognitionSdk)[];

export const connectionExcluded = [
  'batchSendMessageHandler',
  'getEntityHandler',
  'sendMessageHandler',
] as const satisfies readonly (keyof ConnectionSdk)[];

export const connectionBacklog =
  [] as const satisfies readonly (keyof ConnectionSdk)[];

export const contactsExcluded = [
  'addContact',
  'getContacts',
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
  'addDraftAttachment',
  'addForwardedAttachment',
  'createDraft',
  'deleteDraft',
  'deleteEmailFilter',
  'deleteScheduledDraft',
  'getScheduledMessages',
  'getThreadCalendarInvitations',
  'listContacts',
  'listEmailFilters',
  'removeDraftAttachment',
  'removeForwardedAttachment',
  'upsertEmailFilter',
  'upsertScheduledMessage',
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

export const scheduledActionBacklog = [
  'createScheduledAction',
  'deleteScheduledAction',
  'executeScheduledActionNow',
  'getScheduledAction',
  'listScheduledActionHistory',
  'listScheduledActions',
  'setScheduledActionEnabled',
  'updateScheduledAction',
] as const satisfies readonly (keyof ScheduledActionSdk)[];

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
  'deleteCollabSurface',
  'ensureCollabSurface',
  // First-run sample content is provisioned by the app's feature-gated onboarding.
  'ensureStarterHandler',
  'deleteHistoryHandler',
  'deleteUserDocumentViewLocation',
  'deleteViewHandler',
  // Old numeric comment links resolve inside the web app only.
  'entityMessageLegacy',
  'excludeDefaultViewHandler',
  'getAttachmentReferences',
  'getBatchCallRecordPreview',
  'getBatchChannelPreview',
  'getBatchPreviewHandler',
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
  'postItemsSoupAst',
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
] as const satisfies readonly (keyof StorageSdk)[];

export const storageBacklog = [
  // Email follow-ups are available through the generated client.
  'getEmailFollowup',
  'setEmailFollowup',
  'listEmailReminders',
  // CRM pipelines fit the crm namespace but are not wrapped yet.
  'createCrmPipeline',
  'applyCrmPipelineOps',
  'getCrmPipeline',
  'getCrmPipelineRows',
  'queryCrmPipelineRows',
  'getCrmPipelineTable',
  'listCrmPipelines',
  'renameCrmPipeline',
  'shareCrmPipeline',
  'trashCrmPipeline',
  'approveHarnessPairing',
  'claimHarnessPairing',
  'createAgent',
  'createAnchor',
  'createDocument',
  'createEntityMention',
  'createHarnessPairing',
  'createInitiative',
  'createUserApiKey',
  'deleteAnchor',
  'deleteEntityMention',
  'deleteHarness',
  'deleteInitiative',
  'deleteSelfHarness',
  'deleteUserApiKey',
  'editAnchor',
  'editCallTranscript',
  'editThreadV2',
  'entityMessageDeleteThread',
  'entityMessagePatchThread',
  'getActivity',
  'getDocumentAnchors',
  'getDocumentByTeamSlug',
  'getDocumentPermissionsToken',
  'getDocumentPermissionsV2',
  'getDocumentVersion',
  'getEntityPermission',
  'getGithubPullRequest',
  'getGithubPullRequestChanges',
  'getGithubPullRequestChangesPatch',
  'getProjectPermissionsV2',
  'getProjectUserAccessLevel',
  'getHarnessPairing',
  'getInitiative',
  'getSelfHarness',
  'listAgents',
  'listHarnessAgents',
  'listHarnessSessions',
  'listHarnesses',
  'listInitiatives',
  'listOccurrences',
  // Read-only team projections use the generated client for now.
  'listTeamCalendar',
  'listTeamOutOfOffice',
  'listUserApiKeys',
  // Meeting management uses the generated client.
  'meetingCancel',
  'meetingCreate',
  'meetingInvite',
  'meetingInvitePermissions',
  'meetingInviteUsers',
  'meetingList',
  'meetingListActive',
  'meetingLookup',
  'meetingShare',
  'meetingUpdate',
  'postActivity',
  'presaveDocumentHandler',
  'saveDocumentHandler',
  'setChannelPicture',
  'simpleSave',
  'toggleShareWithTeam',
  'updateAgent',
  'updateInitiative',
  'validateDocumentPermissionsToken',
] as const satisfies readonly (keyof StorageSdk)[];

export const unfurlExcluded = [
  'proxyRequestHandler',
] as const satisfies readonly (keyof UnfurlSdk)[];

export const unfurlBacklog = [
  'getUnfurl',
  'getUnfurlBulk',
] as const satisfies readonly (keyof UnfurlSdk)[];
