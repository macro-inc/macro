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

import type { Sdk as AgentProxySdk } from '../../generated/agent-proxy/sdk.gen';
import type { Sdk as AuthSdk } from '../../generated/auth/sdk.gen';
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

export const agentProxyExcluded = [
  'agentProxyHealth',
] as const satisfies readonly (keyof AgentProxySdk)[];

export const agentProxyBacklog =
  [] as const satisfies readonly (keyof AgentProxySdk)[];

export const authExcluded = [
  'appleLogin',
  'checkGithubLinkStatus',
  'checkGmailLinkStatus',
  'createCheckoutSessionV2',
  'createInProgressLink',
  'createMergeRequest',
  'createPortalSession',
  'createTeam',
  'createUser',
  'deleteGithubLink',
  'deleteTeam',
  'deleteTeamInviteHandler',
  'deleteUser',
  'enrichGithubPullRequests',
  'generateEmailLink',
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
  'inviteToTeam',
  'joinTeam',
  'logout',
  'oauth2Callback',
  'oauthRedirect',
  'passwordLogin',
  'passwordlessCallback',
  'passwordlessLogin',
  'patchTeam',
  'patchTeamCrmSettings',
  'patchUserGroup',
  'patchUserOnboarding',
  'patchUserTutorial',
  'postProfilePictures',
  'putProfilePicture',
  'putUserName',
  'refresh',
  'rejectInvitation',
  'removeUserFromTeam',
  'resendFusionauthVerifyUserEmail',
  'sendMobileWelcomeEmail',
  'sendReferralCode',
  'sessionCreation',
  'sessionLogin',
  'ssoLogin',
  'toggleTeamAutoJoinDomain',
  'toggleTeamNonAdminInvites',
  'verifyEmailLink',
  'verifyFusionauthUserEmail',
  'verifyMergeRequest',
] as const satisfies readonly (keyof AuthSdk)[];

export const authBacklog = [
  'macroApiToken',
] as const satisfies readonly (keyof AuthSdk)[];

export const cognitionExcluded = [
  'addMcpServer',
  'callTool',
  'deleteMcpServer',
  'getBatchPreview',
  'getChatHistoryBatchMessagesHandler',
  'getChatPermissions',
  'getChatsForAttachmentHandler',
  'getCitationHandler',
  'getMemoryHandler',
  'healthHandler',
  'listMcpServers',
  'mcpAuthCallback',
  'mcpOauthClientMetadata',
  'rejectToolCall',
  'runImportHandler',
  'dismissRunHandler',
  'retryGatherHandler',
  'getStateHandler',
  'getStateHandler2',
  'completeHandler',
  'setPricingHandler',
  'startMcpAuth',
  'updateMcpServer',
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
  'createCalendarEvent',
  'createDraft',
  'deleteCalendarEvent',
  'deleteDraft',
  'deleteEmailFilter',
  'deleteScheduledDraft',
  'getScheduledMessages',
  'listCalendars',
  'listContacts',
  'listEmailFilters',
  'removeDraftAttachment',
  'removeForwardedAttachment',
  'rsvpCalendarEvent',
  'updateCalendarEvent',
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
  'listScheduledActionHistory',
  'listScheduledActions',
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
  'bulkWakeupSyncServiceDocuments',
  'callWebhook',
  'checkActiveCall',
  'createChannelScopedBot',
  'createInstructionsHandler',
  'createViewHandler',
  'deleteAgentSession',
  'deleteHistoryHandler',
  'deleteUserDocumentViewLocation',
  'deleteViewHandler',
  'excludeDefaultViewHandler',
  'getAgentSession',
  'getAttachmentReferences',
  'getBatchCallRecordPreview',
  'getBatchChannelPreview',
  'getBatchPreviewHandler',
  'getBatchProjectPreview',
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
  'joinChannelByCode',
  'jobProcessingResultHandler',
  'leaveOrEndCall',
  'patchViewHandler',
  'postChannelBotWebhook',
  'postChannelMessages',
  'postItemsSoup',
  'postItemsSoupAst',
  'postItemsSoupAstGrouped',
  'removeBotFromChannelByBot',
  'resolveChannelMessage',
  'updateAgentSession',
  'uploadExtractFolderHandler',
  'uploadFolderHandler',
  'upsertHistoryHandler',
  'upsertUserDocumentViewLocation',
] as const satisfies readonly (keyof StorageSdk)[];

export const storageBacklog = [
  'createAnchor',
  'createDocument',
  'createEntityMention',
  'createReminder',
  'deleteAnchor',
  'deleteEntityMention',
  'deleteReminder',
  'editAnchor',
  'editCallTranscript',
  'editThreadV2',
  'getActivity',
  'getDocumentAnchors',
  'getDocumentByTeamSlug',
  'getDocumentPermissionsToken',
  'getDocumentPermissionsV2',
  'getDocumentVersion',
  'getEntityPermission',
  'getProjectPermissionsV2',
  'getProjectUserAccessLevel',
  'getRecentActivityHandler',
  'getReminder',
  'listOccurrences',
  'listReminders',
  'postActivity',
  'presaveDocumentHandler',
  'saveDocumentHandler',
  'simpleSave',
  'toggleShareWithTeam',
  'updateReminder',
  'validateDocumentPermissionsToken',
] as const satisfies readonly (keyof StorageSdk)[];

export const unfurlExcluded = [
  'proxyRequestHandler',
] as const satisfies readonly (keyof UnfurlSdk)[];

export const unfurlBacklog = [
  'getUnfurl',
  'getUnfurlBulk',
] as const satisfies readonly (keyof UnfurlSdk)[];
