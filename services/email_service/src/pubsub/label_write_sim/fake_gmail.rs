//! An in-process Gmail REST server holding one mailbox's labels and history.
//!
//! The real `GmailClient` talks to it over HTTP, so request encoding, status
//! mapping (429 → provider rate limit, 5xx → transient, 400 → permanent) and
//! response decoding are the production code paths.

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

/// How the fake answers one request.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Reply {
    #[default]
    Ok,
    /// 429 "Too many concurrent requests for user".
    RateLimited,
    /// 503, mapped to `EmailApiError::Transient`.
    Unavailable,
    /// 400, mapped to `EmailApiError::Permanent`.
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Write,
    ReadLabels,
    ReadFull,
    Other,
}

#[derive(Clone, Debug)]
pub struct Logged {
    pub kind: Kind,
    pub ids: Vec<String>,
    pub add: Vec<String>,
    pub remove: Vec<String>,
    pub reply: Reply,
    /// Labels Gmail returned for a read.
    pub returned: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct GmailMessage {
    pub thread_id: String,
    pub labels: BTreeSet<String>,
    pub internal_date_ms: i64,
}

#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub id: u64,
    pub message_id: String,
    pub thread_id: String,
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub message_added: bool,
}

/// Where a paused request waits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PauseAt {
    /// The request has not reached Gmail yet: it is applied on release.
    BeforeApply,
    /// Gmail answered (and applied a write) on arrival; the answer is
    /// delivered on release.
    AfterApply,
}

struct Pause {
    kind: Kind,
    message: Option<String>,
    at: PauseAt,
    arrived: oneshot::Sender<()>,
    release: oneshot::Receiver<()>,
}

pub struct PauseHandle {
    pub arrived: oneshot::Receiver<()>,
    pub release: oneshot::Sender<()>,
}

#[derive(Default)]
pub struct GmailState {
    pub messages: BTreeMap<String, GmailMessage>,
    pub labels: Vec<(String, String, String)>,
    pub history_id: u64,
    pub history: Vec<HistoryEntry>,
    pub next_writes: VecDeque<Reply>,
    pub default_write: Reply,
    pub next_reads: VecDeque<Reply>,
    pub default_read: Reply,
    pub log: Vec<Logged>,
    pause: Option<Pause>,
}

#[derive(Clone)]
pub struct FakeGmail {
    pub state: Arc<Mutex<GmailState>>,
    pub url: String,
}

enum Request {
    Modify {
        ids: Vec<String>,
        add: Vec<String>,
        remove: Vec<String>,
    },
    GetMessage {
        id: String,
        minimal: bool,
    },
    GetThread {
        id: String,
    },
    ListLabels,
    History {
        start: u64,
    },
    Other,
}

impl Request {
    fn kind(&self) -> Kind {
        match self {
            Request::Modify { .. } => Kind::Write,
            Request::GetMessage { minimal: true, .. } => Kind::ReadLabels,
            Request::GetMessage { minimal: false, .. } => Kind::ReadFull,
            _ => Kind::Other,
        }
    }

    fn message_ids(&self) -> Vec<String> {
        match self {
            Request::Modify { ids, .. } => ids.clone(),
            Request::GetMessage { id, .. } => vec![id.clone()],
            _ => Vec::new(),
        }
    }
}

