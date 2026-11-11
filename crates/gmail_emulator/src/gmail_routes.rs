//! The Gmail REST API: `/gmail/v1/users/{userId}/…`.

mod drafts;
mod settings;

use std::str::FromStr;

use axum::extract::{Path, Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};

use crate::GmailEmulator;
use crate::error::ApiError;
use crate::fault::Route;
use crate::gate::{Params, mailbox_request};
use crate::mailbox::{Mailbox, StoredMessage, label_json, message_json};
use crate::mime::{self, Format};
use crate::query::Query as SearchQuery;
use crate::state::State;

const LIST_DEFAULT: usize = 100;
const LIST_MAX: usize = 500;
const TRASH: &str = "TRASH";

type Emulator = AxumState<GmailEmulator>;
type Listed = Query<Vec<(String, String)>>;

pub(crate) fn router() -> Router<GmailEmulator> {
    let users = Router::new()
        .route("/profile", get(profile))
        .route("/messages", get(list_messages))
        .route("/messages/send", post(send_message))
        .route("/messages/import", post(import_message))
        .route("/messages/batchModify", post(batch_modify))
        .route("/messages/batchDelete", post(batch_delete))
        .route("/messages/{id}", get(get_message).delete(delete_message))
        .route("/messages/{id}/modify", post(modify_message))
        .route("/messages/{id}/trash", post(trash_message))
        .route("/messages/{id}/untrash", post(untrash_message))
        .route(
            "/messages/{id}/attachments/{attachment}",
            get(get_attachment),
        )
        .route("/threads", get(list_threads))
        .route("/threads/{id}", get(get_thread))
        .route("/labels", get(list_labels).post(create_label))
        .route(
            "/labels/{id}",
            get(get_label)
                .put(update_label)
                .patch(update_label)
                .delete(delete_label),
        )
        .route("/history", get(list_history))
        .route("/watch", post(watch))
        .route("/stop", post(stop))
        .merge(drafts::router())
        .merge(settings::router());

    Router::new().nest("/gmail/v1/users/{user}", users)
}

pub(crate) fn mailbox<'a>(state: &'a mut State, email: &str) -> Result<&'a mut Mailbox, ApiError> {
    state.mailboxes.get_mut(email).ok_or_else(ApiError::not_found)
}

fn format(params: &Params) -> Result<Format, ApiError> {
    match params.get("format") {
        None => Ok(Format::Full),
        Some(format) => Format::from_str(format)
            .map_err(|_| ApiError::invalid_argument(&format!("Invalid format: {format}"))),
    }
}

/// The `id`, `threadId` and `labelIds` Gmail answers a write with.
pub(crate) fn written(mailbox: &Mailbox, id: &str) -> Result<Json<Value>, ApiError> {
    let message = mailbox.messages.get(id).ok_or_else(ApiError::not_found)?;
    Ok(Json(json!({
        "id": message.id,
        "threadId": message.thread_id,
        "labelIds": message.labels,
    })))
}

pub(crate) fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.as_str().map(str::to_string))
        .collect()
}

/// The RFC 822 bytes in a request's `raw` field.
pub(crate) fn raw_bytes(body: &Value) -> Result<Vec<u8>, ApiError> {
    body["raw"]
        .as_str()
        .and_then(mime::decode_raw)
        .ok_or_else(|| ApiError::invalid_argument("Invalid value for ByteString: raw"))
}

async fn profile(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::GetProfile, |state, email| {
        let mailbox = mailbox(state, email)?;
        Ok(Json(json!({
            "emailAddress": mailbox.email,
            "messagesTotal": mailbox.messages.len(),
            "threadsTotal": mailbox.thread_count(),
            "historyId": mailbox.history_id.to_string(),
        })))
    })
    .await
}

/// The messages a `messages.list` or `threads.list` request selects.
fn selected<'a>(mailbox: &'a Mailbox, params: &Params) -> Vec<&'a StoredMessage> {
    let query = params.get("q").map(SearchQuery::parse);
    mailbox.search(
        &params.all("labelIds"),
        query.as_ref(),
        params.flag("includeSpamTrash"),
    )
}

