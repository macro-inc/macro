//! The routes the emulator serves, and the failures that can be injected
//! into them.

use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};

use crate::error::GraphError;

/// A Graph operation, named `<resource>.<verb>`. Faults select requests by
/// it and the request log reports it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Display, EnumString, Deserialize, Serialize)]
#[serde(try_from = "String", into = "String")]
pub enum Route {
    /// `GET /me`
    #[strum(serialize = "me.get")]
    MeGet,
    /// `GET /me/photo/$value`
    #[strum(serialize = "me.photo")]
    MePhoto,
    /// `GET /me/mailFolders` and `…/childFolders`
    #[strum(serialize = "folders.list")]
    FoldersList,
    /// `GET /me/mailFolders/{id}`
    #[strum(serialize = "folders.get")]
    FoldersGet,
    /// `POST /me/mailFolders` and `…/childFolders`
    #[strum(serialize = "folders.create")]
    FoldersCreate,
    /// `GET /me/messages` and `/me/mailFolders/{id}/messages`
    #[strum(serialize = "messages.list")]
    MessagesList,
    /// `GET /me/mailFolders/{id}/messages/delta`
    #[strum(serialize = "messages.delta")]
    MessagesDelta,
    /// `GET /me/messages/{id}`
    #[strum(serialize = "messages.get")]
    MessagesGet,
    /// `GET /me/messages/{id}/$value`
    #[strum(serialize = "messages.value")]
    MessagesValue,
    /// `POST /me/messages`
    #[strum(serialize = "messages.create")]
    MessagesCreate,
    /// `PATCH /me/messages/{id}`
    #[strum(serialize = "messages.update")]
    MessagesUpdate,
    /// `DELETE /me/messages/{id}`
    #[strum(serialize = "messages.delete")]
    MessagesDelete,
    /// `POST /me/messages/{id}/move`
    #[strum(serialize = "messages.move")]
    MessagesMove,
    /// `POST /me/messages/{id}/copy`
    #[strum(serialize = "messages.copy")]
    MessagesCopy,
    /// `POST /me/messages/{id}/send`
    #[strum(serialize = "messages.send")]
    MessagesSend,
    /// `POST /me/sendMail`
    #[strum(serialize = "messages.sendMail")]
    SendMail,
    /// `POST /me/messages/{id}/createReply` and `createReplyAll`
    #[strum(serialize = "messages.createReply")]
    MessagesCreateReply,
    /// `POST /me/messages/{id}/createForward`
    #[strum(serialize = "messages.createForward")]
    MessagesCreateForward,
    /// `POST /me/messages/{id}/reply` and `replyAll`
    #[strum(serialize = "messages.reply")]
    MessagesReply,
    /// `POST /me/messages/{id}/forward`
    #[strum(serialize = "messages.forward")]
    MessagesForward,
    /// `GET /me/messages/{id}/attachments`
    #[strum(serialize = "attachments.list")]
    AttachmentsList,
    /// `GET /me/messages/{id}/attachments/{id}`
    #[strum(serialize = "attachments.get")]
    AttachmentsGet,
    /// `GET /me/messages/{id}/attachments/{id}/$value`
    #[strum(serialize = "attachments.value")]
    AttachmentsValue,
    /// `POST /me/messages/{id}/attachments`
    #[strum(serialize = "attachments.create")]
    AttachmentsCreate,
    /// `DELETE /me/messages/{id}/attachments/{id}`
    #[strum(serialize = "attachments.delete")]
    AttachmentsDelete,
    /// `POST /me/messages/{id}/attachments/createUploadSession`
    #[strum(serialize = "uploads.create")]
    UploadsCreate,
    /// `GET` on an upload URL
    #[strum(serialize = "uploads.get")]
    UploadsGet,
    /// `PUT` on an upload URL
    #[strum(serialize = "uploads.put")]
    UploadsPut,
    /// `DELETE` on an upload URL
    #[strum(serialize = "uploads.delete")]
    UploadsDelete,
    /// `GET /me/outlook/masterCategories`
    #[strum(serialize = "categories.list")]
    CategoriesList,
    /// `POST /me/outlook/masterCategories`
    #[strum(serialize = "categories.create")]
    CategoriesCreate,
    /// `DELETE /me/outlook/masterCategories/{id}`
    #[strum(serialize = "categories.delete")]
    CategoriesDelete,
    /// `GET /me/mailFolders/inbox/messageRules`
    #[strum(serialize = "rules.list")]
    RulesList,
    /// `POST /me/mailFolders/inbox/messageRules`
    #[strum(serialize = "rules.create")]
    RulesCreate,
    /// `DELETE /me/mailFolders/inbox/messageRules/{id}`
    #[strum(serialize = "rules.delete")]
    RulesDelete,
    /// `GET /me/contactFolders` and `…/childFolders`
    #[strum(serialize = "contactFolders.list")]
    ContactFoldersList,
    /// `GET /me/contacts`
    #[strum(serialize = "contacts.list")]
    ContactsList,
    /// `GET /me/contactFolders/{id}/contacts/delta`
    #[strum(serialize = "contacts.delta")]
    ContactsDelta,
    /// `GET /me/contactFolders/{id}/contacts/{id}/photo/$value`
    #[strum(serialize = "contacts.photo")]
    ContactsPhoto,
    /// `GET /me/mailboxSettings`
    #[strum(serialize = "mailboxSettings.get")]
    MailboxSettingsGet,
    /// `GET /me/calendars`
    #[strum(serialize = "calendars.list")]
    CalendarsList,
    /// `GET /me/calendars/{id}`
    #[strum(serialize = "calendars.get")]
    CalendarsGet,
    /// `GET /me/calendarView/delta`
    #[strum(serialize = "calendarView.delta")]
    CalendarViewDelta,
    /// `GET /me/calendars/{id}/calendarView`
    #[strum(serialize = "calendarView.list")]
    CalendarViewList,
    /// `GET /me/calendars/{id}/events`
    #[strum(serialize = "events.list")]
    EventsList,
    /// `GET /me/events/{id}` and `/me/calendars/{id}/events/{id}`
    #[strum(serialize = "events.get")]
    EventsGet,
    /// `GET /me/events/{id}/instances`
    #[strum(serialize = "events.instances")]
    EventsInstances,
    /// `POST /me/calendars/{id}/events`
    #[strum(serialize = "events.create")]
    EventsCreate,
    /// `PATCH /me/events/{id}`
    #[strum(serialize = "events.update")]
    EventsUpdate,
    /// `DELETE /me/events/{id}`
    #[strum(serialize = "events.delete")]
    EventsDelete,
    /// `POST /me/events/{id}/accept`, `tentativelyAccept` and `decline`,
    /// also under `/me/calendars/{id}`
    #[strum(serialize = "events.respond")]
    EventsRespond,
    /// `GET /subscriptions`
    #[strum(serialize = "subscriptions.list")]
    SubscriptionsList,
    /// `POST /subscriptions`
    #[strum(serialize = "subscriptions.create")]
    SubscriptionsCreate,
    /// `PATCH /subscriptions/{id}`
    #[strum(serialize = "subscriptions.update")]
    SubscriptionsUpdate,
    /// `DELETE /subscriptions/{id}`
    #[strum(serialize = "subscriptions.delete")]
    SubscriptionsDelete,
    /// `POST /$batch`
    #[strum(serialize = "batch")]
    Batch,
    /// `POST /{tenant}/oauth2/v2.0/token`, and the authentication-service
    /// stand-in.
    #[strum(serialize = "oauth.token")]
    OauthToken,
    /// `GET` and `POST /{tenant}/oauth2/v2.0/authorize`: the sign-in page
    /// and its form.
    #[strum(serialize = "oauth.authorize")]
    OauthAuthorize,
    /// `GET` and `POST /{tenant}/v2.0/adminconsent`: the admin-consent page
    /// and its form.
    #[strum(serialize = "oauth.adminconsent")]
    OauthAdminConsent,
    /// `GET /{tenant}/v2.0/.well-known/openid-configuration`
    #[strum(serialize = "oauth.discovery")]
    OauthDiscovery,
    /// `GET /{tenant}/discovery/v2.0/keys`
    #[strum(serialize = "oauth.keys")]
    OauthKeys,
    /// `GET /oidc/userinfo`
    #[strum(serialize = "oauth.userinfo")]
    OauthUserInfo,
}