impl FakeGmail {
    pub async fn start(state: GmailState) -> FakeGmail {
        let state = Arc::new(Mutex::new(state));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake gmail");
        let url = format!("http://{}/gmail/v1", listener.local_addr().unwrap());
        let fake = FakeGmail { state, url };
        let app = Router::new().fallback(handle).with_state(fake.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        fake
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, GmailState> {
        self.state.lock().unwrap()
    }

    /// Holds the next request of `kind` (for `message`, when given) until the
    /// returned handle releases it.
    pub fn pause_next(&self, kind: Kind, message: Option<&str>, at: PauseAt) -> PauseHandle {
        let (arrived_tx, arrived_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel();
        self.lock().pause = Some(Pause {
            kind,
            message: message.map(str::to_string),
            at,
            arrived: arrived_tx,
            release: release_rx,
        });
        PauseHandle {
            arrived: arrived_rx,
            release: release_tx,
        }
    }

    pub fn clear_pause(&self) {
        self.lock().pause = None;
    }

    /// A change made in Gmail itself (web UI, phone), recorded in history.
    pub fn external_change(&self, message: &str, add: &[&str], remove: &[&str]) {
        let mut state = self.lock();
        let add: Vec<String> = add.iter().map(|label| label.to_string()).collect();
        let remove: Vec<String> = remove.iter().map(|label| label.to_string()).collect();
        state.apply(&[message.to_string()], &add, &remove);
    }

    fn choose_reply(&self, request: &Request) -> Reply {
        let mut state = self.lock();
        match request.kind() {
            Kind::Write => state.next_writes.pop_front().unwrap_or(state.default_write),
            Kind::ReadLabels | Kind::ReadFull => {
                state.next_reads.pop_front().unwrap_or(state.default_read)
            }
            Kind::Other => Reply::Ok,
        }
    }

    fn respond(&self, request: &Request, reply: Reply) -> Response {
        let mut state = self.lock();
        let kind = request.kind();
        let (add, remove) = match request {
            Request::Modify { add, remove, .. } => (add.clone(), remove.clone()),
            _ => (Vec::new(), Vec::new()),
        };
        let mut entry = Logged {
            kind,
            ids: request.message_ids(),
            add,
            remove,
            reply,
            returned: Vec::new(),
        };
        let response = match reply {
            Reply::RateLimited => error(429, "Too many concurrent requests for user."),
            Reply::Unavailable => error(503, "The service is currently unavailable."),
            Reply::Rejected => error(400, "Invalid label"),
            Reply::Ok => match request {
                Request::Modify { ids, add, remove } => {
                    state.apply(ids, add, remove);
                    StatusCode::NO_CONTENT.into_response()
                }
                Request::GetMessage { id, minimal } => match state.messages.get(id) {
                    None => error(404, "Requested entity was not found."),
                    Some(message) => {
                        entry.returned = message.labels.iter().cloned().collect();
                        let body = if *minimal {
                            json!({
                                "id": id,
                                "threadId": message.thread_id,
                                "labelIds": message.labels,
                            })
                        } else {
                            full_message(id, message, state.history_id)
                        };
                        (StatusCode::OK, axum::Json(body)).into_response()
                    }
                },
                Request::GetThread { id } => {
                    let messages: Vec<Value> = state
                        .messages
                        .iter()
                        .filter(|(_, message)| message.thread_id == *id)
                        .map(|(message_id, message)| {
                            full_message(message_id, message, state.history_id)
                        })
                        .collect();
                    (
                        StatusCode::OK,
                        axum::Json(json!({ "id": id, "messages": messages })),
                    )
                        .into_response()
                }
                Request::ListLabels => {
                    let labels: Vec<Value> = state
                        .labels
                        .iter()
                        .map(|(id, name, label_type)| {
                            json!({
                                "id": id,
                                "name": name,
                                "type": label_type,
                                "messageListVisibility": "show",
                                "labelListVisibility": "labelShow",
                            })
                        })
                        .collect();
                    (StatusCode::OK, axum::Json(json!({ "labels": labels }))).into_response()
                }
                Request::History { start } => {
                    let history: Vec<Value> = state
                        .history
                        .iter()
                        .filter(|entry| entry.id > *start)
                        .map(history_record)
                        .collect();
                    (
                        StatusCode::OK,
                        axum::Json(json!({
                            "history": history,
                            "historyId": state.history_id.to_string(),
                        })),
                    )
                        .into_response()
                }
                Request::Other => (StatusCode::OK, axum::Json(json!({}))).into_response(),
            },
        };
        state.log.push(entry);
        response
    }
}

impl GmailState {
    fn apply(&mut self, ids: &[String], add: &[String], remove: &[String]) {
        for id in ids {
            // batchModify ignores ids that name no message.
            let Some(message) = self.messages.get_mut(id) else {
                continue;
            };
            let mut added = Vec::new();
            let mut removed = Vec::new();
            for label in add {
                if message.labels.insert(label.clone()) {
                    added.push(label.clone());
                }
            }
            for label in remove {
                if message.labels.remove(label) {
                    removed.push(label.clone());
                }
            }
            if added.is_empty() && removed.is_empty() {
                continue;
            }
            let thread_id = message.thread_id.clone();
            self.history_id += 1;
            let entry = HistoryEntry {
                id: self.history_id,
                message_id: id.clone(),
                thread_id,
                added,
                removed,
                message_added: false,
            };
            self.history.push(entry);
        }
    }

    fn take_pause_for(&mut self, request: &Request) -> Option<Pause> {
        let pause = self.pause.as_ref()?;
        if pause.kind != request.kind() {
            return None;
        }
        if let Some(message) = &pause.message
            && !request.message_ids().contains(message)
        {
            return None;
        }
        self.pause.take()
    }
}

async fn handle(State(gmail): State<FakeGmail>, method: Method, uri: Uri, body: Bytes) -> Response {
    let request = parse(&method, &uri, &body);
    // The answer is decided on arrival, even when it is applied later.
    let reply = gmail.choose_reply(&request);
    let pause = gmail.lock().take_pause_for(&request);
    match pause {
        None => gmail.respond(&request, reply),
        Some(pause) => match pause.at {
            PauseAt::BeforeApply => {
                let _ = pause.arrived.send(());
                let _ = pause.release.await;
                gmail.respond(&request, reply)
            }
            PauseAt::AfterApply => {
                let response = gmail.respond(&request, reply);
                let _ = pause.arrived.send(());
                let _ = pause.release.await;
                response
            }
        },
    }
}

fn parse(method: &Method, uri: &Uri, body: &[u8]) -> Request {
    let path = uri
        .path()
        .trim_start_matches("/gmail/v1/users/me/")
        .to_string();
    let query = uri.query().unwrap_or("");
    let segments: Vec<&str> = path.split('/').collect();
    let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let strings = |field: &str| -> Vec<String> {
        json.get(field)
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    match (method.as_str(), segments.as_slice()) {
        ("POST", ["messages", "batchModify"]) => Request::Modify {
            ids: strings("ids"),
            add: strings("addLabelIds"),
            remove: strings("removeLabelIds"),
        },
        ("POST", ["messages", id, "modify"]) => Request::Modify {
            ids: vec![id.to_string()],
            add: strings("addLabelIds"),
            remove: strings("removeLabelIds"),
        },
        ("GET", ["messages", id]) => Request::GetMessage {
            id: id.to_string(),
            minimal: query.contains("format=minimal"),
        },
        ("GET", ["threads", id]) => Request::GetThread { id: id.to_string() },
        ("GET", ["labels"]) => Request::ListLabels,
        ("GET", ["history"]) => Request::History {
            start: query
                .split('&')
                .find_map(|pair| pair.strip_prefix("startHistoryId="))
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
        },
        _ => Request::Other,
    }
}

fn error(code: u16, message: &str) -> Response {
    (
        StatusCode::from_u16(code).unwrap(),
        axum::Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response()
}

fn full_message(id: &str, message: &GmailMessage, history_id: u64) -> Value {
    let body = base64::engine::general_purpose::URL_SAFE.encode(format!("Body of {id}"));
    let date = chrono::DateTime::from_timestamp_millis(message.internal_date_ms)
        .unwrap()
        .to_rfc2822();
    json!({
        "id": id,
        "threadId": message.thread_id,
        "labelIds": message.labels,
        "snippet": format!("Body of {id}"),
        "sizeEstimate": 100,
        "historyId": history_id.to_string(),
        "internalDate": message.internal_date_ms.to_string(),
        "payload": {
            "partId": "",
            "mimeType": "text/plain",
            "filename": "",
            "headers": [
                { "name": "From", "value": "Alice Sender <alice@example.org>" },
                { "name": "To", "value": "Sim Owner <sim@example.com>" },
                { "name": "Subject", "value": format!("Thread {}", message.thread_id) },
                { "name": "Date", "value": date },
                { "name": "Message-ID", "value": format!("<{id}@example.org>") },
            ],
            "body": { "size": 12, "data": body },
        },
    })
}

fn history_record(entry: &HistoryEntry) -> Value {
    let message = json!({ "id": entry.message_id, "threadId": entry.thread_id });
    let mut record = json!({ "id": entry.id.to_string(), "messages": [message] });
    if !entry.added.is_empty() {
        record["labelsAdded"] = json!([{ "message": message, "labelIds": entry.added }]);
    }
    if !entry.removed.is_empty() {
        record["labelsRemoved"] = json!([{ "message": message, "labelIds": entry.removed }]);
    }
    if entry.message_added {
        record["messagesAdded"] = json!([{ "message": message }]);
    }
    record
}
