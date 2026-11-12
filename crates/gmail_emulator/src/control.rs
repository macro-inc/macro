//! The control API under `/_emulator/`: what a test or a person uses to set
//! the emulator up and to look inside it. Each route calls the
//! [`GmailEmulator`] method of the same purpose.

use std::collections::HashMap;
use std::time::Duration;

use axum::extract::{Path, Query, State as AxumState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::fault::{Fault, Route};
use crate::gate::open_request;
use crate::seed::{NewMessage, PushConfig, Seed, SeedContact, SeedError, SeedMailbox};
use crate::{EmulatorError, GmailEmulator};

type Emulator = AxumState<GmailEmulator>;

/// A stored message at a glance.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub struct MessageSummary {
    /// The Gmail message id.
    pub id: String,
    /// The Gmail thread id.
    pub thread_id: String,
    /// The label ids on the message.
    pub labels: Vec<String>,
    /// The `Subject` header.
    pub subject: Option<String>,
    /// The `From` header.
    pub from: Option<String>,
    /// The `To` header.
    pub to: Option<String>,
    /// The `Message-ID` header, without angle brackets.
    pub message_id: Option<String>,
    /// Gmail's snippet of the body.
    pub snippet: String,
    /// Gmail's internal date.
    pub internal_date: Option<DateTime<Utc>>,
    /// The history id of the message's last change.
    pub history_id: u64,
}

impl GmailEmulator {
    /// A mailbox's messages, oldest first.
    pub fn messages(&self, email: &str) -> Result<Vec<MessageSummary>, EmulatorError> {
        let mut state = self.lock();
        let mailbox = state.mailbox_mut(email)?;
        let mut messages: Vec<MessageSummary> = mailbox
            .messages
            .values()
            .map(|message| MessageSummary {
                id: message.id.clone(),
                thread_id: message.thread_id.clone(),
                labels: message.labels.iter().cloned().collect(),
                subject: message.parsed.header("Subject").map(str::to_string),
                from: message.parsed.header("From").map(str::to_string),
                to: message.parsed.header("To").map(str::to_string),
                message_id: message.parsed.message_id.clone(),
                snippet: message.parsed.snippet.clone(),
                internal_date: DateTime::from_timestamp_millis(message.internal_date_ms),
                history_id: message.history_id,
            })
            .collect();
        messages.sort_by_key(|message| (message.internal_date, message.id.clone()));
        Ok(messages)
    }
}

impl IntoResponse for EmulatorError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::UnknownMailbox(_) => StatusCode::NOT_FOUND,
            Self::MailboxExists(_) => StatusCode::CONFLICT,
            Self::InvalidMessage(_) => StatusCode::BAD_REQUEST,
            Self::Rejected { status, .. } => {
                StatusCode::from_u16(*status).unwrap_or(StatusCode::BAD_REQUEST)
            }
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

pub(crate) fn router() -> Router<GmailEmulator> {
    let control = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/state", get(state))
        .route("/reset", post(reset))
        .route("/seed", post(seed))
        .route("/mailboxes", get(mailboxes).post(add_mailbox))
        .route("/mailboxes/{email}/messages", get(messages).post(deliver))
        .route("/mailboxes/{email}/messages/{id}", delete(delete_message))
        .route(
            "/mailboxes/{email}/messages/{id}/labels",
            post(modify_labels),
        )
        .route("/mailboxes/{email}/access-tokens", post(access_token))
        .route("/mailboxes/{email}/revoke", post(revoke_grant))
        .route("/mailboxes/{email}/history/expire", post(expire_history))
        .route("/mailboxes/{email}/push", post(push_now))
        .route("/mailboxes/{email}/contacts", post(upsert_contact))
        .route(
            "/mailboxes/{email}/contacts/{contact}",
            delete(remove_contact),
        )
        .route(
            "/mailboxes/{email}/contacts/expire-sync-tokens",
            post(expire_contact_sync_tokens),
        )
        .route(
            "/faults",
            get(faults).post(inject_fault).delete(clear_faults),
        )
        .route("/faults/{id}", delete(remove_fault))
        .route("/clock", get(clock))
        .route("/clock/advance", post(advance_clock))
        .route("/requests", get(requests).delete(clear_requests))
        .route("/push", get(push_config).put(set_push).delete(clear_push))
        .route("/push/deliveries", get(push_deliveries))
        .route(
            "/authentication-service/internal/google_access_token",
            get(authentication_service_token),
        );

    Router::new().nest("/_emulator", control)
}

fn done<T: Serialize>(result: Result<T, EmulatorError>) -> Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(error) => error.into_response(),
    }
}

/// A seed body: YAML or JSON, or nothing.
fn parse_seed(body: &str) -> Result<Seed, SeedError> {
    match body.trim().is_empty() {
        true => Ok(Seed::default()),
        false => Seed::parse(body),
    }
}

