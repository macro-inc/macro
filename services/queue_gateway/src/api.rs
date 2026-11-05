//! The SQS JSON protocol (`X-Amz-Target: AmazonSQS.<Action>`), the subset the
//! services and the Lambda runner use. Signatures are not verified: the gateway is
//! reachable only inside its instance's namespace.

use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use md5::{Digest, Md5};
use rootcause::Report;
use serde_json::{Map, Value, json};

use crate::{
    kafka::{Queue, Queues, now_ms},
    state::{DEFAULT_VISIBILITY_SECONDS, Envelope, Redrive, Settings},
};

const AMZ_JSON: &str = "application/x-amz-json-1.0";
const ACCOUNT_ID: &str = "000000000000";
const REGION: &str = "us-east-1";
const TARGET_PREFIX: &str = "AmazonSQS.";
const NO_QUEUE: &str = "com.amazonaws.sqs#QueueDoesNotExist";
const INVALID: &str = "com.amazonaws.sqs#InvalidAddress";
/// How often a long poll looks again, for messages that become due or visible.
const LONG_POLL_RECHECK: Duration = Duration::from_millis(500);

pub fn router(queues: Arc<Queues>) -> Router {
    Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .fallback(handle)
        .with_state(queues)
}

enum ApiError {
    Client(&'static str, String),
    Internal(Report),
}

impl From<Report> for ApiError {
    fn from(report: Report) -> Self {
        Self::Internal(report)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, kind, message) = match self {
            Self::Client(kind, message) => (StatusCode::BAD_REQUEST, kind, message),
            Self::Internal(error) => {
                tracing::error!(?error, "queue request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "InternalFailure",
                    "internal error".to_owned(),
                )
            }
        };
        amz_json(status, &json!({ "__type": kind, "message": message }))
    }
}

fn amz_json(status: StatusCode, body: &Value) -> Response {
    (status, [(header::CONTENT_TYPE, AMZ_JSON)], body.to_string()).into_response()
}

async fn handle(
    State(queues): State<Arc<Queues>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Response, ApiError> {
    let action = headers
        .get("x-amz-target")
        .and_then(|target| target.to_str().ok())
        .and_then(|target| target.strip_prefix(TARGET_PREFIX))
        .ok_or_else(|| ApiError::Client(INVALID, "missing X-Amz-Target".to_owned()))?
        .to_owned();
    let request: Value = if body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&body)
            .map_err(|error| ApiError::Client(INVALID, error.to_string()))?
    };
    let host = headers
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
        .unwrap_or("localhost")
        .to_owned();
    let response = dispatch(&queues, &action, &request, &host).await?;
    Ok(amz_json(StatusCode::OK, &response))
}

