//! One receive and one production per-message call. Queue scheduling stays virtual.

use super::{Lab, Snapshot, capture, redis};
use crate::pubsub::label_write_sim::fake_sqs::{Ack, Sent};
use serde_json::{Value, json};
use tracing::Instrument;
use tracing::instrument::WithSubscriber;

mod contexts;
mod redis_time;
mod test;
pub(super) use contexts::WorkerContexts;

// Unoptimized worker futures have large temporary frames even when the entry
// point itself is boxed. Poll on a bounded, explicit stack while retaining the
// lab runtime: its I/O drivers and unscoped-child trace capture must stay shared.
async fn on_delivery_stack<F, Fut, T>(build: F) -> T
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = T>,
    T: Send + 'static,
{
    let runtime = tokio::runtime::Handle::current();
    let (send, receive) = tokio::sync::oneshot::channel();
    let thread = std::thread::Builder::new()
        .name("parity-delivery".into())
        .stack_size(16 * 1024 * 1024)
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                runtime.block_on(async move { Box::pin(build()).await })
            }));
            let _ = send.send(result);
        })
        .expect("production worker delivery thread");
    let result = receive.await.expect("production worker delivery result");
    thread.join().expect("production worker delivery thread");
    match result {
        Ok(result) => result,
        Err(panic) => std::panic::resume_unwind(panic),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::parity) enum Queue {
    GmailOps,
    GmailOpsRetry,
    InboxSync,
    InboxSyncRetry,
    Backfill,
    LinkManager,
    CrmCleanup,
    SfsUploader,
    #[cfg(feature = "sfs_delete")]
    SfsDeleter,
    Scheduled,
}

impl Queue {
    pub fn name(self) -> &'static str {
        match self {
            Self::GmailOps => "gmail-ops",
            Self::GmailOpsRetry => "gmail-ops-retry",
            Self::InboxSync => "gmail-webhook",
            Self::InboxSyncRetry => "gmail-webhook-retry",
            Self::Backfill => "backfill",
            Self::LinkManager => "link-manager",
            Self::CrmCleanup => "crm-cleanup",
            Self::SfsUploader => "sfs-uploader",
            #[cfg(feature = "sfs_delete")]
            Self::SfsDeleter => "sfs-delete",
            Self::Scheduled => "scheduled",
        }
    }
}

#[derive(Clone)]
pub(in crate::parity) struct Delivery {
    pub body: Option<String>,
    pub receive_count: u32,
    pub message_id: String,
    pub receipt_handle: Option<String>,
    pub attributes: std::collections::BTreeMap<String, String>,
    pub message_attributes: Value,
}

impl Delivery {
    pub fn new(body: impl Into<String>) -> Self {
        Self {
            body: Some(body.into()),
            receive_count: 1,
            message_id: "delivery".into(),
            receipt_handle: Some("delivery-receipt-1".into()),
            attributes: Default::default(),
            message_attributes: json!({}),
        }
    }

    pub fn redelivered(&self) -> Self {
        Self {
            receive_count: self.receive_count + 1,
            receipt_handle: Some(format!(
                "{}-receipt-{}",
                self.message_id,
                self.receive_count + 1
            )),
            ..self.clone()
        }
    }

    pub fn from_sent(sent: &Sent) -> Self {
        Self {
            message_id: sent.message_id.clone(),
            ..Self::new(sent.body.clone())
        }
    }

    fn wire(&self) -> Value {
        let mut attributes = self.attributes.clone();
        attributes.insert(
            "ApproximateReceiveCount".into(),
            self.receive_count.to_string(),
        );
        json!({
            "MessageId": self.message_id, "ReceiptHandle": self.receipt_handle,
            "Body": self.body, "Attributes": attributes, "MessageAttributes": self.message_attributes,
        })
    }
}

pub(in crate::parity) struct StepOutcome {
    pub sent: Vec<Sent>,
    pub deleted: bool,
    pub result: anyhow::Result<()>,
}

impl Lab {
    pub fn reject_next_kafka_publish(&self) {
        self.kafka.reject_next_publish();
    }

    pub fn inbox_notifications(&mut self, enabled: bool) {
        self.workers
            .as_mut()
            .expect("worker contexts")
            .inbox_notifications(enabled);
    }

    pub async fn start_workers(&mut self) {
        assert!(self.workers.is_none(), "workers composed once per lab");
        self.workers = Some(WorkerContexts::new(self).await);
    }

    pub fn redis_connection(&self) -> ::redis::aio::MultiplexedConnection {
        self.redis.clone()
    }

    pub async fn reset_admission(&mut self) {
        for link in self.fixture.links {
            crate::pubsub::label_write_sim::wiring::reset_admission(&mut self.redis, link).await;
        }
    }

