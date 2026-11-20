//! Lifecycle spans (`teammate.*`) to the service's authenticated ingest,
//! `POST <agent-harness>/teammates/telemetry`, as OTLP/HTTP protobuf with
//! the harness credential (docs/design/teammate-runtime.md, *Lifecycle
//! telemetry*).
//!
//! - The exporter runs on the SDK's own thread: it only encodes a batch and
//!   hands it to [`Ingest`], a task on macrod's runtime, without waiting.
//! - [`Ingest`] sends one batch at a time, at most one request per
//!   [`MIN_INTERVAL`] (the service allows 12 a minute), and keeps at most
//!   [`MAX_PENDING`] batches while the service is unreachable, dropping the
//!   oldest. Nothing waits on it: macrod starts and serves without it.
//! - The spans carry metadata only (opaque install ids, generations, image
//!   ids, attempts, outcomes); the service keeps an allowlist besides.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use opentelemetry_proto::transform::common::tonic::ResourceAttributesWithSchema;
use opentelemetry_proto::transform::trace::tonic::group_spans_by_resource_and_scope;
use opentelemetry_sdk::error::{OTelSdkError, OTelSdkResult};
use opentelemetry_sdk::trace::{SpanData, SpanExporter};
use prost::Message as _;
use tokio::sync::mpsc;
use tokio_util::task::AbortOnDropHandle;

/// Batches kept while the service can't be reached; the oldest go first.
pub const MAX_PENDING: usize = 16;

/// The least time between two requests.
pub const MIN_INTERVAL: Duration = Duration::from_secs(10);

/// The most spans in one request (the service takes up to 512 and 256 KiB).
pub const MAX_BATCH_SPANS: usize = 256;

/// How long one request may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// The spans this exporter sends.
const SPAN_PREFIX: &str = "teammate.";

/// The header the harness credential travels in.
const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// Where the exporter's batches go, once macrod knows its harness.
#[derive(Clone, Default)]
pub struct Outbox(Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>);

impl Outbox {
    fn sender(&self) -> Option<mpsc::Sender<Vec<u8>>> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

/// The SDK's exporter: encodes each batch and hands it to the outbox.
/// Before macrod knows its harness, or with the outbox full, the batch is
/// dropped: telemetry never holds macrod up.
pub struct IngestExporter {
    outbox: Outbox,
    resource: ResourceAttributesWithSchema,
}

impl std::fmt::Debug for IngestExporter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IngestExporter")
            .finish_non_exhaustive()
    }
}

impl IngestExporter {
    /// An exporter into `outbox`.
    pub fn new(outbox: Outbox) -> Self {
        Self {
            outbox,
            resource: ResourceAttributesWithSchema::default(),
        }
    }
}

/// One batch as the ingest takes it.
pub fn encode(spans: Vec<SpanData>, resource: &ResourceAttributesWithSchema) -> Vec<u8> {
    ExportTraceServiceRequest {
        resource_spans: group_spans_by_resource_and_scope(spans, resource),
    }
    .encode_to_vec()
}

impl SpanExporter for IngestExporter {
    async fn export(&self, mut batch: Vec<SpanData>) -> OTelSdkResult {
        // The provider's other spans (enrollment) are for the opted-in
        // collector only.
        batch.retain(|span| span.name.starts_with(SPAN_PREFIX));
        let Some(sender) = self.outbox.sender().filter(|_| !batch.is_empty()) else {
            return Ok(());
        };
        sender.try_send(encode(batch, &self.resource)).map_err(|_| {
            OTelSdkError::InternalFailure("the teammate span outbox is full".to_owned())
        })
    }

    fn set_resource(&mut self, resource: &opentelemetry_sdk::Resource) {
        self.resource = resource.into();
    }
}

/// Sends what the exporter encoded; dropping it stops sending.
pub struct Ingest {
    _task: AbortOnDropHandle<()>,
}

/// The ingest's address and credential.
#[derive(Clone)]
pub struct IngestTarget {
    /// `<agent-harness>/teammates/telemetry`.
    pub url: String,
    /// The harness credential.
    pub token: String,
}

impl std::fmt::Debug for IngestTarget {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("IngestTarget")
            .field("url", &self.url)
            .finish_non_exhaustive()
    }
}

/// A transport for the encoded batches: the real one posts over HTTP.
pub trait Post: Send + Sync + 'static {
    /// Send one body; whether the service took it.
    fn post(&self, body: Vec<u8>) -> impl std::future::Future<Output = Delivered> + Send;
}

/// What became of one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivered {
    /// Taken (or refused for good: a 4xx other than 429, so it isn't sent
    /// again).
    Done,
    /// Unreachable, 429 or 5xx: kept to send again.
    Retry,
}

/// `POST` over HTTPS with the harness credential.
pub struct HttpPost {
    client: reqwest::Client,
    target: IngestTarget,
}

impl HttpPost {
    /// A poster to `target`.
    pub fn new(target: IngestTarget) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            target,
        })
    }
}

impl Post for HttpPost {
    async fn post(&self, body: Vec<u8>) -> Delivered {
        let response = self
            .client
            .post(&self.target.url)
            .header(HARNESS_TOKEN_HEADER, &self.target.token)
            .header(reqwest::header::CONTENT_TYPE, "application/x-protobuf")
            .body(body)
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => Delivered::Done,
            Ok(response)
                if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
                    || response.status().is_server_error() =>
            {
                Delivered::Retry
            }
            Ok(response) => {
                tracing::debug!(
                    status = response.status().as_u16(),
                    "the teammate span ingest refused a batch"
                );
                Delivered::Done
            }
            Err(_) => Delivered::Retry,
        }
    }
}

impl Ingest {
    /// Start sending `outbox`'s batches with `post`.
    pub fn start(outbox: &Outbox, post: impl Post) -> Self {
        let (sender, receiver) = mpsc::channel(MAX_PENDING);
        *outbox
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(sender);
        Self {
            _task: AbortOnDropHandle::new(tokio::spawn(send(receiver, post))),
        }
    }
}

/// Send batches in order, one per [`MIN_INTERVAL`], keeping at most
/// [`MAX_PENDING`] that the service didn't take.
async fn send(mut receiver: mpsc::Receiver<Vec<u8>>, post: impl Post) {
    let mut pending: VecDeque<Vec<u8>> = VecDeque::new();
    loop {
        if pending.is_empty() {
            let Some(batch) = receiver.recv().await else {
                return;
            };
            pending.push_back(batch);
        }
        while let Ok(batch) = receiver.try_recv() {
            if pending.len() == MAX_PENDING {
                pending.pop_front();
            }
            pending.push_back(batch);
        }
        if let Some(batch) = pending.pop_front() {
            match post.post(batch.clone()).await {
                Delivered::Done => {}
                Delivered::Retry => pending.push_front(batch),
            }
        }
        tokio::time::sleep(MIN_INTERVAL).await;
    }
}

#[cfg(test)]
mod test;
