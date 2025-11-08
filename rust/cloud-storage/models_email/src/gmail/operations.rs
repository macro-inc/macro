/// Represents a specific Gmail API operation with a known quota unit cost.
///
/// This enum provides a type-safe way to handle API operations, ensuring that
/// only valid operations are used and that their costs can be retrieved without
/// relying on magic numbers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailApiOperation {
    // Drafts
    DraftsCreate,
    DraftsDelete,
    DraftsGet,
    DraftsList,
    DraftsSend,
    DraftsUpdate,

    // Users
    UsersGetProfile,

    // History
    HistoryList,

    // Labels
    LabelsCreate,
    LabelsDelete,
    LabelsGet,
    LabelsList,
    LabelsUpdate,

    // Messages
    MessagesAttachmentsGet,
    MessagesBatchDelete,
    MessagesBatchModify,
    MessagesDelete,
    MessagesGet,
    MessagesImport,
    MessagesInsert,
    MessagesList,
    MessagesModify,
    MessagesSend,
    MessagesTrash,
    MessagesUntrash,

    // Settings
    SettingsDelegatesCreate,
    SettingsDelegatesDelete,
    SettingsDelegatesGet,
    SettingsDelegatesList,
    SettingsFiltersCreate,
    SettingsFiltersDelete,
    SettingsFiltersGet,
    SettingsFiltersList,
    SettingsForwardingAddressesCreate,
    SettingsForwardingAddressesDelete,
    SettingsForwardingAddressesGet,
    SettingsForwardingAddressesList,
    SettingsGetAutoForwarding,
    SettingsGetImap,
    SettingsGetPop,
    SettingsGetVacation,
    SettingsSendAsCreate,
    SettingsSendAsDelete,
    SettingsSendAsGet,
    SettingsSendAsList,
    SettingsSendAsUpdate,
    SettingsSendAsVerify,
    SettingsUpdateAutoForwarding,
    SettingsUpdateImap,
    SettingsUpdatePop,
    SettingsUpdateVacation,

    // Other Top-Level
    Stop,
    Watch,

    // Threads
    ThreadsDelete,
    ThreadsGet,
    ThreadsList,
    ThreadsModify,
    ThreadsTrash,
    ThreadsUntrash,
}

impl GmailApiOperation {
    /// Returns the quota unit cost for the specific Gmail API operation.
    pub fn cost(&self) -> u32 {
        use GmailApiOperation::*;

        match self {
            // --- 1 Quota Unit ---
            UsersGetProfile
            | LabelsGet
            | LabelsList
            | SettingsDelegatesGet
            | SettingsDelegatesList
            | SettingsFiltersGet
            | SettingsFiltersList
            | SettingsForwardingAddressesGet
            | SettingsForwardingAddressesList
            | SettingsGetAutoForwarding
            | SettingsGetImap
            | SettingsGetPop
            | SettingsGetVacation
            | SettingsSendAsGet
            | SettingsSendAsList => 1,

            // --- 2 Quota Units ---
            HistoryList => 2,

            // --- 5 Quota Units ---
            DraftsGet
            | DraftsList
            | LabelsCreate
            | LabelsDelete
            | LabelsUpdate
            | MessagesAttachmentsGet
            | MessagesGet
            | MessagesList
            | MessagesModify
            | MessagesTrash
            | MessagesUntrash
            | SettingsDelegatesDelete
            | SettingsFiltersCreate
            | SettingsFiltersDelete
            | SettingsForwardingAddressesDelete
            | SettingsUpdateAutoForwarding
            | SettingsUpdateImap
            | SettingsUpdateVacation
            | SettingsSendAsDelete => 5,

            // --- 10 Quota Units ---
            DraftsCreate | DraftsDelete | MessagesDelete | ThreadsGet | ThreadsList
            | ThreadsModify | ThreadsTrash | ThreadsUntrash => 10,

            // --- 15 Quota Units ---
            DraftsUpdate => 15,

            // --- 20 Quota Units ---
            ThreadsDelete => 20,

            // --- 25 Quota Units ---
            MessagesImport | MessagesInsert => 25,

            // --- 50 Quota Units ---
            MessagesBatchDelete | MessagesBatchModify | Stop => 50,

            // --- 100 Quota Units ---
            DraftsSend
            | MessagesSend
            | SettingsDelegatesCreate
            | SettingsForwardingAddressesCreate
            | SettingsSendAsCreate
            | SettingsSendAsUpdate
            | SettingsSendAsVerify
            | SettingsUpdatePop
            | Watch => 100,
        }
    }
}
