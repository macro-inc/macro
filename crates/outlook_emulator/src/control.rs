//! The control API under `/_emulator/`: each route calls the
//! [`OutlookEmulator`] method of the same purpose.

mod calendar;

use std::time::Duration;

use axum::extract::{Path, Query, State as AxumState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::seed::{NewMessage, Seed, SeedContact, SeedError, SeedMailbox};

use crate::{EmulatorError, Fault, LifecycleEvent, OutlookEmulator};
pub use calendar::CalendarSummary;

type Emulator = AxumState<OutlookEmulator>;

/// A stored message, in brief.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MessageSummary {
    /// The message's Graph id.
    pub id: String,
    /// Its conversation.
    pub conversation_id: String,
    /// The display name of its folder.
    pub folder: String,
    /// Its `Message-ID`.
    pub internet_message_id: String,
    /// Its subject.
    pub subject: String,
    /// The sender's address.
    pub from: Option<String>,
    /// The recipients' addresses.
    pub to: Vec<String>,
    /// Whether it is read.
    pub is_read: bool,
    /// Whether it is a draft.
    pub is_draft: bool,
    /// Whether it is flagged.
    pub flagged: bool,
    /// Its categories.
    pub categories: Vec<String>,
    /// The names of its attachments.
    pub attachments: Vec<String>,
    /// When it was received.
    pub received: DateTime<Utc>,
}

/// A change to a message made in Outlook, outside Macro.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MessageChange {
    /// Marks it read or unread.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
    /// Flags or unflags it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flagged: Option<bool>,
    /// Replaces its categories.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
    /// Moves it to a folder: a well-known name, a display name or an id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
}

/// A subscription, in brief.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SubscriptionSummary {
    /// The subscription id.
    pub id: String,
    /// The mailbox it watches.
    pub mailbox: String,
    /// The resource it watches, such as `me/messages`.
    pub resource: String,
    /// The change types it asked for.
    pub change_type: String,
    /// Where change notifications go.
    pub notification_url: String,
    /// Where lifecycle notifications go.
    pub lifecycle_notification_url: Option<String>,
    /// When Graph drops it.
    pub expires_at: DateTime<Utc>,
}

impl OutlookEmulator {
    /// A mailbox's messages, oldest first.
    pub fn messages(&self, email: &str) -> Result<Vec<MessageSummary>, EmulatorError> {
        self.with_state(|state| {
            let mailbox = state.mailbox(email)?;
            let mut messages: Vec<MessageSummary> = mailbox
                .messages
                .values()
                .map(|message| MessageSummary {
                    id: message.id.clone(),
                    conversation_id: message.conversation_id.clone(),
                    folder: mailbox
                        .folder(&message.folder_id)
                        .map(|folder| folder.name.clone())
                        .unwrap_or_default(),
                    internet_message_id: message.internet_message_id.clone(),
                    subject: message.subject.clone(),
                    from: message.from.as_ref().map(|from| from.address.clone()),
                    to: message.to.iter().map(|to| to.address.clone()).collect(),
                    is_read: message.is_read,
                    is_draft: message.is_draft,
                    flagged: message.flagged,
                    categories: message.categories.clone(),
                    attachments: message
                        .attachments
                        .iter()
                        .map(|attachment| attachment.name.clone())
                        .collect(),
                    received: message.received,
                })
                .collect();
            messages.sort_by(|a, b| (a.received, &a.id).cmp(&(b.received, &b.id)));
            Ok(messages)
        })
    }

    /// Changes a message, as if its owner had in Outlook.
    pub fn update_message(
        &self,
        email: &str,
        message_id: &str,
        change: &MessageChange,
    ) -> Result<(), EmulatorError> {
        self.with_state(|state| {
            let now = state.now();
            let mailbox = state.mailbox(email)?;
            let unknown = || EmulatorError::UnknownMessage(message_id.to_string());
            let message = mailbox.messages.get_mut(message_id).ok_or_else(unknown)?;
            if let Some(read) = change.read {
                message.is_read = read;
            }
            if let Some(flagged) = change.flagged {
                message.flagged = flagged;
            }
            if let Some(categories) = &change.categories {
                message.categories = categories.clone();
            }
            match &change.folder {
                Some(folder) => mailbox
                    .move_message(message_id, folder, now)
                    .map_err(|_| EmulatorError::UnknownFolder(folder.clone())),
                None => {
                    mailbox.touch(message_id, now);
                    Ok(())
                }
            }
        })
    }

