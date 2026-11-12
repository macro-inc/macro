/** Display verbs for SDK operations. These are the wire values, shared with Rust. */
export type SdkVerb =
  | 'created'
  | 'copied'
  | 'generated'
  | 'uploaded'
  | 'imported'
  | 'edited'
  | 'renamed'
  | 'moved'
  | 'reordered'
  | 'archived'
  | 'deleted'
  | 'restored'
  | 'shared'
  | 'unshared'
  | 'invited'
  | 'added'
  | 'removed'
  | 'linked'
  | 'unlinked'
  | 'sent'
  | 'posted'
  | 'reacted'
  | 'submitted'
  | 'scheduled'
  | 'cancelled'
  | 'confirmed'
  | 'approved'
  | 'rejected'
  | 'enabled'
  | 'disabled'
  | 'ran'
  | 'stopped'
  | 'joined'
  | 'left'
  | 'blocked'
  | 'unblocked'
  | 'labeled'
  | 'marked'
  | 'requested'
  | 'registered'
  | 'read'
  | 'listed'
  | 'searched'
  | 'queried'
  | 'checked';

// Every key is a generated method called by handwritten SDK code. Keep this
// explicit: HTTP method alone cannot distinguish a POST read from a write.
const methods: Record<string, Partial<Record<SdkVerb, string>>> = {
  'agent-harness': {
    read: `
      getAgentAutoArchivePreferences getAgentCodingPreferences getAgentSandboxSize getAgentSession
      getAgentSessionAutoArchive getAgentSessionChanges getAgentSessionChangesPatch getCodeExecution
      getAgentSessionLog getAgentSessionFoldedLog getAgentSessionPermissions getSessionReview
    `,
    listed: `
      listAgentConversations listAgentRepositories listAgentRepositoryBranches
      agentSessionsForPullRequest getAgentSessionActivity listExecutionConnectedApps
      listConnectedAppTools listExecutionReviews listAgentSessionPullRequests getAgentSessionQueue
      listAgentWorkRegistrations
      listAgentSessionUpdates listCodingAgents
    `,
    searched: 'discoverConnectedApps searchConnectedAppTools',
    created: 'createAgentSession createSessionReview',
    edited: `
      putAgentAutoArchivePreferences putAgentCodingPreferences putAgentSandboxSize chooseAgentMode
      putAgentSessionAutoArchive updateAgentSessionPermissions editQueuedAction
      putAgentSessionSandboxSize
    `,
    renamed: 'renameAgentSession',
    archived: 'setAgentSessionArchived',
    deleted: 'deleteAgentSession',
    ran: `
      startFreshAgentConversation retryAgentConversationTurn refreshAgentSessionChanges
      callConnectedAppTool controlAgentSession steerQueuedAction openInApp
    `,
    linked: `
      linkAgentSessionPullRequest
      linkAgentSessionTask
    `,
    unlinked: 'unlinkAgentSessionPullRequest',
    added: 'addConnectedMcpServer',
    removed: 'removeQueuedAction unregisterAgentSessionWork',
    submitted: 'answerAgentSessionToolApproval',
    approved: 'decideSessionReview',
    shared: 'presentSessionView',
    registered: 'registerAgentSessionWork',
  },
  'scheduled-action': {
    generated: 'suggestRoutine',
    checked: 'checkScheduledAction',
    listed: 'listScheduledActions listScheduledActionHistory',
    read: 'getScheduledAction getScheduledActionTemplate reviewSuggestions',
    created: 'createScheduledAction addSuggestion',
    deleted: 'deleteScheduledAction',
    edited: 'updateScheduledAction detachScheduledAction rewriteSuggestion',
    enabled: 'setScheduledActionEnabled activateScheduledActionTemplate',
    ran: 'executeScheduledActionNow',
    unshared: 'unshareScheduledActionTemplate',
    shared: 'shareScheduledActionTemplate',
    archived: 'retireSuggestion',
  },
  unfurl: { read: 'getUnfurl getUnfurlBulk' },
  auth: {
    read: 'macroApiToken getReferralCode getTeam getUserInfo postProfilePictures',
    listed:
      'emailConnectionProviders getTeamInvites getUserTeams getUserNamesWithEmail',
    sent: 'sendReferralCode',
    invited: 'inviteToTeam',
    deleted: 'deleteTeamInviteHandler',
    edited: 'putUserName putProfilePictureFile',
    uploaded: 'createProfilePictureUpload',
  },
  calendar: {
    listed:
      'getAvailabilityCalendars listCalendars listBookings listBookingRescheduleSlots listBookingLinks',
    read: `
      calendarEventProviderUrl calendarReplacementStatus getManagedBooking getBookingInsights
      getBookingSettings getTeamSharing
    `,
    checked: 'prepareCalendarReplacement',
    created: 'createCalendarEvent createBookingLink',
    copied: 'copyCalendarEvent',
    deleted: 'deleteCalendarEvent',
    edited: `
      setAvailabilityCalendar updateCalendarEvent changeBooking editBookingLink saveBookingSettings
      setTeamSharing
    `,
    invited: 'inviteCalendarEventGuests',
    confirmed: 'rsvpCalendarEvent confirmCalendarReplacement',
    cancelled: 'discardCalendarReplacement',
  },
  cognition: {
    listed: 'listSkills',
    read: `
      getUsageHandler getChatHistoryHandler getChat fetchWebPage
      getChatPermissions getUserActivity readExplicitMemory readMyActivity readSkill
    `,
    searched: 'searchWeb',
    queried: 'decisions structuredCompletion',
    created: 'createConfirmedCalendarEvent createChat',
    deleted: 'deleteChat permanentlyDeleteChat',
    edited: `
      patchChat
      editExplicitMemory
    `,
    copied: 'copyChat',
    restored: 'revertDeleteChat',
    sent: 'sendConfirmedEmail sendChatMessage',
    generated: 'generateImage',
    stopped: 'stopChatStream',
  },
  contacts: { searched: 'searchPeople' },
  email: {
    read: `
      getAttachment getAttachmentDocumentId messageOperationStatus resolveMessageOperation
      getMessage getMessageEml mailboxSettingsOperations getThread getThreadCalendarInvitations
      getThreadReadReceipts
    `,
    listed: `
      listContacts listBlockedSenders getScheduledMessages listEmailFilters listLabels listLinks
      previewsInboxCursor getThreadMessagesHandler
    `,
    blocked: 'blockSender',
    unblocked: 'unblockSender',
    restored: 'recoverDraftTransfer',
    created: 'createDraft createLabel',
    scheduled: 'upsertScheduledMessage',
    deleted: 'deleteScheduledDraft deleteDraft deleteEmailFilter deleteLabel',
    added: 'addDraftAttachment addForwardedAttachment',
    removed: 'removeDraftAttachment removeForwardedAttachment',
    uploaded: 'completeDraftAttachment',
    moved: 'transferDraft',
    edited: 'upsertEmailFilter updateThreadState updateThreadProject',
    sent: 'sendMessage',
    labeled: 'addRemoveLabel addRemoveThreadLabel',
    archived: 'archiveThreads archiveThread',
    ran: 'threadOperations',
    marked: 'threadSeen',
    copied: 'copyThreadCalendarInvitation',
  },
  notification: {
    removed: 'removeUnsubscribeItem',
    listed: 'listTypedNotifications getNotificationTypePreferences',
    read: 'getTypedNotificationById',
    deleted: 'bulkDeleteUserNotificationsV2 deleteUserNotificationV2',
    marked:
      'bulkMarkNotificationsDone bulkMarkNotificationsSeen bulkMarkNotificationsUndone',
    disabled: `
      disableNotificationType
      unsubscribeItem
    `,
    enabled: 'enableNotificationType',
  },
  properties: {
    labeled: 'ensureTagSet',
    listed: 'listProperties getPropertyOptions listTags',
    read: 'getPropertyDefinition getBulkEntityProperties getEntityProperties',
    created: 'createPropertyDefinition',
    deleted:
      'deletePropertyDefinition deletePropertyOption deleteEntityProperty',
    added: 'addPropertyOption addEntityPropertyOption',
    removed: 'removeEntityPropertyOption',
    edited: `
      updatePropertyOption bulkUpdateEntityPropertyOptions setEntityProperty
      bulkUpdateEntitiesPropertyOptions
    `,
  },
  search: { searched: 'unifiedSearch' },
  storage: {
    generated: 'renderCanvas',
    rejected: 'declineCall',
    read: `
      getAccountManagerGrant getDocumentAnchors getSelfBot getBot meetingLookup
      meetingInvitePermissions getCallRecord previewSmartTag getActivity getChannel
      getMyChannelAccessRequest getChannelAccessRequest getContactByEmail getContact getCompany
      getCrmPipeline getCrmPipelinePermissions getCrmPipelineStageRequirements getCrmPipelineTable
      getCrmTeamSettings getDatabase getDatabasePermissions getDatabaseRowHistory
      getDatabaseViewPositions getDocumentByTeamSlug getDocumentPermissionsToken
      getBatchPreviewHandler getDocument getDocumentBranchName getDocumentGithubPullRequests
      getDocumentShortId getSkillDescription getDocumentTeamShare getDocumentTextContent
      getDocumentVersion accessRequestsState getEntityPermission externalChat externalChatDelivery
      externalChatMessage externalChatPermissions getForeignEntityBySource getForeignEntity getForm
      getFormPermissions getMyFormResponse getFormResponseSummary getFormTally getGithubPullRequest
      getGithubPullRequestChanges getGithubPullRequestChangesPatch getHarnessPairing getSelfHarness
      getInitiative entityMessageGetMessage entityMessageGetThread getProjectHandler
      getProjectUserAccessLevel getProjectPermissionsV2 getEmailFollowup getDocumentPermissionsV2
      getWebhook whatsappAccount eventIcs getChannelJoinLink getCrmPipelineViewPositions
      exportDocument streamEvents
      exportCrmPipelineCsv getBatchCallRecordPreview getCallRecording getCrmPipelineCsv getDatabaseQuery getDocumentMarkdown getInitiativeActivity getInitiativeDescription getSavedViewDefinition readCanvasScene readDesign readIllustratorDocument readPhotoshopDocument readPresentation readSpreadsheet readWordDocument
    `,
    listed: `
      listAccountManagers listAgents listBots listBotChannels listBotTokens listOccurrences
      listTeamCalendar listTeamOutOfOffice meetingList meetingListActive listChannelLabels
      getChannelAttachments listChannelBots getChannelParticipants getChannels listCrmBlockedDomains
      listCompanyContacts listCrmPipelines getCrmPipelineRows listDatabases listDatabaseColumnCasts
      listDatabaseWebhooks getUserDocumentsHandler getSystemSkillsHandler externalChats
      externalChatMessages externalChatMessageAttachments listFavorites listForms
      listAccessibleForms getGithubPullRequestFacets getGithubPullRequestTasks listHarnesses
      listHarnessAgents listHarnessSessions listInitiatives messageTimeline messageTimelineEntries
      getPinsHandler getProjectContentHandler recentlyDeleted listEmailReminders listUserApiKeys
      listWebhooks whatsappChats
      getCallParticipants getLiveCalls listCrmRecordPipelineEntries listHarnessDirectory listHarnessResidents listSavedViewDefinitions pageInitiatives
    `,
    searched: `
      searchContacts taskSimilaritySearchHandler
      findCrmPipelineEntries searchCrmPipelineEntries
    `,
    queried: `
      queryCrmPipelineRows queryDatabases postItemsSoupAst
      calculateSpreadsheet
    `,
    checked: `
      inferDatabaseColumnType validateWebhook validateDocumentPermissionsToken
      checkActiveCall getCallRingState getTeamAvailability
    `,
    requested:
      'requestAccountManager requestChannelAccess accessRequestsSubmit',
    created: `
      getOrCreateDm getOrCreatePrivate createAgent createAnchor createBot createBotToken
      createChannelLabel meetingCreate createChannel createCrmCompany createCrmContact
      createCrmTeamContact createCrmPipeline createDatabase createDatabaseWebhook createDocument
      createCanvasHandler createMarkdownHandler createSkillHandler createSnippetHandler
      createTaskHandler externalChatAdd createForm createHarnessPairing createInitiative
      entityMessageCreate createProjectHandler createUserApiKey createWebhook
      createSavedViewDefinition createSpreadsheet saveDatabaseQuery startCall
    `,
    edited: `
      resetCrmTeamStages updateAgent editAnchor patchBot meetingUpdate editCallRecord
      editCallTranscript patchChannel setChannelPicture setEmailSync setCompanyHidden
      setCrmCompanyName setContactHidden setCrmContactName applyCrmPipelineOps
      updateCrmPipelinePermissions setCrmPipelineStageRequirement putCrmTeamSettings
      putCrmTeamStages applyDatabaseOps updateDatabasePermissions convertDatabaseColumn
      presaveDocumentHandler editDocument saveDocumentHandler editDocumentWithAi simpleSave
      setSkillDescription setDocumentTeamShare accessRequestsSetDirect externalChatUpdatePermissions
      updateForm putFormLayout updateFormPermissions editMyFormResponse patchHarness
      updateInitiative entityMessageEdit entityMessagePatchThread editThreadV2 editProjectV2
      patchWebhook
      applyCanvasEdits editCanvasWithAi editCrmPipeline editPresentation editSpreadsheet editSpreadsheetWithAi editWordDocument patchAgent setCrmContactEmail updateCrmPipelineEntries updateSavedViewDefinition writeDocumentMarkdown
    `,
    renamed: 'renameChannelLabel renameCrmPipeline',
    deleted: `
      deleteAnchor deleteBot revokeBotToken deleteCallRecord deleteChannelLabel deleteEntityMention
      deleteChannel permanentlyDeleteDocument deleteDocument accessRequestsRemoveDirect
      externalChatRemove deleteDatabaseWebhook deleteSelfHarness deleteHarness deleteInitiative
      entityMessageDeleteMessage entityMessageDeleteThread deleteProjectHandler
      permanentlyDeleteProject deleteUserApiKey deleteWebhook
      deleteSavedViewDefinition
    `,
    removed: `
      removeBotFromChannelByBot removeParticipants removeFavoriteByEntity removePinHandler
      removeCrmPipelineEntries
    `,
    added: `
      addChannelBot addParticipants addFavorite addPinHandler
      addCrmPipelineEntries
    `,
    blocked: 'blockCrmDomain',
    unblocked: 'unblockCrmDomain',
    copied: `
      copyDocument duplicateDatabase
      copyPresentation
    `,
    imported: `
      importDatabaseTable
      importCrmCompaniesCsv importCrmPipelineCsv
    `,
    uploaded: 'uploadFile externalChatUpload',
    archived: 'trashCrmPipeline',
    restored: 'revertDeleteDocument revertDeleteProject',
    shared: `
      meetingShare toggleShareWithTeam shareCrmPipeline accessRequestsDirect
      shareWithChannel
    `,
    unshared: 'revokeAccountManagerGrant',
    invited: 'meetingInvite meetingInviteUsers',
    cancelled: 'meetingCancel cancelChannelAccessRequest accessRequestsCancel',
    joined: `
      joinChannel
      joinCall meetingGuestJoin meetingJoin
    `,
    left: `
      leaveChannel
      leaveCall
    `,
    confirmed: `
      respondToAccountManagerRequest resolveChannelAccessRequest accessRequestsResolve
      approveHarnessPairing claimHarnessPairing
    `,
    submitted: 'submitFormResponse',
    sent: 'postChannelBotWebhook externalChatSend externalChatSends',
    posted: `
      postActivity entityMessageTyping
      commentOnDocumentText
    `,
    reacted: 'entityMessageReact',
    linked: `
      createEntityMention
      setCrmContactCompany
    `,
    reordered: `
      reorderFavorites reorderPinsHandler
      reorderSavedViewDefinitions
    `,
    labeled: 'setChannelLabel',
    marked: 'setEmailFollowup externalChatRead',
    ran: 'claimAccountManagerToken',
  },
};

export const sdkVerbs: Record<string, SdkVerb> = {};
for (const [service, byVerb] of Object.entries(methods)) {
  for (const [verb, names] of Object.entries(byVerb)) {
    for (const name of names.trim().split(/\s+/)) {
      const key = `${service}.${name}`;
      if (sdkVerbs[key]) throw new Error(`duplicate SDK verb for ${key}`);
      sdkVerbs[key] = verb as SdkVerb;
    }
  }
}
