#![deny(missing_docs)]
//! An in-memory stand-in for deadsimple.email's REST API, for local stacks
//! and previews without a provider key. No real mail moves: mail between
//! two fake mailboxes is delivered to the other in memory, anything else is
//! kept in an outbox. Every response says `x-fake-vendor: not-live`.
//!
//! It serves the subset of the API the `agent_mailbox` deadsimple adapter uses,
//! in the same shapes, and enforces the same confinement: a mailbox-scoped
//! key sees only its own mailbox (`404` for any other), and only the
//! provisioning key may create, scope or delete.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

/// The domain fake mailboxes get; never a real one.
pub const FAKE_DOMAIN: &str = "fake-vendor.invalid";

/// Said on every response.
pub const FAKE_VENDOR_HEADER: &str = "x-fake-vendor";

#[derive(Clone, Serialize)]
struct FakeMessage {
    message_id: String,
    inbox_id: String,
    thread_id: String,
    direction: &'static str,
    from_email: String,
    to: Vec<String>,
    cc: Vec<String>,
    subject: String,
    text_body: String,
    created_at: DateTime<Utc>,
}

#[derive(Clone)]
struct FakeInbox {
    email: String,
    tags: Vec<String>,
}

#[derive(Default)]
struct VendorState {
    inboxes: HashMap<String, FakeInbox>,
    /// Scoped key → (key id, inbox).
    scoped_keys: HashMap<String, (String, String)>,
    messages: Vec<FakeMessage>,
    /// Mail addressed outside the fake: kept, never sent.
    outbox: Vec<FakeMessage>,
    /// (credential, idempotency key) → the operation it was used for and the
    /// response it got. Scoped per credential, not per endpoint, as many real
    /// APIs scope it, so a key reused across operations is caught.
    replays: HashMap<String, (String, Value)>,
    /// Random per process, so ids never repeat across restarts of the fake,
    /// as a real provider's never do.
    run: String,
    next_id: u64,
}

impl VendorState {
    fn new() -> Self {
        let run = Uuid::new_v4().simple().to_string();
        Self {
            run: run[..8].to_owned(),
            ..Self::default()
        }
    }

    fn id(&mut self, prefix: &str) -> String {
        self.next_id += 1;
        format!("{prefix}-{}-{:08}", self.run, self.next_id)
    }
}

/// The fake's shared state and its provisioning key.
#[derive(Clone)]
pub struct FakeVendor {
    state: Arc<Mutex<VendorState>>,
    admin_key: Arc<str>,
}

impl FakeVendor {
    /// A fake that accepts `admin_key` as its provisioning key.
    #[must_use]
    pub fn new(admin_key: &str) -> Self {
        Self {
            state: Arc::new(Mutex::new(VendorState::new())),
            admin_key: Arc::from(admin_key),
        }
    }

    /// The fake's HTTP API.
    pub fn router(self) -> Router {
        Router::new()
            .route("/v1/inboxes", post(create_inbox).get(list_inboxes))
            .route("/v1/inboxes/{inbox_id}", delete(delete_inbox))
            .route("/v1/inboxes/{inbox_id}/guardrails", put(set_guardrails))
            .route("/v1/api-keys", post(create_api_key).get(list_api_keys))
            .route("/v1/api-keys/{key_id}", delete(revoke_api_key))
            .route(
                "/v1/inboxes/{inbox_id}/messages",
                get(list_messages).post(send_message),
            )
            .route(
                "/v1/inboxes/{inbox_id}/messages/{message_id}",
                get(read_message),
            )
            .route(
                "/v1/inboxes/{inbox_id}/messages/{message_id}/reply",
                post(reply),
            )
            .route("/fake/deliver", post(deliver_from_outside))
            .route("/fake/outbox", get(outbox))
            .layer(middleware::from_fn(label))
            .with_state(self)
    }
}

async fn label(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        HeaderName::from_static(FAKE_VENDOR_HEADER),
        HeaderValue::from_static("not-live"),
    );
    response
}

fn error(status: StatusCode, code: &str) -> Response {
    (
        status,
        Json(json!({"error": {"code": code, "message": code}})),
    )
        .into_response()
}