    pub async fn worker_step(
        &mut self,
        name: &str,
        queue: Queue,
        delivery: &Delivery,
    ) -> StepOutcome {
        if let Some(body) = &delivery.body
            && let Ok(value) = serde_json::from_str::<Value>(body)
        {
            delivery_scopes(&value, &mut self.redis_scopes);
        }
        let before = Snapshot::take(&self.db).await;
        let redis_before = redis::snapshot(&mut self.redis, &self.redis_scopes).await;
        let (sent_from, acks_from) = {
            let sqs = self.sqs.lock();
            (sqs.sent.len(), sqs.acks.len())
        };
        let wire = delivery.wire();
        self.sqs
            .deliver(&self.sqs.queue_url(queue.name()), wire.clone());
        let (recording, span) = capture::start();
        let (result, kafka) = capture::scope(
            recording.clone(),
            async {
                let workers = self
                    .workers
                    .as_ref()
                    .expect("start worker contexts before delivery");
                let mut messages = workers
                    .receiver(queue)
                    .receive_messages()
                    .await
                    .expect("single fake receive");
                assert_eq!(messages.len(), 1, "exactly one message per step");
                // Keep the recorder's frame off the production delivery and
                // give unoptimized futures an explicit stack budget.
                let workers = workers.clone();
                let message = messages.remove(0);
                let processing_recording = recording.clone();
                let parent = tracing::Span::current();
                let dispatch = capture::dispatch();
                let result = on_delivery_stack(move || {
                    capture::scope(
                        processing_recording,
                        async move { workers.process(queue, &message).await }
                            .instrument(parent)
                            .with_subscriber(dispatch),
                    )
                })
                .await;
                let kafka = self.kafka.take().await;
                self.sql_fault.drain().await;
                (result, kafka)
            }
            .instrument(span)
            .with_subscriber(capture::dispatch()),
        )
        .await;
        capture::stop();
        let redis_after = redis::snapshot(&mut self.redis, &self.redis_scopes).await;
        let after = Snapshot::take(&self.db).await;
        let (spans, logs, sql, callsites, debug_spans) =
            recording.lock().expect("recording").sections();
        let (sent, acks, mut calls) = {
            let mut sqs = self.sqs.lock();
            (
                sqs.sent[sent_from..].to_vec(),
                sqs.acks[acks_from..].to_vec(),
                std::mem::take(&mut sqs.calls),
            )
        };
        normalize_calls(&mut calls);
        let (outcome, deleted) = outcome(delivery, &sent, &acks, &result);
        self.transcript.step(
            name,
            vec![
                (
                    "delivery",
                    json!({"queue":self.sqs.queue_url(queue.name()), "message":wire}),
                ),
                ("outcome", outcome),
                ("spans", spans),
                ("logs", logs),
                ("sql", sql),
                ("provider_http", json!(self.stub.take())),
                ("sqs", json!(calls)),
                ("kafka", json!(kafka)),
                (
                    "redis",
                    redis_time::changes(
                        redis_before,
                        redis_after,
                        &[redis_time::RedisRule::GmailGateWindowTotalUnits],
                    ),
                ),
                ("db", before.changes(after)),
                ("callsites", callsites),
                ("debug_spans", debug_spans),
            ],
        );
        StepOutcome {
            sent,
            deleted,
            result,
        }
    }
}

fn delivery_scopes(value: &Value, scopes: &mut Vec<String>) {
    match value {
        Value::String(value) if value.parse::<uuid::Uuid>().is_ok() => {
            if !scopes.contains(value) {
                scopes.push(value.clone());
            }
        }
        Value::Array(values) => {
            for value in values {
                delivery_scopes(value, scopes);
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                delivery_scopes(value, scopes);
            }
        }
        _ => {}
    }
}

fn outcome(
    delivery: &Delivery,
    sent: &[Sent],
    acks: &[Ack],
    result: &anyhow::Result<()>,
) -> (Value, bool) {
    let mut deleted = false;
    let mut visibility = Vec::new();
    for ack in acks {
        match ack {
            Ack::Deleted { receipt } => {
                assert_eq!(Some(receipt), delivery.receipt_handle.as_ref());
                deleted = true;
            }
            Ack::Visibility { receipt, seconds } => {
                assert_eq!(Some(receipt), delivery.receipt_handle.as_ref());
                visibility.push(*seconds);
            }
        }
    }
    let sent: Vec<_> = sent
        .iter()
        .map(|sent| {
            json!({
                "queue":sent.queue_url, "body":sent.body, "delay_seconds":sent.delay_seconds,
            })
        })
        .collect();
    (
        json!({
            "result": match result { Ok(()) => json!({"Ok":null}), Err(error) => json!({"Err":format!("{error:#}")}) },
            "deleted":deleted, "left_for_redelivery":!deleted,
            "visibility_seconds":visibility, "sent":sent,
        }),
        deleted,
    )
}

fn normalize_calls(calls: &mut [Value]) {
    for call in calls {
        if call["operation"] == "SendMessage" {
            call["request"]["DelaySeconds"] =
                json!(call["request"]["DelaySeconds"].as_u64().unwrap_or(0));
        }
        if let Some(body) = call["request"]["MessageBody"].as_str() {
            call["request"]["MessageBody"] =
                serde_json::from_str(body).unwrap_or_else(|_| json!(body));
        }
    }
}