impl TryFrom<String> for Route {
    type Error = strum::ParseError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl From<Route> for String {
    fn from(route: Route) -> Self {
        route.to_string()
    }
}

/// The error an injected fault answers with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FaultError {
    /// 429 `ApplicationThrottled`: over the mailbox's request rate.
    RateLimit,
    /// 429 `ApplicationThrottled`: over the mailbox's four concurrent requests.
    ConcurrentRequests,
    /// 429 `TooManyRequests`, Graph's own front-door throttle.
    TooManyRequests,
    /// 500 `ErrorInternalServerError`.
    Internal,
    /// 503 `ServiceUnavailable`.
    Unavailable,
    /// 504 `UnknownError` with an empty message, as Graph's gateway answers.
    GatewayTimeout,
    /// 401 `InvalidAuthenticationToken`: the access token is refused.
    Unauthorized,
    /// 403 `ErrorAccessDenied`.
    Forbidden,
    /// 404 `ErrorItemNotFound`.
    NotFound,
    /// 404 `MailboxNotEnabledForRESTAPI`: the mailbox is not in Exchange Online.
    MailboxNotEnabled,
    /// 410 `SyncStateNotFound`: the delta token is expired.
    SyncStateNotFound,
    /// 400 `ErrorInvalidOperation`, as for a native reply Graph refuses.
    InvalidOperation,
    /// 409 `Conflict`.
    Conflict,
}

impl FaultError {
    pub(crate) fn graph_error(self, retry_after_seconds: Option<u64>) -> GraphError {
        let error = match self {
            Self::RateLimit => GraphError::throttled("RequestRate", None),
            Self::ConcurrentRequests => GraphError::throttled("MailboxConcurrency", None),
            Self::TooManyRequests => GraphError::too_many_requests(None),
            Self::Internal => GraphError::server(
                500,
                "ErrorInternalServerError",
                "An internal server error occurred. The operation failed.",
            ),
            Self::Unavailable => GraphError::server(
                503,
                "ServiceUnavailable",
                "The service is temporarily unavailable. Please retry after some time.",
            ),
            Self::GatewayTimeout => GraphError::server(504, "UnknownError", ""),
            Self::Unauthorized => {
                GraphError::unauthenticated("Lifetime validation failed, the token is expired.")
            }
            Self::Forbidden => GraphError::access_denied(),
            Self::NotFound => GraphError::item_not_found(),
            Self::MailboxNotEnabled => GraphError::server(
                404,
                "MailboxNotEnabledForRESTAPI",
                "The mailbox is either inactive, soft-deleted, or is hosted on-premise.",
            ),
            Self::SyncStateNotFound => GraphError::sync_state_not_found(),
            Self::InvalidOperation => {
                GraphError::invalid_operation("The operation is not valid for this item.")
            }
            Self::Conflict => GraphError::conflict("The request conflicts with the item's state."),
        };
        error.with_retry_after(retry_after_seconds)
    }
}

/// A failure to inject. A request matches when both `mailbox` and `route`
/// match; the first matching fault applies.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Fault {
    /// Only requests for this mailbox. All mailboxes when absent.
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
