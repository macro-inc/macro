//! Injected provider failures, and the names of the routes they apply to.

use serde::{Deserialize, Serialize};

/// A Google API method the emulator serves, named as in Google's reference
/// without the `users.` prefix.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    Hash,
    Deserialize,
    Serialize,
    strum::Display,
    strum::EnumString,
)]
#[serde(try_from = "String", into = "String")]
pub enum Route {
    /// `users.getProfile`
    #[strum(serialize = "getProfile")]
    GetProfile,
    /// `users.messages.list`
    #[strum(serialize = "messages.list")]
    MessagesList,
    /// `users.messages.get`
    #[strum(serialize = "messages.get")]
    MessagesGet,
    /// `users.messages.send`
    #[strum(serialize = "messages.send")]
    MessagesSend,
    /// `users.messages.import`
    #[strum(serialize = "messages.import")]
    MessagesImport,
    /// `users.messages.modify`
    #[strum(serialize = "messages.modify")]
    MessagesModify,
    /// `users.messages.batchModify`
    #[strum(serialize = "messages.batchModify")]
    MessagesBatchModify,
    /// `users.messages.trash`
    #[strum(serialize = "messages.trash")]
    MessagesTrash,
    /// `users.messages.untrash`
    #[strum(serialize = "messages.untrash")]
    MessagesUntrash,
    /// `users.messages.delete`
    #[strum(serialize = "messages.delete")]
    MessagesDelete,
    /// `users.messages.batchDelete`
    #[strum(serialize = "messages.batchDelete")]
    MessagesBatchDelete,
    /// `users.messages.attachments.get`
    #[strum(serialize = "messages.attachments.get")]
    AttachmentsGet,
    /// `users.threads.list`
    #[strum(serialize = "threads.list")]
    ThreadsList,
    /// `users.threads.get`
    #[strum(serialize = "threads.get")]
    ThreadsGet,
    /// `users.labels.list`
    #[strum(serialize = "labels.list")]
    LabelsList,
    /// `users.labels.get`
    #[strum(serialize = "labels.get")]
    LabelsGet,
    /// `users.labels.create`
    #[strum(serialize = "labels.create")]
    LabelsCreate,
    /// `users.labels.update` and `users.labels.patch`
    #[strum(serialize = "labels.update")]
    LabelsUpdate,
    /// `users.labels.delete`
    #[strum(serialize = "labels.delete")]
    LabelsDelete,
    /// `users.drafts.list`
    #[strum(serialize = "drafts.list")]
    DraftsList,
    /// `users.drafts.get`
    #[strum(serialize = "drafts.get")]
    DraftsGet,
    /// `users.drafts.create`
    #[strum(serialize = "drafts.create")]
    DraftsCreate,
    /// `users.drafts.update`
    #[strum(serialize = "drafts.update")]
    DraftsUpdate,
    /// `users.drafts.delete`
    #[strum(serialize = "drafts.delete")]
    DraftsDelete,
    /// `users.drafts.send`
    #[strum(serialize = "drafts.send")]
    DraftsSend,
    /// `users.history.list`
    #[strum(serialize = "history.list")]
    HistoryList,
    /// `users.watch`
    #[strum(serialize = "watch")]
    Watch,
    /// `users.stop`
    #[strum(serialize = "stop")]
    Stop,
    /// `users.settings.filters.list`
    #[strum(serialize = "settings.filters.list")]
    FiltersList,
    /// `users.settings.filters.get`
    #[strum(serialize = "settings.filters.get")]
    FiltersGet,
    /// `users.settings.filters.create`
    #[strum(serialize = "settings.filters.create")]
    FiltersCreate,
    /// `users.settings.filters.delete`
    #[strum(serialize = "settings.filters.delete")]
    FiltersDelete,
    /// `users.settings.sendAs.list`
    #[strum(serialize = "settings.sendAs.list")]
    SendAsList,
    /// People API `people.get` for `people/me`
    #[strum(serialize = "people.get")]
    PeopleGet,
    /// People API `people.connections.list`
    #[strum(serialize = "people.connections.list")]
    ConnectionsList,
    /// People API `otherContacts.list`
    #[strum(serialize = "otherContacts.list")]
    OtherContactsList,
    /// The OAuth token endpoint
    #[strum(serialize = "oauth.token")]
    OauthToken,
    /// The OAuth token-info endpoint
    #[strum(serialize = "oauth.tokeninfo")]
    OauthTokenInfo,
    /// The OAuth authorization endpoint: the sign-in page and its form
    #[strum(serialize = "oauth.authorize")]
    OauthAuthorize,
    /// The OpenID Connect userinfo endpoint
    #[strum(serialize = "oauth.userinfo")]
    OauthUserInfo,
}

impl TryFrom<String> for Route {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value
            .parse()
            .map_err(|_| format!("unknown route `{value}`"))
    }
}

impl From<Route> for String {
    fn from(route: Route) -> Self {
        route.to_string()
    }
}

impl Route {
    /// The quota units Gmail charges for the method.
    pub(crate) fn quota_units(self) -> u32 {
        match self {
            Self::GetProfile
            | Self::LabelsList
            | Self::LabelsGet
            | Self::FiltersList
            | Self::FiltersGet
            | Self::SendAsList
            | Self::PeopleGet
            | Self::ConnectionsList
            | Self::OtherContactsList
            | Self::OauthToken
            | Self::OauthTokenInfo
            | Self::OauthAuthorize
            | Self::OauthUserInfo => 1,
            Self::HistoryList => 2,
            Self::MessagesList
            | Self::MessagesGet
            | Self::MessagesModify
            | Self::MessagesTrash
            | Self::MessagesUntrash
            | Self::AttachmentsGet
            | Self::LabelsCreate
            | Self::LabelsUpdate
            | Self::LabelsDelete
            | Self::DraftsList
            | Self::DraftsGet
            | Self::FiltersCreate
            | Self::FiltersDelete => 5,
            Self::MessagesDelete
            | Self::ThreadsList
            | Self::ThreadsGet
            | Self::DraftsCreate
            | Self::DraftsDelete => 10,
            Self::DraftsUpdate => 15,
            Self::MessagesImport => 25,
            Self::MessagesBatchModify | Self::MessagesBatchDelete | Self::Stop => 50,
            Self::MessagesSend | Self::DraftsSend | Self::Watch => 100,
        }
    }
}

/// The error an injected fault answers with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FaultError {
    /// 429 `rateLimitExceeded`: the per-user rate limit.
    RateLimit,
    /// 429 "Too many concurrent requests for user".
    ConcurrentRequests,
    /// 403 `userRateLimitExceeded`: quota exhaustion in its 403 form.
    QuotaExceeded,
    /// 403 `dailyLimitExceeded`.
    DailyLimit,
    /// 500 `backendError`.
    Internal,
    /// 503 `backendError`.
    Unavailable,
    /// 401: the access token is refused.
    Unauthorized,
    /// 403 for a reason other than quota.
    Forbidden,
    /// 404, as for a missing message or an expired history id.
    NotFound,
}

/// A failure to inject. A request matches when both `mailbox` and `route`
/// match; the first matching fault applies.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Fault {
    /// Only requests for this mailbox. All mailboxes when absent. Token
    /// requests have a mailbox only when their refresh token names one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mailbox: Option<String>,
    /// Only this route. All routes when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<Route>,
    /// The error to answer. Without one the request succeeds, after `delay_ms`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<FaultError>,
    /// A `Retry-After` header for the error, in seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    /// Wait this long before answering.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
    /// How many requests the fault applies to. Until removed when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub times: Option<u32>,
}
