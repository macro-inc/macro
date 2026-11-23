//! `users.drafts`. Like Gmail, saving a draft replaces its message with a
//! new one under a new message id.

use axum::extract::{Path, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

use super::{mailbox, raw_bytes, written};
use crate::GmailEmulator;
use crate::error::ApiError;
use crate::fault::Route;
use crate::gate::mailbox_request;
use crate::mailbox::message_json;
use crate::mime::Format;
use crate::state::State;

const DRAFT: &str = "DRAFT";

type Emulator = AxumState<GmailEmulator>;

pub(super) fn router() -> Router<GmailEmulator> {
    Router::new()
        .route("/drafts", get(list).post(create))
        .route("/drafts/send", post(send))
        .route("/drafts/{id}", get(read).put(update).delete(delete))
}

/// Stores a draft revision and returns its message id.
fn save_revision(
    state: &mut State,
    email: &str,
    body: &Value,
    thread_id: Option<&str>,
) -> Result<String, ApiError> {
    let raw = raw_bytes(&body["message"])?;
    let thread_id = body["message"]["threadId"].as_str().or(thread_id);
    let now_ms = state.now_ms();
    let mailbox = state
        .mailboxes
        .get_mut(email)
        .ok_or_else(ApiError::not_found)?;
    let (id, _) = mailbox.insert(
        &mut state.ids,
        now_ms,
        raw,
        &[DRAFT.to_string()],
        thread_id,
        None,
    )?;
    Ok(id)
}

fn draft_json(draft_id: &str, message: Json<Value>) -> Json<Value> {
    Json(json!({ "id": draft_id, "message": message.0 }))
}

async fn list(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsList,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let drafts: Vec<Value> = mailbox
                .drafts
                .iter()
                .filter_map(|(draft_id, message_id)| {
                    let message = mailbox.messages.get(message_id)?;
                    Some(json!({
                        "id": draft_id,
                        "message": { "id": message.id, "threadId": message.thread_id },
                    }))
                })
                .collect();

            let mut response = json!({ "resultSizeEstimate": drafts.len() });
            if !drafts.is_empty() {
                response["drafts"] = Value::Array(drafts);
            }
            Ok(Json(response))
        },
    )
    .await
}

async fn create(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsCreate,
        |state, email| {
            let message_id = save_revision(state, email, &body, None)?;
            let draft_id = format!("r{}", state.ids.nonce());
            let mailbox = mailbox(state, email)?;
            mailbox.drafts.insert(draft_id.clone(), message_id.clone());
            Ok(draft_json(&draft_id, written(mailbox, &message_id)?))
        },
    )
    .await
}

async fn read(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsGet,
        |state, email| {
            let nonce = state.ids.nonce();
            let mailbox = mailbox(state, email)?;
            let message = mailbox
                .drafts
                .get(&id)
                .and_then(|message_id| mailbox.messages.get(message_id))
                .ok_or_else(ApiError::not_found)?;
            Ok(draft_json(
                &id,
                Json(message_json(message, Format::Full, nonce)),
            ))
        },
    )
    .await
}

async fn update(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsUpdate,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let old_id = mailbox
                .drafts
                .get(&id)
                .cloned()
                .ok_or_else(ApiError::not_found)?;
            let thread_id = mailbox
                .messages
                .get(&old_id)
                .map(|message| message.thread_id.clone());

            let message_id = save_revision(state, email, &body, thread_id.as_deref())?;
            let now_ms = state.now_ms();
            let mailbox = super::mailbox(state, email)?;
            mailbox.delete(now_ms, &old_id)?;
            mailbox.drafts.insert(id.clone(), message_id.clone());
            Ok(draft_json(&id, written(mailbox, &message_id)?))
        },
    )
    .await
}

async fn delete(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsDelete,
        |state, email| {
            let now_ms = state.now_ms();
            let mailbox = mailbox(state, email)?;
            let message_id = mailbox
                .drafts
                .get(&id)
                .cloned()
                .ok_or_else(ApiError::not_found)?;
            mailbox.delete(now_ms, &message_id)?;
            Ok(StatusCode::NO_CONTENT)
        },
    )
    .await
}

async fn send(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        Some(&user),
        Route::DraftsSend,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let draft = body["id"]
                .as_str()
                .and_then(|draft_id| mailbox.drafts.get(draft_id))
                .and_then(|message_id| mailbox.messages.get(message_id))
                .ok_or_else(ApiError::not_found)?;
            let (draft_message_id, thread_id, raw) =
                (draft.id.clone(), draft.thread_id.clone(), draft.raw.clone());

            // The sent message keeps the draft's thread, so it is stored before
            // the draft, perhaps the thread's only message, is deleted.
            let (sent_id, _) = state.send(email, raw, Some(&thread_id))?;
            let now_ms = state.now_ms();
            let mailbox = super::mailbox(state, email)?;
            mailbox.delete(now_ms, &draft_message_id)?;
            written(mailbox, &sent_id)
        },
    )
    .await
}