async fn state(AxumState(emulator): Emulator) -> Json<Value> {
    Json(json!({
        "now": emulator.now(),
        "push": emulator.push_config(),
        "mailboxes": emulator.mailboxes(),
        "faults": fault_list(&emulator),
        "requests": emulator.requests().len(),
        "push_deliveries": emulator.push_deliveries().len(),
    }))
}

async fn reset(AxumState(emulator): Emulator, body: String) -> Response {
    match parse_seed(&body).and_then(|seed| emulator.reset(&seed)) {
        Ok(()) => Json(emulator.mailboxes()).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn seed(AxumState(emulator): Emulator, body: String) -> Response {
    match parse_seed(&body).and_then(|seed| emulator.seed(&seed)) {
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

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LabelChange {
    #[serde(default)]
    add: Vec<String>,
    #[serde(default)]
    remove: Vec<String>,
}

async fn modify_labels(
    AxumState(emulator): Emulator,
    Path((email, id)): Path<(String, String)>,
    Json(change): Json<LabelChange>,
) -> Response {
    done(emulator.modify_labels(&email, &id, &change.add, &change.remove))
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

async fn expire_history(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.expire_history(&email))
}

async fn push_now(AxumState(emulator): Emulator, Path(email): Path<String>) -> Response {
    done(emulator.push_now(&email))
}

#[derive(Deserialize)]
struct ContactKind {
    #[serde(default)]
    other: bool,
}

async fn upsert_contact(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
    Query(kind): Query<ContactKind>,
    Json(contact): Json<SeedContact>,
) -> Response {
    done(emulator.upsert_contact(&email, contact, kind.other))
}

async fn remove_contact(
    AxumState(emulator): Emulator,
    Path((email, contact)): Path<(String, String)>,
    Query(kind): Query<ContactKind>,
) -> Response {
    done(
        emulator
            .remove_contact(&email, &contact, kind.other)
            .map(|removed| json!({ "removed": removed })),
    )
}

async fn expire_contact_sync_tokens(
    AxumState(emulator): Emulator,
    Path(email): Path<String>,
) -> Response {
    done(emulator.expire_contact_sync_tokens(&email))
}

fn fault_list(emulator: &GmailEmulator) -> Vec<Value> {
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
#[serde(deny_unknown_fields)]
struct Advance {
    seconds: u64,
}

async fn advance_clock(AxumState(emulator): Emulator, Json(advance): Json<Advance>) -> Json<Value> {
    emulator.advance_clock(Duration::from_secs(advance.seconds));
    Json(json!({ "now": emulator.now() }))
}

async fn requests(
    AxumState(emulator): Emulator,
    Query(filter): Query<HashMap<String, String>>,
) -> Response {
    let route = match filter.get("route").map(|route| route.parse::<Route>()) {
        None => None,
        Some(Ok(route)) => Some(route),
        Some(Err(_)) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let mailbox = filter.get("mailbox").map(|mailbox| mailbox.to_lowercase());

    let requests: Vec<_> = emulator
        .requests()
        .into_iter()
        .filter(|request| route.is_none_or(|route| request.route == Some(route)))
        .filter(|request| mailbox.is_none() || request.mailbox == mailbox)
        .collect();
    Json(requests).into_response()
}

async fn clear_requests(AxumState(emulator): Emulator) -> StatusCode {
    emulator.clear_requests();
    StatusCode::NO_CONTENT
}

async fn push_config(AxumState(emulator): Emulator) -> Json<Option<PushConfig>> {
    Json(emulator.push_config())
}

async fn set_push(AxumState(emulator): Emulator, Json(push): Json<PushConfig>) -> StatusCode {
    emulator.set_push(Some(push));
    StatusCode::NO_CONTENT
}

async fn clear_push(AxumState(emulator): Emulator) -> StatusCode {
    emulator.set_push(None);
    StatusCode::NO_CONTENT
}

async fn push_deliveries(AxumState(emulator): Emulator) -> Response {
    Json(emulator.push_deliveries()).into_response()
}

#[derive(Deserialize)]
struct TokenRequest {
    email: String,
}

/// Stands in for the authentication service's
/// `GET /internal/google_access_token`, which in production refreshes the
/// linked account's token with Google. It answers what that route answers:
/// the access token, 404 for an account that is not linked and 403 for a
/// grant Google no longer honours. Faults on `oauth.token` apply.
async fn authentication_service_token(
    AxumState(emulator): Emulator,
    Query(request): Query<TokenRequest>,
) -> Response {
    open_request(&emulator, Route::OauthToken, |state| {
        let email = request.email.to_lowercase();
        let Some(mailbox) = state.mailboxes.get(&email) else {
            return (None, StatusCode::NOT_FOUND.into_response());
        };
        if mailbox.revoked {
            return (Some(email), StatusCode::FORBIDDEN.into_response());
        }

        let response = match state.issue_access_token(&email) {
            Ok(token) => Json(json!({ "access_token": token })).into_response(),
            Err(error) => error.into_response(),
        };
        (Some(email), response)
    })
    .await
}