fn data(status: StatusCode, value: Value) -> Response {
    (status, Json(json!({"data": value}))).into_response()
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

impl FakeVendor {
    fn is_admin(&self, headers: &HeaderMap) -> bool {
        bearer(headers) == Some(&*self.admin_key)
    }

    /// The inbox a scoped key may use, when it matches the path's.
    fn scoped_inbox(&self, headers: &HeaderMap, inbox_id: &str) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        bearer(headers)
            .and_then(|key| state.scoped_keys.get(key))
            .is_some_and(|(_, inbox)| inbox == inbox_id)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, VendorState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn idempotency_key(headers: &HeaderMap) -> Option<String> {
    let key = headers.get("idempotency-key")?.to_str().ok()?;
    Some(format!("{}:{key}", bearer(headers).unwrap_or_default()))
}

/// A replayed answer, or a refusal when the key was used for another operation.
fn replayed(state: &VendorState, key: Option<&String>, operation: &str) -> Option<Response> {
    let (used_for, answer) = state.replays.get(key?)?;
    if used_for != operation {
        return Some(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "idempotency_key_reused",
        ));
    }
    Some(data(StatusCode::CREATED, answer.clone()))
}

#[derive(Deserialize)]
struct CreateInboxBody {
    local_part: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
}

async fn create_inbox(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Json(body): Json<CreateInboxBody>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::PAYMENT_REQUIRED, "payment_required");
    }
    let replay_key = idempotency_key(&headers);
    let operation = "create_inbox".to_owned();
    let mut state = vendor.lock();
    if let Some(answer) = replayed(&state, replay_key.as_ref(), &operation) {
        return answer;
    }

    let inbox_id = state.id("inbox");
    let local_part = body.local_part.unwrap_or_else(|| inbox_id.clone());
    let email = format!("{local_part}@{FAKE_DOMAIN}");
    if state.inboxes.values().any(|inbox| inbox.email == email) {
        return error(StatusCode::CONFLICT, "address_taken");
    }
    state.inboxes.insert(
        inbox_id.clone(),
        FakeInbox {
            email: email.clone(),
            tags: body.tags.clone(),
        },
    );

    let created =
        json!({"inbox_id": inbox_id, "email": email, "tags": body.tags, "status": "active"});
    if let Some(key) = replay_key {
        state.replays.insert(key, (operation, created.clone()));
    }
    data(StatusCode::CREATED, created)
}

#[derive(Deserialize)]
struct ListInboxesQuery {
    tag: Option<String>,
}

async fn list_inboxes(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Query(query): Query<ListInboxesQuery>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let state = vendor.lock();
    let inboxes: Vec<Value> = state
        .inboxes
        .iter()
        .filter(|(_, inbox)| {
            query
                .tag
                .as_ref()
                .is_none_or(|tag| inbox.tags.contains(tag))
        })
        .map(|(id, inbox)| json!({"inbox_id": id, "email": inbox.email, "tags": inbox.tags}))
        .collect();
    data(
        StatusCode::OK,
        json!({"inboxes": inboxes, "count": inboxes.len()}),
    )
}