    /// The subscriptions Graph holds.
    pub fn subscriptions(&self) -> Vec<SubscriptionSummary> {
        self.with_state(|state| {
            state
                .subscriptions
                .values()
                .map(|subscription| SubscriptionSummary {
                    id: subscription.id.clone(),
                    mailbox: subscription.email.clone(),
                    resource: subscription.resource.clone(),
                    change_type: subscription.change_type.clone(),
                    notification_url: subscription.notification_url.clone(),
                    lifecycle_notification_url: subscription.lifecycle_url.clone(),
                    expires_at: subscription.expires_at,
                })
                .collect()
        })
    }
}

impl IntoResponse for EmulatorError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::UnknownMailbox(_)
            | Self::UnknownFolder(_)
            | Self::UnknownMessage(_)
            | Self::UnknownCalendar(_)
            | Self::UnknownEvent(_)
            | Self::UnknownSubscription(_) => StatusCode::NOT_FOUND,
            Self::MailboxExists(_) | Self::GrantRevoked(_) => StatusCode::CONFLICT,
            Self::InvalidMessage(_) | Self::InvalidEvent(_) => StatusCode::BAD_REQUEST,
        };
        (status, Json(json!({ "error": self.to_string() }))).into_response()
    }
}

impl IntoResponse for SeedError {
    fn into_response(self) -> Response {
        let body = Json(json!({ "error": self.to_string() }));
        (StatusCode::BAD_REQUEST, body).into_response()
    }
}

pub(crate) fn router() -> Router<OutlookEmulator> {
    let routes = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/state", get(state))
        .route("/reset", post(reset))
        .route("/seed", post(seed))
        .route("/mailboxes", get(mailboxes).post(add_mailbox))
        .route("/mailboxes/{email}/messages", get(messages).post(deliver))
        .route(
            "/mailboxes/{email}/messages/{id}",
            patch(update_message).delete(delete_message),
        )
        .route("/mailboxes/{email}/access-tokens", post(access_token))
        .route("/mailboxes/{email}/revoke", post(revoke_grant))
        .route("/mailboxes/{email}/links/{link_id}", post(link_mailbox))
        .route("/mailboxes/{email}/delta/expire", post(expire_delta_tokens))
        .route("/mailboxes/{email}/contacts", post(upsert_contact))
        .route("/mailboxes/{email}/contacts/{id}", delete(remove_contact))
        .route(
            "/faults",
            get(faults).post(inject_fault).delete(clear_faults),
        )
        .route("/faults/{id}", delete(remove_fault))
        .route("/clock", get(clock))
        .route("/clock/advance", post(advance_clock))
        .route("/requests", get(requests).delete(clear_requests))
        .route("/subscriptions", get(subscriptions))
        .route("/subscriptions/{id}/lifecycle", post(send_lifecycle))
        .route("/notifications", get(notifications))
        .merge(calendar::routes());
    Router::new().nest("/_emulator", routes)
}