/// One page of a list, as Gmail's list response under `key`.
fn page(key: &str, items: Vec<Value>, params: &Params) -> Result<Json<Value>, ApiError> {
    let size = params.page_size("maxResults", LIST_DEFAULT, LIST_MAX);
    let offset = params.offset()?;
    let total = items.len();
    let items: Vec<Value> = items.into_iter().skip(offset).take(size).collect();

    let mut response = json!({ "resultSizeEstimate": total });
    if !items.is_empty() {
        response[key] = Value::Array(items);
    }
    if offset + size < total {
        response["nextPageToken"] = json!((offset + size).to_string());
    }
    Ok(Json(response))
}

async fn list_messages(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesList, |state, email| {
        let mailbox = mailbox(state, email)?;
        let items = selected(mailbox, &params)
            .iter()
            .map(|message| json!({ "id": message.id, "threadId": message.thread_id }))
            .collect();
        page("messages", items, &params)
    })
    .await
}

async fn list_threads(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::ThreadsList, |state, email| {
        let mailbox = mailbox(state, email)?;
        let mut thread_ids: Vec<&str> = Vec::new();
        for message in selected(mailbox, &params) {
            if !thread_ids.contains(&message.thread_id.as_str()) {
                thread_ids.push(&message.thread_id);
            }
        }

        let items = thread_ids
            .iter()
            .filter_map(|thread_id| {
                let messages = mailbox.thread(thread_id);
                let newest = messages.last()?;
                let history_id = messages.iter().map(|message| message.history_id).max()?;
                Some(json!({
                    "id": thread_id,
                    "snippet": newest.parsed.snippet,
                    "historyId": history_id.to_string(),
                }))
            })
            .collect();
        page("threads", items, &params)
    })
    .await
}

async fn get_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesGet, |state, email| {
        let format = format(&params)?;
        let nonce = state.ids.nonce();
        let message = mailbox(state, email)?
            .messages
            .get(&id)
            .ok_or_else(ApiError::not_found)?;
        Ok(Json(message_json(message, format, nonce)))
    })
    .await
}

async fn get_thread(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::ThreadsGet, |state, email| {
        let format = format(&params)?;
        let nonce = state.ids.nonce();
        let messages = mailbox(state, email)?.thread(&id);
        let history_id = messages
            .iter()
            .map(|message| message.history_id)
            .max()
            .ok_or_else(ApiError::not_found)?;
        let messages: Vec<Value> = messages
            .iter()
            .map(|message| message_json(message, format, nonce))
            .collect();
        Ok(Json(json!({
            "id": id,
            "historyId": history_id.to_string(),
            "messages": messages,
        })))
    })
    .await
}

async fn get_attachment(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id, attachment)): Path<(String, String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::AttachmentsGet, |state, email| {
        let message = mailbox(state, email)?
            .messages
            .get(&id)
            .ok_or_else(ApiError::not_found)?;
        let part = mime::attachment_part_id(&attachment)
            .and_then(|part_id| mime::find_part(&message.parsed.payload, &part_id))
            .filter(|part| part.is_attachment)
            .ok_or_else(|| ApiError::invalid_argument("Invalid attachment token"))?;
        Ok(Json(json!({
            "size": part.body.len(),
            "data": mime::encode_body(&part.body),
        })))
    })
    .await
}

async fn send_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesSend, |state, email| {
        let raw = raw_bytes(&body)?;
        let (id, _) = state.send(email, raw, body["threadId"].as_str())?;
        written(mailbox(state, email)?, &id)
    })
    .await
}

async fn import_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Query(params): Listed,
    Json(body): Json<Value>,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesImport, |state, email| {
        let raw = raw_bytes(&body)?;
        let internal_date_ms = match params.get("internalDateSource") {
            Some("dateHeader") => mime::parse(&raw)
                .ok()
                .and_then(|parsed| mailparse::dateparse(parsed.header("Date")?).ok())
                .map(|seconds| seconds * 1000),
            _ => None,
        };
        let now_ms = state.now_ms();
        let mailbox = state.mailboxes.get_mut(email).ok_or_else(ApiError::not_found)?;
        let (id, _) = mailbox.insert(
            &mut state.ids,
            now_ms,
            raw,
            &strings(&body["labelIds"]),
            body["threadId"].as_str(),
            internal_date_ms,
        )?;
        written(mailbox, &id)
    })
    .await
}