async fn set_guardrails(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path(inbox_id): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    if !vendor.lock().inboxes.contains_key(&inbox_id) {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    data(StatusCode::OK, body)
}

async fn delete_inbox(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path(inbox_id): Path<String>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let mut state = vendor.lock();
    if state.inboxes.remove(&inbox_id).is_none() {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    state
        .messages
        .retain(|message| message.inbox_id != inbox_id);
    StatusCode::NO_CONTENT.into_response()
}

#[derive(Deserialize)]
struct CreateApiKeyBody {
    inbox_ids: Vec<String>,
}

async fn create_api_key(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Json(body): Json<CreateApiKeyBody>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let replay_key = idempotency_key(&headers);
    let operation = "create_api_key".to_owned();
    let mut state = vendor.lock();
    if let Some(answer) = replayed(&state, replay_key.as_ref(), &operation) {
        return answer;
    }

    // The fake supports only what Macro mints: a key for exactly one inbox.
    let [inbox_id] = body.inbox_ids.as_slice() else {
        return error(StatusCode::BAD_REQUEST, "one_inbox_only");
    };
    if !state.inboxes.contains_key(inbox_id) {
        return error(StatusCode::BAD_REQUEST, "unknown_inbox");
    }
    let key_id = state.id("key");
    let key = format!("dse_fake_scoped_{key_id}");
    state
        .scoped_keys
        .insert(key.clone(), (key_id.clone(), inbox_id.clone()));

    let created = json!({"key_id": key_id, "key": key, "inbox_ids": [inbox_id]});
    if let Some(replay_key) = replay_key {
        state
            .replays
            .insert(replay_key, (operation, created.clone()));
    }
    data(StatusCode::CREATED, created)
}

/// Scoped keys, without their secrets, as the real API lists them.
async fn list_api_keys(State(vendor): State<FakeVendor>, headers: HeaderMap) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let state = vendor.lock();
    let keys: Vec<Value> = state
        .scoped_keys
        .values()
        .map(|(key_id, inbox_id)| json!({"key_id": key_id, "inbox_ids": [inbox_id]}))
        .collect();
    data(
        StatusCode::OK,
        json!({"api_keys": keys, "count": keys.len()}),
    )
}

async fn revoke_api_key(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path(key_id): Path<String>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let mut state = vendor.lock();
    let before = state.scoped_keys.len();
    state.scoped_keys.retain(|_, (id, _)| id != &key_id);
    if state.scoped_keys.len() == before {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn list_messages(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path(inbox_id): Path<String>,
) -> Response {
    if !vendor.scoped_inbox(&headers, &inbox_id) {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    let state = vendor.lock();
    let mut messages: Vec<&FakeMessage> = state
        .messages
        .iter()
        .filter(|message| message.inbox_id == inbox_id)
        .collect();
    messages.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    // Listings carry no bodies, as the real API's message summaries don't.
    let summaries: Vec<Value> = messages
        .iter()
        .map(|message| {
            let mut summary = json!(message);
            if let Some(fields) = summary.as_object_mut() {
                fields.remove("text_body");
            }
            summary
        })
        .collect();
    data(
        StatusCode::OK,
        json!({"messages": summaries, "count": summaries.len()}),
    )
}

async fn read_message(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path((inbox_id, message_id)): Path<(String, String)>,
) -> Response {
    if !vendor.scoped_inbox(&headers, &inbox_id) {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    let state = vendor.lock();
    match state
        .messages
        .iter()
        .find(|message| message.inbox_id == inbox_id && message.message_id == message_id)
    {
        Some(message) => data(StatusCode::OK, json!(message)),
        None => error(StatusCode::NOT_FOUND, "not_found"),
    }
}

#[derive(Deserialize)]
struct SendBody {
    to: Vec<String>,
    #[serde(default)]
    cc: Vec<String>,
    subject: String,
    text_body: String,
}

/// One message on its way: from a fake mailbox, or from outside when
/// `from_inbox` is absent.
struct Mail<'a> {
    from_inbox: Option<&'a str>,
    from_email: &'a str,
    to: &'a [String],
    cc: &'a [String],
    subject: &'a str,
    text_body: &'a str,
    thread_id: &'a str,
}

/// Records the sent copy, then delivers to each fake recipient's mailbox and
/// keeps a copy of anything addressed outside the fake.
fn deliver(state: &mut VendorState, mail: Mail<'_>) -> String {
    let Mail {
        from_inbox,
        from_email,
        to,
        cc,
        subject,
        text_body,
        thread_id,
    } = mail;
    let now = Utc::now();
    let message_id = state.id("msg");
    let sent = FakeMessage {
        message_id: message_id.clone(),
        inbox_id: from_inbox.unwrap_or_default().to_owned(),
        thread_id: thread_id.to_owned(),
        direction: "outbound",
        from_email: from_email.to_owned(),
        to: to.to_vec(),
        cc: cc.to_vec(),
        subject: subject.to_owned(),
        text_body: text_body.to_owned(),
        created_at: now,
    };
    if from_inbox.is_some() {
        state.messages.push(sent.clone());
    }

    for recipient in to.iter().chain(cc) {
        let target = state
            .inboxes
            .iter()
            .find(|(_, inbox)| inbox.email.eq_ignore_ascii_case(recipient))
            .map(|(id, _)| id.clone());
        match target {
            Some(inbox_id) => {
                let received_id = state.id("msg");
                state.messages.push(FakeMessage {
                    message_id: received_id,
                    inbox_id,
                    direction: "inbound",
                    ..sent.clone()
                });
            }
            None => state.outbox.push(sent.clone()),
        }
    }
    message_id
}

async fn send_message(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path(inbox_id): Path<String>,
    Json(body): Json<SendBody>,
) -> Response {
    if !vendor.scoped_inbox(&headers, &inbox_id) {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    let replay_key = idempotency_key(&headers);
    let operation = format!("send:{inbox_id}");
    let mut state = vendor.lock();
    if let Some(answer) = replayed(&state, replay_key.as_ref(), &operation) {
        return answer;
    }
    let Some(from_email) = state
        .inboxes
        .get(&inbox_id)
        .map(|inbox| inbox.email.clone())
    else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };

    let thread_id = state.id("thread");
    let message_id = deliver(
        &mut state,
        Mail {
            from_inbox: Some(&inbox_id),
            from_email: &from_email,
            to: &body.to,
            cc: &body.cc,
            subject: &body.subject,
            text_body: &body.text_body,
            thread_id: &thread_id,
        },
    );
    let sent = json!({"message_id": message_id, "thread_id": thread_id, "status": "sent"});
    if let Some(key) = replay_key {
        state.replays.insert(key, (operation, sent.clone()));
    }
    data(StatusCode::CREATED, sent)
}

#[derive(Deserialize)]
struct ReplyBody {
    text_body: String,
}

async fn reply(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Path((inbox_id, message_id)): Path<(String, String)>,
    Json(body): Json<ReplyBody>,
) -> Response {
    if !vendor.scoped_inbox(&headers, &inbox_id) {
        return error(StatusCode::NOT_FOUND, "not_found");
    }
    let replay_key = idempotency_key(&headers);
    let operation = format!("reply:{inbox_id}:{message_id}");
    let mut state = vendor.lock();
    if let Some(answer) = replayed(&state, replay_key.as_ref(), &operation) {
        return answer;
    }
    let Some(original) = state
        .messages
        .iter()
        .find(|message| message.inbox_id == inbox_id && message.message_id == message_id)
        .cloned()
    else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };
    let Some(from_email) = state
        .inboxes
        .get(&inbox_id)
        .map(|inbox| inbox.email.clone())
    else {
        return error(StatusCode::NOT_FOUND, "not_found");
    };

    // The other side of the conversation, as the real API defaults to.
    let recipients = if original.direction == "inbound" {
        vec![original.from_email.clone()]
    } else {
        original.to.clone()
    };
    let subject = if original.subject.starts_with("Re: ") {
        original.subject.clone()
    } else {
        format!("Re: {}", original.subject)
    };
    let sent_id = deliver(
        &mut state,
        Mail {
            from_inbox: Some(&inbox_id),
            from_email: &from_email,
            to: &recipients,
            cc: &[],
            subject: &subject,
            text_body: &body.text_body,
            thread_id: &original.thread_id,
        },
    );
    let sent = json!({"message_id": sent_id, "thread_id": original.thread_id, "status": "sent"});
    if let Some(key) = replay_key {
        state.replays.insert(key, (operation, sent.clone()));
    }
    data(StatusCode::CREATED, sent)
}

#[derive(Deserialize)]
struct OutsideMail {
    from: String,
    to: String,
    subject: String,
    text_body: String,
}

/// Simulates mail arriving from outside the fake, for demos.
async fn deliver_from_outside(
    State(vendor): State<FakeVendor>,
    headers: HeaderMap,
    Json(mail): Json<OutsideMail>,
) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    let mut state = vendor.lock();
    let thread_id = state.id("thread");
    deliver(
        &mut state,
        Mail {
            from_inbox: None,
            from_email: &mail.from,
            to: std::slice::from_ref(&mail.to),
            cc: &[],
            subject: &mail.subject,
            text_body: &mail.text_body,
            thread_id: &thread_id,
        },
    );
    StatusCode::ACCEPTED.into_response()
}

/// Mail addressed outside the fake, which it kept instead of sending.
async fn outbox(State(vendor): State<FakeVendor>, headers: HeaderMap) -> Response {
    if !vendor.is_admin(&headers) {
        return error(StatusCode::UNAUTHORIZED, "unauthorized");
    }
    data(StatusCode::OK, json!({"messages": vendor.lock().outbox}))
}
