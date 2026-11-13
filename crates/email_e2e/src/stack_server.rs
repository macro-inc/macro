//! Stacks over HTTP, for tests that are not written in Rust: the web app's
//! browser suite (`apps/web/tests/email-e2e`) starts a stack per test here,
//! then talks to the stack's services and emulators directly.
//!
//! Every stack serves the GraphQL API, which the web app reads mail through.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rootcause::prelude::*;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::inbox::{Inbox, Mail, MailAttachment, Provider, ProviderMessage};
use crate::stack::{Stack, StackOptions};
use crate::user::User;

/// One stack and the users created in it, by address.
struct Running {
    stack: Stack,
    users: HashMap<String, User>,
    inboxes: HashMap<String, Inbox>,
}

type Stacks = Arc<Mutex<HashMap<String, Arc<Mutex<Running>>>>>;

/// A failed request: the report as text, for the test's output.
struct Failed(StatusCode, String);

impl From<Report> for Failed {
    fn from(report: Report) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, format!("{report:?}"))
    }
}

impl IntoResponse for Failed {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

/// Serves the stack routes on `listener` until the process is stopped.
///
/// - `POST /stacks` (`{"env": {..}}`) starts a stack and answers
///   its id and where its services and emulators listen.
/// - `POST /stacks/{id}/users` (`{"email": ..}`) creates a Macro user.
/// - `POST /stacks/{id}/inboxes` (`{"user": .., "provider": "GMAIL" |
///   "OUTLOOK", "address": ..}`) links a mailbox and waits for its first sync.
/// - `POST /stacks/{id}/inboxes/{address}/messages` (`{"from": .., "subject":
///   .., "text": .., "html", "to", "cc", "messageId", "inReplyTo",
///   "attachments": [{"filename", "mimeType", "base64"}]}`) puts a message in
///   the mailbox at the provider, as if it had just arrived; `GET` lists what
///   the provider holds.
/// - `GET /stacks/{id}/service-requests` lists what the email services asked
///   the other Macro services.
/// - `POST /stacks/{id}/service-failures` (`{"service", "method",
///   "pathPrefix", "status", "body"}`) makes a Macro service stand-in answer
///   an error once; `POST /stacks/{id}/queue-refusals` (`{"queue", "times"}`)
///   refuses the services' next sends to a queue.
/// - `GET /stacks/{id}/stored-objects` lists what the services stored
///   (`bucket`, `key`, `contentType`, `base64`).
/// - `POST /stacks/{id}/seed` (`{"provider", "address", "mail": [..]}`) puts
///   mail in a mailbox before anyone links it.
/// - `POST /stacks/{id}/sql` (`{"query"}`) runs a query that returns rows on
///   the stack's database and answers them as JSON objects: the last resort
///   for what no API shows.
/// - `POST /stacks/{id}/scheduled-sweep` runs the scheduled-send sweep once.
/// - `DELETE /stacks/{id}` ends the stack; it fails when a service died or
///   panicked.
pub async fn serve_stacks(listener: TcpListener) -> Result<(), Report> {
    let stacks = Stacks::default();
    let app = Router::new()
        .route("/stacks", post(start))
        .route("/stacks/{id}", delete(finish))
        .route("/stacks/{id}/users", post(create_user))
        .route("/stacks/{id}/inboxes", post(link_inbox))
        .route(
            "/stacks/{id}/inboxes/{address}/messages",
            get(provider_messages).post(deliver),
        )
        .route("/stacks/{id}/service-requests", get(service_requests))
        .route("/stacks/{id}/service-failures", post(fail_service_request))
        .route("/stacks/{id}/queue-refusals", post(refuse_queue_sends))
        .route("/stacks/{id}/stored-objects", get(stored_objects))
        .route("/stacks/{id}/seed", post(seed_mailbox))
        .route("/stacks/{id}/sql", post(sql))
        .route("/stacks/{id}/scheduled-sweep", post(scheduled_sweep))
        .with_state(stacks.clone());
    axum::serve(listener, app)
        .with_graceful_shutdown(stopped())
        .await
        .context("the stack server stopped")?;
    // Stacks of tests that died before finishing theirs: without this their
    // services, databases and queues would outlive the run.
    let left: Vec<_> = stacks.lock().await.drain().collect();
    for (id, running) in left {
        let Ok(running) = Arc::try_unwrap(running) else {
            continue;
        };
        if let Err(error) = running.into_inner().stack.finish().await {
            eprintln!("the stack {id} was left unfinished and did not end cleanly: {error}");
        }
    }
    Ok(())
}

async fn start(
    State(stacks): State<Stacks>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Failed> {
    let env = body["env"]
        .as_object()
        .map(|env| {
            env.iter()
                .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default();
    let stack = on_thread(move || async move {
        let options = StackOptions {
            env,
            document_storage: true,
        };
        Ok(Stack::start_with(options).await?)
    })
    .await?;

    let id = Uuid::now_v7().simple().to_string();
    let graphql_url = stack.graphql_url().unwrap_or_default();
    let answer = json!({
        "id": id,
        "emailUrl": stack.api_url(),
        "documentStorageUrl": graphql_url.trim_end_matches(crate::stack::GRAPHQL_PATH),
        "gmailUrl": stack.gmail().base_url(),
        "outlookUrl": stack.outlook().base_url(),
        "internalApiKey": stack.internal_api_key(),
        "logDir": stack.log_dir().display().to_string(),
    });
    let running = Running {
        stack,
        users: HashMap::new(),
        inboxes: HashMap::new(),
    };
    stacks
        .lock()
        .await
        .insert(id, Arc::new(Mutex::new(running)));
    Ok(Json(answer))
}

/// Runs harness work whose future is not `Send`, which a handler's must be,
/// on a thread of its own.
async fn on_thread<T, F>(work: impl FnOnce() -> F + Send + 'static) -> Result<T, Failed>
where
    T: Send + 'static,
    F: Future<Output = Result<T, Failed>>,
{
    let runtime = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || runtime.block_on(work()))
        .await
        .map_err(|error| Failed(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?
}

async fn find(stacks: &Stacks, id: &str) -> Result<Arc<Mutex<Running>>, Failed> {
    stacks
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| Failed(StatusCode::NOT_FOUND, format!("no stack {id}")))
}

fn text<'a>(body: &'a Value, field: &str) -> Result<&'a str, Failed> {
    body[field]
        .as_str()
        .ok_or_else(|| Failed(StatusCode::BAD_REQUEST, format!("`{field}` is missing")))
}

async fn create_user(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Failed> {
    let running = find(&stacks, &id).await?;
    let mut running = running.lock().await;
    let user = running.stack.user_at(text(&body, "email")?).await?;
    let answer = json!({
        "email": user.email(),
        "macroUserId": user.macro_id(),
        "fusionUserId": user.fusion_id(),
    });
    running.users.insert(user.email().to_owned(), user);
    Ok(Json(answer))
}

async fn link_inbox(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Failed> {
    let running = find(&stacks, &id).await?;
    let user = {
        let running = running.lock().await;
        let email = text(&body, "user")?;
        running
            .users
            .get(email)
            .cloned()
            .ok_or_else(|| Failed(StatusCode::NOT_FOUND, format!("no user {email}")))?
    };
    let provider = provider(&body)?;
    let address = body["address"].as_str().unwrap_or(user.email()).to_owned();
    let inbox = on_thread(move || async move { Ok(user.link(provider, &address).await?) }).await?;
    let answer = json!({
        "linkId": inbox.link_id(),
        "email": inbox.email(),
        "provider": provider.as_str(),
    });
    running
        .lock()
        .await
        .inboxes
        .insert(inbox.email().to_owned(), inbox);
    Ok(Json(answer))
}

async fn service_requests(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
) -> Result<Json<Value>, Failed> {
    let running = find(&stacks, &id).await?;
    let requests = running.lock().await.stack.service_requests();
    let requests: Vec<Value> = requests
        .into_iter()
        .map(|request| {
            json!({
                "service": request.service,
                "method": request.method,
                "path": request.path,
                "body": request.body,
            })
        })
        .collect();
    Ok(Json(Value::Array(requests)))
}

async fn scheduled_sweep(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
) -> Result<StatusCode, Failed> {
    let running = find(&stacks, &id).await?;
    running.lock().await.stack.run_scheduled_sweep().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn finish(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
) -> Result<StatusCode, Failed> {
    let running = stacks
        .lock()
        .await
        .remove(&id)
        .ok_or_else(|| Failed(StatusCode::NOT_FOUND, format!("no stack {id}")))?;
    let running = match Arc::try_unwrap(running) {
        Ok(running) => running.into_inner(),
        // Another request of the same test is still being answered: the
        // stack stays, and the client asks again.
        Err(shared) => {
            stacks.lock().await.insert(id.clone(), shared);
            return Err(Failed(
                StatusCode::CONFLICT,
                format!("the stack {id} is still answering a request"),
            ));
        }
    };
    running.stack.finish().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn inbox(stacks: &Stacks, id: &str, address: &str) -> Result<Inbox, Failed> {
    let running = find(stacks, id).await?;
    let running = running.lock().await;
    running
        .inboxes
        .get(address)
        .cloned()
        .ok_or_else(|| Failed(StatusCode::NOT_FOUND, format!("no inbox {address}")))
}

fn provider_message(message: ProviderMessage) -> Value {
    json!({
        "id": message.id,
        "threadId": message.thread_id,
        "subject": message.subject,
        "from": message.from,
        "read": message.read,
        "starred": message.starred,
        "inInbox": message.in_inbox,
        "labels": message.labels,
    })
}

fn optional(body: &Value, field: &str) -> Option<String> {
    body[field].as_str().map(str::to_owned)
}

async fn deliver(
    State(stacks): State<Stacks>,
    Path((id, address)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Failed> {
    let inbox = inbox(&stacks, &id, &address).await?;
    Ok(Json(provider_message(inbox.deliver(&mail_from(&body)?)?)))
}

/// The message a request describes.
fn mail_from(body: &Value) -> Result<Mail, Failed> {
    let mut mail = Mail::new(
        text(body, "from")?,
        text(body, "subject")?,
        body["text"].as_str().unwrap_or_default(),
    );
    mail.to = optional(body, "to");
    mail.cc = optional(body, "cc");
    mail.html = optional(body, "html");
    mail.message_id = optional(body, "messageId");
    mail.in_reply_to = optional(body, "inReplyTo");
    for attachment in body["attachments"].as_array().into_iter().flatten() {
        let bytes = STANDARD
            .decode(text(attachment, "base64")?)
            .map_err(|error| Failed(StatusCode::BAD_REQUEST, error.to_string()))?;
        mail.attachments.push(MailAttachment {
            filename: text(attachment, "filename")?.to_owned(),
            mime_type: text(attachment, "mimeType")?.to_owned(),
            bytes,
        });
    }
    Ok(mail)
}

async fn provider_messages(
    State(stacks): State<Stacks>,
    Path((id, address)): Path<(String, String)>,
) -> Result<Json<Value>, Failed> {
    let inbox = inbox(&stacks, &id, &address).await?;
    let messages = inbox.provider_messages()?;
    Ok(Json(Value::Array(
        messages.into_iter().map(provider_message).collect(),
    )))
}

fn provider(body: &Value) -> Result<Provider, Failed> {
    match text(body, "provider")? {
        "GMAIL" => Ok(Provider::Gmail),
        "OUTLOOK" => Ok(Provider::Outlook),
        other => Err(Failed(
            StatusCode::BAD_REQUEST,
            format!("unknown provider {other}"),
        )),
    }
}

async fn fail_service_request(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<StatusCode, Failed> {
    let running = find(&stacks, &id).await?;
    let status = body["status"]
        .as_u64()
        .and_then(|status| u16::try_from(status).ok())
        .unwrap_or(500);
    running.lock().await.stack.fail_next_service_request_with(
        text(&body, "service")?,
        text(&body, "method")?,
        body["pathPrefix"].as_str().unwrap_or("/"),
        status,
        &body["body"],
    )?;
    Ok(StatusCode::NO_CONTENT)
}

async fn refuse_queue_sends(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<StatusCode, Failed> {
    let running = find(&stacks, &id).await?;
    let times = body["times"]
        .as_u64()
        .and_then(|times| usize::try_from(times).ok())
        .unwrap_or(1);
    running
        .lock()
        .await
        .stack
        .refuse_queue_sends(text(&body, "queue")?, times)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn stored_objects(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
) -> Result<Json<Value>, Failed> {
    let running = find(&stacks, &id).await?;
    let objects = running.lock().await.stack.stored_objects();
    Ok(Json(Value::Array(
        objects
            .into_iter()
            .map(|object| {
                json!({
                    "bucket": object.bucket,
                    "key": object.key,
                    "contentType": object.content_type,
                    "base64": STANDARD.encode(&object.bytes),
                })
            })
            .collect(),
    )))
}

async fn seed_mailbox(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<StatusCode, Failed> {
    let running = find(&stacks, &id).await?;
    let mail = body["mail"]
        .as_array()
        .into_iter()
        .flatten()
        .map(mail_from)
        .collect::<Result<Vec<_>, _>>()?;
    running
        .lock()
        .await
        .stack
        .seed_mailbox(provider(&body)?, text(&body, "address")?, &mail)?;
    Ok(StatusCode::NO_CONTENT)
}

#[expect(
    clippy::disallowed_methods,
    reason = "test support: the query is the test's own, known only when it runs"
)]
async fn sql(
    State(stacks): State<Stacks>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, Failed> {
    let running = find(&stacks, &id).await?;
    let pool = running.lock().await.stack.db().clone();
    let query = format!(
        "WITH rows AS ({}) SELECT coalesce(jsonb_agg(to_jsonb(rows)), '[]')::text FROM rows",
        text(&body, "query")?
    );
    let rows: String = sqlx::query_scalar(&query)
        .fetch_one(&pool)
        .await
        .map_err(|error| Failed(StatusCode::BAD_REQUEST, error.to_string()))?;
    serde_json::from_str(&rows)
        .map(Json)
        .map_err(|error| Failed(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

/// Resolves when the process is asked to stop.
async fn stopped() {
    let interrupted = tokio::signal::ctrl_c();
    let Ok(mut terminated) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    else {
        // Without the handler the server runs until killed, as before.
        return std::future::pending().await;
    };
    tokio::select! {
        _ = interrupted => {}
        _ = terminated.recv() => {}
    }
}