fn done<T: Serialize>(result: Result<T, EmulatorError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn state(AxumState(emulator): Emulator) -> Json<Value> {
    Json(json!({
        "now": emulator.now(),
        "graph_url": emulator.graph_url(),
        "mailboxes": emulator.mailboxes(),
        "subscriptions": emulator.subscriptions(),
        "faults": fault_list(&emulator),
        "requests": emulator.requests().len(),
        "notifications": emulator.notifications().len(),
    }))
}

async fn reset(AxumState(emulator): Emulator, body: String) -> Response {
    let seed = match body.trim().is_empty() {
        true => Ok(Seed::default()),
        false => Seed::parse(&body),
    };
    match seed.and_then(|seed| emulator.reset(&seed)) {
        Ok(()) => Json(emulator.mailboxes()).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn seed(AxumState(emulator): Emulator, body: String) -> Response {
    match Seed::parse(&body).and_then(|seed| emulator.seed(&seed)) {
        Ok(()) => Json(emulator.mailboxes()).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn mailboxes(AxumState(emulator): Emulator) -> Response {
    Json(emulator.mailboxes()).into_response()
}

async fn add_mailbox(AxumState(emulator): Emulator, Json(mailbox): Json<SeedMailbox>) -> Response {
    done(emulator.add_mailbox(&mailbox))
}

async fn messages(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.messages(&email))
}

async fn deliver(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
    Json(message): Json<NewMessage>,
) -> Response {
    done(emulator.deliver(&email, &message))
}

async fn update_message(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
    Json(change): Json<crate::MessageChange>,
) -> Response {
    done(emulator.update_message(&email, &id, &change))
}

async fn delete_message(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
) -> Response {
    done(emulator.delete_message(&email, &id))
}

async fn access_token(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(
        emulator
            .access_token(&email)
            .map(|token| json!({ "access_token": token })),
    )
}

async fn revoke_grant(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.revoke_grant(&email))
}

async fn link_mailbox(
    AxumState(emulator): Emulator,
    Path((email, link_id)): Path<(String, String)>,
) -> Response {
    done(emulator.link_mailbox(&link_id, &email))
}

async fn expire_delta_tokens(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.expire_delta_tokens(&email))
}

#[derive(Deserialize)]
struct ContactId {
    id: Option<String>,
}

async fn upsert_contact(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
    Query(target): Query<ContactId>,
    Json(contact): Json<SeedContact>,
) -> Response {
    done(
        emulator
            .upsert_contact(&email, target.id, &contact)
            .map(|id| json!({ "id": id })),
    )
}

async fn remove_contact(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
) -> Response {
    done(emulator.remove_contact(&email, &id))
}

fn fault_list(emulator: &OutlookEmulator) -> Vec<Value> {
    emulator
        .faults()
        .into_iter()
        .map(|(id, fault)| json!({ "id": id, "fault": fault }))
        .collect()
}

async fn faults(AxumState(emulator): Emulator) -> Json<Vec<Value>> {
    Json(fault_list(&emulator))
}

async fn inject_fault(AxumState(emulator): Emulator, Json(fault): Json<Fault>) -> Json<Value> {
    Json(json!({ "id": emulator.inject_fault(fault) }))
}

async fn clear_faults(AxumState(emulator): Emulator) -> StatusCode {
    emulator.clear_faults();
    StatusCode::NO_CONTENT
}

async fn remove_fault(AxumState(emulator): Emulator, Path(id): Path<u64>) -> StatusCode {
    match emulator.remove_fault(id) {
        true => StatusCode::NO_CONTENT,
        false => StatusCode::NOT_FOUND,
    }
}

async fn clock(AxumState(emulator): Emulator) -> Json<Value> {
    Json(json!({ "now": emulator.now() }))
}

#[derive(Deserialize)]
struct Advance {
    seconds: u64,
}

async fn advance_clock(AxumState(emulator): Emulator, Json(advance): Json<Advance>) -> Json<Value> {
    emulator.advance_clock(Duration::from_secs(advance.seconds));
    Json(json!({ "now": emulator.now() }))
}

#[derive(Deserialize)]
struct RequestFilter {
    mailbox: Option<String>,
}

async fn requests(AxumState(emulator): Emulator, Query(filter): Query<RequestFilter>) -> Response {
    let mut requests = emulator.requests();
    if let Some(mailbox) = filter.mailbox {
        requests.retain(|request| request.mailbox.as_deref() == Some(mailbox.as_str()));
    }
    Json(requests).into_response()
}

async fn clear_requests(AxumState(emulator): Emulator) -> StatusCode {
    emulator.clear_requests();
    StatusCode::NO_CONTENT
}

async fn subscriptions(AxumState(emulator): Emulator) -> Response {
    Json(emulator.subscriptions()).into_response()
}

#[derive(Deserialize)]
struct Lifecycle {
    event: LifecycleEvent,
}

async fn send_lifecycle(
    AxumState(emulator): Emulator,
    Path(id): Path<String>,
    Json(lifecycle): Json<Lifecycle>,
) -> Response {
    done(emulator.send_lifecycle(&id, lifecycle.event))
}

async fn notifications(AxumState(emulator): Emulator) -> Response {
    Json(emulator.notifications()).into_response()
}
