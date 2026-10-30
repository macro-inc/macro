//! An in-process SQS endpoint speaking the AWS JSON 1.0 protocol.
//!
//! The production `sqs_client::SQS` and `sqs_worker::SQSWorker` send real SDK
//! requests here. Sends, deletes and visibility changes are recorded for the
//! simulation, which owns delivery and the virtual clock.

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

#[derive(Clone, Debug)]
pub struct Sent {
    pub queue_url: String,
    pub body: String,
    pub delay_seconds: u64,
    pub message_id: String,
}

#[derive(Clone, Debug)]
pub enum Ack {
    Deleted { receipt: String },
    Visibility { receipt: String, seconds: u64 },
}

#[derive(Default)]
pub struct SqsState {
    pub sent: Vec<Sent>,
    pub acks: Vec<Ack>,
    /// While set, every SendMessage fails, as if the SDK had used up its
    /// retries against an SQS outage.
    pub outage: bool,
    pub failed_sends: Vec<Sent>,
    next_id: u64,
    /// Holds the next SendMessage until released.
    paused_send: Option<(oneshot::Sender<()>, oneshot::Receiver<()>)>,
}

#[derive(Clone)]
pub struct FakeSqs {
    pub state: Arc<Mutex<SqsState>>,
    pub url: String,
}

impl FakeSqs {
    pub async fn start() -> FakeSqs {
        let state = Arc::new(Mutex::new(SqsState::default()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake sqs");
        let url = format!("http://{}", listener.local_addr().unwrap());
        let fake = FakeSqs { state, url };
        let app = Router::new().fallback(handle).with_state(fake.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        fake
    }

    pub fn queue_url(&self, name: &str) -> String {
        format!("{}/000000000000/{name}", self.url)
    }

    pub fn lock(&self) -> std::sync::MutexGuard<'_, SqsState> {
        self.state.lock().unwrap()
    }

    pub fn take(&self) -> (Vec<Sent>, Vec<Ack>) {
        let mut state = self.lock();
        (
            std::mem::take(&mut state.sent),
            std::mem::take(&mut state.acks),
        )
    }

    pub fn set_outage(&self, outage: bool) {
        self.lock().outage = outage;
    }

    /// Holds the next SendMessage. Returns (arrived, release).
    pub fn pause_next_send(&self) -> (oneshot::Receiver<()>, oneshot::Sender<()>) {
        let (arrived_tx, arrived_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel();
        self.lock().paused_send = Some((arrived_tx, release_rx));
        (arrived_rx, release_tx)
    }
}

/// An SDK client for `endpoint` without SDK retries: an injected outage fails
/// the call at once instead of after the default backoff.
pub fn client(endpoint: &str, retries: bool) -> aws_sdk_sqs::Client {
    let mut config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .region(aws_sdk_sqs::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_sqs::config::Credentials::new(
            "test", "test", None, None, "harness",
        ))
        .endpoint_url(endpoint);
    if !retries {
        config = config.retry_config(aws_sdk_sqs::config::retry::RetryConfig::disabled());
    }
    aws_sdk_sqs::Client::from_conf(config.build())
}

async fn handle(State(sqs): State<FakeSqs>, headers: HeaderMap, body: Bytes) -> Response {
    let target = headers
        .get("x-amz-target")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .trim_start_matches("AmazonSQS.")
        .to_string();
    let request: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let text = |field: &str| {
        request
            .get(field)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    if target == "SendMessage" || target == "SendMessageBatch" {
        let paused = sqs.lock().paused_send.take();
        if let Some((arrived, release)) = paused {
            let _ = arrived.send(());
            let _ = release.await;
        }
    }
    let mut state = sqs.lock();
    match target.as_str() {
        "SendMessage" => {
            state.next_id += 1;
            let sent = Sent {
                queue_url: text("QueueUrl"),
                body: text("MessageBody"),
                delay_seconds: request
                    .get("DelaySeconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                message_id: format!("msg-{}", state.next_id),
            };
            if state.outage {
                state.failed_sends.push(sent);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [("content-type", "application/x-amz-json-1.0")],
                    json!({ "__type": "com.amazonaws.sqs#InternalError", "message": "injected outage" })
                        .to_string(),
                )
                    .into_response();
            }
            let message_id = sent.message_id.clone();
            state.sent.push(sent);
            json_response(json!({ "MessageId": message_id }))
        }
        "SendMessageBatch" => {
            if state.outage {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [("content-type", "application/x-amz-json-1.0")],
                    json!({ "__type": "com.amazonaws.sqs#InternalError", "message": "injected outage" })
                        .to_string(),
                )
                    .into_response();
            }
            let queue_url = text("QueueUrl");
            let mut successful = Vec::new();
            for entry in request
                .get("Entries")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                state.next_id += 1;
                let message_id = format!("msg-{}", state.next_id);
                state.sent.push(Sent {
                    queue_url: queue_url.clone(),
                    body: entry["MessageBody"].as_str().unwrap_or("").to_string(),
                    delay_seconds: entry["DelaySeconds"].as_u64().unwrap_or(0),
                    message_id: message_id.clone(),
                });
                successful.push(json!({
                    "Id": entry["Id"],
                    "MessageId": message_id,
                    "MD5OfMessageBody": "",
                }));
            }
            json_response(json!({ "Successful": successful, "Failed": [] }))
        }
        "DeleteMessage" => {
            state.acks.push(Ack::Deleted {
                receipt: text("ReceiptHandle"),
            });
            json_response(json!({}))
        }
        "ChangeMessageVisibility" => {
            state.acks.push(Ack::Visibility {
                receipt: text("ReceiptHandle"),
                seconds: request
                    .get("VisibilityTimeout")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
            });
            json_response(json!({}))
        }
        "ReceiveMessage" => json_response(json!({ "Messages": [] })),
        other => panic!("fake SQS does not implement {other}"),
    }
}

fn json_response(body: Value) -> Response {
    (
        StatusCode::OK,
        [("content-type", "application/x-amz-json-1.0")],
        body.to_string(),
    )
        .into_response()
}