async fn modify_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesModify, |state, email| {
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        mailbox.modify(
            now_ms,
            &id,
            &strings(&body["addLabelIds"]),
            &strings(&body["removeLabelIds"]),
        )?;
        written(mailbox, &id)
    })
    .await
}

async fn batch_modify(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let route = Route::MessagesBatchModify;
    mailbox_request(&emulator, &headers, Some(&user), route, |state, email| {
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        let add = strings(&body["addLabelIds"]);
        let remove = strings(&body["removeLabelIds"]);
        mailbox.check_labels(&add, &remove)?;

        // Gmail skips ids that name no message instead of failing the batch.
        for id in strings(&body["ids"]) {
            if mailbox.messages.contains_key(&id) {
                mailbox.modify(now_ms, &id, &add, &remove)?;
            }
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn batch_delete(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let route = Route::MessagesBatchDelete;
    mailbox_request(&emulator, &headers, Some(&user), route, |state, email| {
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        for id in strings(&body["ids"]) {
            if mailbox.messages.contains_key(&id) {
                mailbox.delete(now_ms, &id)?;
            }
        }
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn delete_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesDelete, |state, email| {
        let now_ms = state.now_ms();
        mailbox(state, email)?.delete(now_ms, &id)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn trash_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesTrash, |state, email| {
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        mailbox.modify(now_ms, &id, &[TRASH.to_string()], &["INBOX".to_string()])?;
        written(mailbox, &id)
    })
    .await
}

async fn untrash_message(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::MessagesUntrash, |state, email| {
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        mailbox.modify(now_ms, &id, &[], &[TRASH.to_string()])?;
        written(mailbox, &id)
    })
    .await
}

async fn list_labels(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::LabelsList, |state, email| {
        let labels: Vec<Value> = mailbox(state, email)?.labels.iter().map(label_json).collect();
        Ok(Json(json!({ "labels": labels })))
    })
    .await
}

async fn get_label(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::LabelsGet, |state, email| {
        let mailbox = mailbox(state, email)?;
        let label = mailbox.label(&id).ok_or_else(ApiError::not_found)?;
        Ok(Json(label_json(label)))
    })
    .await
}

async fn create_label(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::LabelsCreate, |state, email| {
        let name = body["name"].as_str().unwrap_or_default();
        let label = mailbox(state, email)?.create_label(name)?;
        Ok(Json(label_json(&label)))
    })
    .await
}

async fn update_label(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::LabelsUpdate, |state, email| {
        let name = body["name"]
            .as_str()
            .ok_or_else(|| ApiError::invalid_argument("Invalid label name"))?;
        let label = mailbox(state, email)?.rename_label(&id, name)?;
        Ok(Json(label_json(&label)))
    })
    .await
}

async fn delete_label(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path((user, id)): Path<(String, String)>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::LabelsDelete, |state, email| {
        mailbox(state, email)?.delete_label(&id)?;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}

async fn list_history(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, Some(&user), Route::HistoryList, |state, email| {
        let start = params
            .get("startHistoryId")
            .and_then(|start| start.parse::<u64>().ok())
            .ok_or_else(|| ApiError::invalid_argument("Invalid startHistoryId"))?;
        let now_ms = state.now_ms();
        mailbox(state, email)?
            .list_history(
                now_ms,
                start,
                &params.all("historyTypes"),
                params.get("labelId"),
                params.page_size("maxResults", LIST_DEFAULT, LIST_MAX),
                params.offset()?,
            )
            .map(Json)
    })
    .await
}

async fn watch(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::Watch, |state, email| {
        let topic = body["topicName"]
            .as_str()
            .filter(|topic| !topic.is_empty())
            .ok_or_else(|| ApiError::invalid_argument("Invalid topicName does not match"))?;
        let now_ms = state.now_ms();
        let mailbox = mailbox(state, email)?;
        let expiration_ms = mailbox.start_watch(now_ms, topic);
        Ok(Json(json!({
            "historyId": mailbox.history_id.to_string(),
            "expiration": expiration_ms.to_string(),
        })))
    })
    .await
}

async fn stop(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Path(user): Path<String>,
) -> Response {
    mailbox_request(&emulator, &headers, Some(&user), Route::Stop, |state, email| {
        mailbox(state, email)?.watch = None;
        Ok(StatusCode::NO_CONTENT)
    })
    .await
}