async fn dispatch(
    queues: &Queues,
    action: &str,
    request: &Value,
    host: &str,
) -> Result<Value, ApiError> {
    match action {
        "CreateQueue" => Ok(create_queue(queues, request, host).await?),
        "GetQueueUrl" => {
            let name = text(request, "QueueName")?;
            existing(queues, name).await?;
            Ok(json!({ "QueueUrl": queue_url(host, name) }))
        }
        "ListQueues" => {
            let urls: Vec<String> = queues
                .names()
                .await
                .iter()
                .map(|name| queue_url(host, name))
                .collect();
            Ok(json!({ "QueueUrls": urls }))
        }
        "DeleteQueue" => {
            queues.delete(&named(request)?).await?;
            Ok(json!({}))
        }
        "PurgeQueue" => {
            let queue = addressed(queues, request).await?;
            let commits = queue.state.lock().await.purge();
            for commit in commits {
                queue.commit(Some(commit));
            }
            Ok(json!({}))
        }
        "GetQueueAttributes" => get_attributes(queues, request).await,
        "SetQueueAttributes" => set_attributes(queues, request).await,
        "SendMessage" => {
            let name = named(request)?;
            let queue = existing(queues, &name).await?;
            send(queues, &queue, &name, request).await
        }
        "SendMessageBatch" => send_batch(queues, request).await,
        "ReceiveMessage" => receive(queues, request).await,
        "DeleteMessage" => {
            let queue = addressed(queues, request).await?;
            let commit = queue
                .state
                .lock()
                .await
                .delete(text(request, "ReceiptHandle")?);
            queue.commit(commit);
            Ok(json!({}))
        }
        "DeleteMessageBatch" => delete_batch(queues, request).await,
        "ChangeMessageVisibility" => {
            let queue = addressed(queues, request).await?;
            queue.state.lock().await.change_visibility(
                text(request, "ReceiptHandle")?,
                number(request, "VisibilityTimeout")?,
                now_ms(),
            );
            queue.arrived.notify_waiters();
            Ok(json!({}))
        }
        "ChangeMessageVisibilityBatch" => change_visibility_batch(queues, request).await,
        "TagQueue" | "UntagQueue" => Ok(json!({})),
        other => Err(ApiError::Client(
            "com.amazonaws.sqs#UnsupportedOperation",
            format!("{other} is not supported"),
        )),
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, ApiError> {
    value[key]
        .as_str()
        .ok_or_else(|| ApiError::Client(INVALID, format!("missing {key}")))
}

/// SQS sends numbers as strings in attributes and as numbers in requests.
fn as_number(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

fn number(value: &Value, key: &str) -> Result<u64, ApiError> {
    as_number(&value[key]).ok_or_else(|| ApiError::Client(INVALID, format!("missing {key}")))
}

fn queue_url(host: &str, name: &str) -> String {
    format!("http://{host}/{ACCOUNT_ID}/{name}")
}

fn queue_arn(name: &str) -> String {
    format!("arn:aws:sqs:{REGION}:{ACCOUNT_ID}:{name}")
}

/// A queue's name from its URL.
fn named(request: &Value) -> Result<String, ApiError> {
    let url = text(request, "QueueUrl")?;
    url.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| ApiError::Client(INVALID, format!("bad queue URL {url}")))
}

async fn existing(queues: &Queues, name: &str) -> Result<Arc<Queue>, ApiError> {
    queues
        .get(name)
        .await
        .ok_or_else(|| ApiError::Client(NO_QUEUE, format!("no queue named {name}")))
}

async fn addressed(queues: &Queues, request: &Value) -> Result<Arc<Queue>, ApiError> {
    existing(queues, &named(request)?).await
}

/// Applies SQS queue attributes onto `settings`.
fn apply_attributes(settings: &mut Settings, attributes: &Value) {
    let Some(attributes) = attributes.as_object() else {
        return;
    };
    for (key, value) in attributes {
        match key.as_str() {
            "VisibilityTimeout" => {
                settings.visibility_seconds =
                    as_number(value).unwrap_or(DEFAULT_VISIBILITY_SECONDS);
            }
            "DelaySeconds" => settings.delay_seconds = as_number(value).unwrap_or(0),
            "ContentBasedDeduplication" => {
                settings.content_based_dedup = value.as_str() == Some("true");
            }
            "RedrivePolicy" => settings.redrive = parse_redrive(value),
            _ => {}
        }
        if let Some(text) = value.as_str() {
            settings.raw.insert(key.clone(), text.to_owned());
        }
    }
}

fn parse_redrive(value: &Value) -> Option<Redrive> {
    let policy: Value = serde_json::from_str(value.as_str()?).ok()?;
    Some(Redrive {
        dead_letter_queue: policy["deadLetterTargetArn"]
            .as_str()?
            .rsplit(':')
            .next()?
            .to_owned(),
        max_receive_count: u32::try_from(as_number(&policy["maxReceiveCount"])?).ok()?,
    })
}

#[tracing::instrument(name = "queue.create", skip_all, err(Debug), fields(queue))]
async fn create_queue(queues: &Queues, request: &Value, host: &str) -> Result<Value, Report> {
    let name = request["QueueName"].as_str().unwrap_or_default();
    tracing::Span::current().record("queue", name);
    if name.is_empty() {
        rootcause::bail!("CreateQueue without QueueName");
    }
    let mut settings = Settings::default();
    apply_attributes(&mut settings, &request["Attributes"]);
    queues.create(name, settings).await?;
    Ok(json!({ "QueueUrl": queue_url(host, name) }))
}

async fn get_attributes(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let name = named(request)?;
    let queue = existing(queues, &name).await?;
    let state = queue.state.lock().await;
    let depth = state.depth(now_ms());
    let mut attributes: BTreeMap<String, String> = state.settings.raw.clone();
    attributes.insert("QueueArn".to_owned(), queue_arn(&name));
    attributes.insert(
        "VisibilityTimeout".to_owned(),
        state.settings.visibility_seconds.to_string(),
    );
    attributes.insert(
        "ApproximateNumberOfMessages".to_owned(),
        depth.visible.to_string(),
    );
    attributes.insert(
        "ApproximateNumberOfMessagesNotVisible".to_owned(),
        depth.in_flight.to_string(),
    );
    attributes.insert(
        "ApproximateNumberOfMessagesDelayed".to_owned(),
        depth.delayed.to_string(),
    );
    Ok(json!({ "Attributes": attributes }))
}

async fn set_attributes(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let queue = addressed(queues, request).await?;
    let mut settings = queue.state.lock().await.settings.clone();
    apply_attributes(&mut settings, &request["Attributes"]);
    queues.update_settings(&queue, settings).await?;
    Ok(json!({}))
}

fn md5_hex(text: &str) -> String {
    Md5::digest(text.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tracing::instrument(name = "queue.send", skip_all, err(Debug), fields(queue = name, message_id))]
async fn send_one(
    queues: &Queues,
    queue: &Queue,
    name: &str,
    entry: &Value,
) -> Result<Value, Report> {
    let body = entry["MessageBody"].as_str().unwrap_or_default().to_owned();
    let settings = queue.state.lock().await.settings.clone();
    let now = now_ms();
    let delay = as_number(&entry["DelaySeconds"]).unwrap_or(settings.delay_seconds);
    let dedup = entry["MessageDeduplicationId"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| settings.content_based_dedup.then(|| md5_hex(&body)));
    let digest = md5_hex(&body);
    let message_id = uuid::Uuid::new_v4().to_string();
    tracing::Span::current().record("message_id", &message_id);
    let duplicate = match &dedup {
        Some(id) => !queue.state.lock().await.first_send(id, now),
        None => false,
    };
    if !duplicate {
        let envelope = Envelope {
            message_id: message_id.clone(),
            body,
            attributes: entry
                .get("MessageAttributes")
                .filter(|attributes| !attributes.is_null())
                .cloned(),
            group: entry["MessageGroupId"].as_str().map(str::to_owned),
            dedup,
            sent_ms: now,
            not_before_ms: now + delay * 1000,
        };
        queues.send(name, &envelope).await?;
    }
    Ok(json!({ "MessageId": message_id, "MD5OfMessageBody": digest }))
}

async fn send(
    queues: &Queues,
    queue: &Queue,
    name: &str,
    request: &Value,
) -> Result<Value, ApiError> {
    Ok(send_one(queues, queue, name, request).await?)
}

/// Runs a batch's entries, reporting each in the shape SQS batch calls use.
fn batch_entries(request: &Value) -> Vec<Value> {
    request["Entries"].as_array().cloned().unwrap_or_default()
}

fn batch_result(succeeded: Vec<Value>, failed: Vec<Value>) -> Value {
    json!({ "Successful": succeeded, "Failed": failed })
}

fn batch_failure(id: &str, message: String) -> Value {
    json!({ "Id": id, "SenderFault": false, "Code": "InternalError", "Message": message })
}

async fn send_batch(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let name = named(request)?;
    let queue = existing(queues, &name).await?;
    let mut succeeded = Vec::new();
    let mut failed = Vec::new();
    for entry in batch_entries(request) {
        let id = entry["Id"].as_str().unwrap_or_default().to_owned();
        match send_one(queues, &queue, &name, &entry).await {
            Ok(mut sent) => {
                sent["Id"] = json!(id);
                succeeded.push(sent);
            }
            Err(error) => failed.push(batch_failure(&id, error.to_string())),
        }
    }
    Ok(batch_result(succeeded, failed))
}

async fn delete_batch(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let queue = addressed(queues, request).await?;
    let mut succeeded = Vec::new();
    for entry in batch_entries(request) {
        let commit = queue
            .state
            .lock()
            .await
            .delete(entry["ReceiptHandle"].as_str().unwrap_or_default());
        queue.commit(commit);
        succeeded.push(json!({ "Id": entry["Id"] }));
    }
    Ok(batch_result(succeeded, Vec::new()))
}

async fn change_visibility_batch(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let queue = addressed(queues, request).await?;
    let mut succeeded = Vec::new();
    for entry in batch_entries(request) {
        queue.state.lock().await.change_visibility(
            entry["ReceiptHandle"].as_str().unwrap_or_default(),
            as_number(&entry["VisibilityTimeout"]).unwrap_or(0),
            now_ms(),
        );
        succeeded.push(json!({ "Id": entry["Id"] }));
    }
    queue.arrived.notify_waiters();
    Ok(batch_result(succeeded, Vec::new()))
}

#[tracing::instrument(name = "queue.receive", skip_all, fields(queue, received))]
async fn receive(queues: &Queues, request: &Value) -> Result<Value, ApiError> {
    let name = named(request)?;
    tracing::Span::current().record("queue", name.as_str());
    let queue = existing(queues, &name).await?;
    let max = usize::try_from(as_number(&request["MaxNumberOfMessages"]).unwrap_or(1)).unwrap_or(1);
    let wait = Duration::from_secs(as_number(&request["WaitTimeSeconds"]).unwrap_or(0));
    let visibility = match as_number(&request["VisibilityTimeout"]) {
        Some(seconds) => seconds,
        None => queue.state.lock().await.settings.visibility_seconds,
    };
    let deadline = Instant::now() + wait;
    loop {
        let notified = queue.arrived.notified();
        let deliveries = queue.state.lock().await.receive(max, visibility, now_ms());
        if !deliveries.is_empty() || Instant::now() >= deadline {
            tracing::Span::current().record("received", deliveries.len());
            let messages: Vec<Value> = deliveries.iter().map(delivery_json).collect();
            return Ok(if messages.is_empty() {
                json!({})
            } else {
                json!({ "Messages": messages })
            });
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let _ = tokio::time::timeout(remaining.min(LONG_POLL_RECHECK), notified).await;
    }
}

fn delivery_json(delivery: &crate::state::Delivery) -> Value {
    let envelope = &delivery.envelope;
    let mut attributes = Map::new();
    attributes.insert(
        "ApproximateReceiveCount".to_owned(),
        json!(delivery.receive_count.to_string()),
    );
    attributes.insert(
        "SentTimestamp".to_owned(),
        json!(envelope.sent_ms.to_string()),
    );
    attributes.insert(
        "ApproximateFirstReceiveTimestamp".to_owned(),
        json!(delivery.first_received_ms.to_string()),
    );
    if let Some(group) = &envelope.group {
        attributes.insert("MessageGroupId".to_owned(), json!(group));
    }
    if let Some(dedup) = &envelope.dedup {
        attributes.insert("MessageDeduplicationId".to_owned(), json!(dedup));
    }
    let mut message = json!({
        "MessageId": envelope.message_id,
        "ReceiptHandle": delivery.receipt_handle,
        "MD5OfBody": md5_hex(&envelope.body),
        "Body": envelope.body,
        "Attributes": attributes,
    });
    if let Some(message_attributes) = &envelope.attributes {
        message["MessageAttributes"] = message_attributes.clone();
    }
    message
}

#[cfg(test)]
mod test;
