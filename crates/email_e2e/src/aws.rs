//! The AWS endpoint the email services are pointed at.
//!
//! The services take one address for all of AWS (`LOCAL_AWS_URL`). This
//! server answers it: SQS requests go on to the SQS-compatible server the
//! scenario's queues live on, and S3 requests are served from memory, which
//! is all the object storage a scenario needs and lets it read what the
//! services stored. The same objects are served under [`CDN_PATH`], standing
//! in for the CDN that attachment links point at.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::header::{CONTENT_LENGTH, CONTENT_TYPE, ETAG, HOST};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rootcause::prelude::*;
use sha2::{Digest, Sha256};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

#[cfg(test)]
mod test;

/// The path the stored objects are served under, as the CDN would.
pub(crate) const CDN_PATH: &str = "_cdn";
/// The header every SQS request carries.
const SQS_TARGET: &str = "x-amz-target";
/// The header S3 answers an object's SHA-256 in.
const CHECKSUM_SHA256: &str = "x-amz-checksum-sha256";
/// The payload hash that marks a body sent in signed or trailer chunks.
const STREAMING_PAYLOAD: &str = "STREAMING-";
const PAYLOAD_HASH: &str = "x-amz-content-sha256";
/// The largest request body the endpoint reads.
const BODY_LIMIT: usize = 64 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE: &str = "application/octet-stream";
/// How a DynamoDB call names its operation, in the same header.
const DYNAMODB_TARGET: &str = "DynamoDB_";
/// The one table a service finds: no scenario stores anything in it.
const DYNAMODB_TABLE: &str = r#"{"Table":{"TableName":"email-e2e","TableStatus":"ACTIVE"}}"#;
/// The operation a queue send is, at the end of its `x-amz-target`.
const SEND_MESSAGE: &str = ".SendMessage";
const SQS_CONTENT_TYPE: &str = "application/x-amz-json-1.0";
/// An SQS error the AWS client reports without retrying.
const REFUSED_SEND: &str = r#"{"__type":"com.amazonaws.sqs#KmsAccessDenied","message":"email_e2e: the scenario refused this send"}"#;

/// An object the email services stored.
#[derive(Clone, Debug)]
pub struct StoredObject {
    /// The bucket.
    pub bucket: String,
    /// The key within the bucket.
    pub key: String,
    /// The content type it was stored with.
    pub content_type: String,
    /// The bytes.
    pub bytes: Bytes,
}

type Objects = Arc<Mutex<BTreeMap<(String, String), StoredObject>>>;

#[derive(Clone)]
struct Endpoint {
    http: reqwest::Client,
    sqs_url: String,
    objects: Objects,
    refused_sends: RefusedSends,
}

/// The queue URLs whose next `SendMessage` is refused, once per entry.
type RefusedSends = Arc<Mutex<Vec<String>>>;

/// The running endpoint.
pub(crate) struct Aws {
    address: SocketAddr,
    objects: Objects,
    refused_sends: RefusedSends,
    cancel: CancellationToken,
    tracker: TaskTracker,
}

/// How long a forwarded request may take before the endpoint gives up.
const FORWARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

impl Aws {
    /// Starts the endpoint in front of the SQS server at `sqs_url`.
    pub(crate) async fn start(sqs_url: &str) -> Result<Self, Report> {
        let objects = Objects::default();
        let refused_sends = RefusedSends::default();
        let endpoint = Endpoint {
            http: reqwest::Client::builder()
                // Longer than the longest wait a queue poll asks for.
                .timeout(FORWARD_TIMEOUT)
                .build()
                .context("could not build the AWS endpoint's HTTP client")?,
            sqs_url: sqs_url.trim_end_matches('/').to_owned(),
            objects: objects.clone(),
            refused_sends: refused_sends.clone(),
        };

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .context("could not bind the AWS endpoint")?;
        let address = listener.local_addr()?;
        let app = Router::new().fallback(answer).with_state(endpoint);

        let cancel = CancellationToken::new();
        let tracker = TaskTracker::new();
        let stopped = cancel.clone();
        tracker.spawn(async move {
            let served = axum::serve(listener, app)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await;
            if let Err(error) = served {
                tracing::error!(error = ?error, "the AWS endpoint stopped");
            }
        });

        Ok(Self {
            address,
            objects,
            refused_sends,
            cancel,
            tracker,
        })
    }

    /// The endpoint's base URL, for `LOCAL_AWS_URL`.
    pub(crate) fn url(&self) -> String {
        format!("http://{}", self.address)
    }

    /// The base URL objects are served under as the CDN would.
    pub(crate) fn cdn_url(&self) -> String {
        format!("{}/{CDN_PATH}", self.url())
    }

    /// Every stored object, ordered by bucket and key.
    pub(crate) fn objects(&self) -> Vec<StoredObject> {
        self.objects
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .cloned()
            .collect()
    }

    /// Refuses the services' next `times` sends to the queue at `queue_url`
    /// with an error the AWS client does not retry.
    pub(crate) fn refuse_sends(&self, queue_url: &str, times: usize) {
        let mut refused = self
            .refused_sends
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        refused.extend(std::iter::repeat_n(queue_url.to_owned(), times));
    }

    /// How many refusals asked for at `queue_url` no send has met yet.
    pub(crate) fn refusals_left(&self, queue_url: &str) -> usize {
        let refused = self
            .refused_sends
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        refused.iter().filter(|url| *url == queue_url).count()
    }

    /// Stops the endpoint.
    pub(crate) async fn stop(self) {
        self.cancel.cancel();
        self.tracker.close();
        self.tracker.wait().await;
    }
}

async fn answer(State(endpoint): State<Endpoint>, request: Request) -> Response {
    let method = request.method().clone();
    let headers = request.headers().clone();
    let path = request.uri().path().to_owned();
    let query = request.uri().query().map(str::to_owned);
    let Ok(body) = axum::body::to_bytes(request.into_body(), BODY_LIMIT).await else {
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    };

    if let Some(target) = headers.get(SQS_TARGET).and_then(|value| value.to_str().ok())
        && target.starts_with(DYNAMODB_TARGET)
    {
        return dynamodb_table();
    }
    if headers.contains_key(SQS_TARGET) {
        if let Some(refusal) = refused_send(&endpoint.refused_sends, &headers, &body) {
            return refusal;
        }
        return forward_to_sqs(&endpoint, method, &headers, &path, query.as_deref(), body).await;
    }

    let decoded = urlencoding::decode(path.trim_start_matches('/'))
        .map(|path| path.into_owned())
        .unwrap_or_default();
    let (bucket, key) = match decoded.split_once('/') {
        // The CDN signs a URL whose single path segment is the encoded key.
        Some((CDN_PATH, key)) => return get_any_bucket(&endpoint.objects, key),
        Some((bucket, key)) => (bucket.to_owned(), key.to_owned()),
        None => (decoded, String::new()),
    };

    let mut objects = endpoint
        .objects
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let name = (bucket.clone(), key.clone());
    if key.is_empty() {
        // Bucket-level calls: creating one, or a batch delete the services do
        // not wait on. Buckets exist as soon as they are named.
        return StatusCode::OK.into_response();
    }

    match method {
        Method::PUT => {
            let bytes = if streamed(&headers) {
                unchunk(&body)
            } else {
                body
            };
            let content_type = headers
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or(DEFAULT_CONTENT_TYPE)
                .to_owned();
            let stored = StoredObject {
                bucket,
                key,
                content_type,
                bytes,
            };
            // The answer to a PUT describes the object but carries none of it.
            let mut response = object_headers(&stored, StatusCode::OK);
            response.headers_mut().remove(CONTENT_LENGTH);
            response.headers_mut().remove(CONTENT_TYPE);
            objects.insert(name, stored);
            response
        }
        Method::HEAD => match objects.get(&name) {
            Some(stored) => object_headers(stored, StatusCode::OK),
            None => StatusCode::NOT_FOUND.into_response(),
        },
        Method::GET => match objects.get(&name) {
            Some(stored) => get_response(stored),
            None => no_such_key(&name.1),
        },
        Method::DELETE => {
            objects.remove(&name);
            StatusCode::NO_CONTENT.into_response()
        }
        _ => StatusCode::METHOD_NOT_ALLOWED.into_response(),
    }
}

/// Every DynamoDB call is answered as a description of an existing table:
/// the search indexer only checks at startup that its job table is there.
fn dynamodb_table() -> Response {
    (
        [(CONTENT_TYPE, "application/x-amz-json-1.0")],
        DYNAMODB_TABLE,
    )
        .into_response()
}

fn get_any_bucket(objects: &Objects, key: &str) -> Response {
    let objects = objects.lock().unwrap_or_else(PoisonError::into_inner);
    match objects.values().find(|stored| stored.key == key) {
        Some(stored) => get_response(stored),
        None => no_such_key(key),
    }
}

fn get_response(stored: &StoredObject) -> Response {
    let mut response = object_headers(stored, StatusCode::OK);
    *response.body_mut() = axum::body::Body::from(stored.bytes.clone());
    response
}

fn no_such_key(key: &str) -> Response {
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Error><Code>NoSuchKey</Code>\
         <Message>The specified key does not exist.</Message><Key>{key}</Key></Error>"
    );
    (
        StatusCode::NOT_FOUND,
        [(CONTENT_TYPE, "application/xml")],
        body,
    )
        .into_response()
}

/// The headers S3 describes an object with.
fn object_headers(stored: &StoredObject, status: StatusCode) -> Response {
    let digest = Sha256::digest(&stored.bytes);
    let mut response = status.into_response();
    let headers = response.headers_mut();
    let values = [
        (CONTENT_TYPE, stored.content_type.clone()),
        (CONTENT_LENGTH, stored.bytes.len().to_string()),
        (ETAG, format!("\"{}\"", hex::encode(&digest[..16]))),
    ];
    for (name, value) in values {
        if let Ok(value) = HeaderValue::from_str(&value) {
            headers.insert(name, value);
        }
    }
    if let Ok(value) = HeaderValue::from_str(&STANDARD.encode(digest)) {
        headers.insert(CHECKSUM_SHA256, value);
    }
    response
}

fn streamed(headers: &HeaderMap) -> bool {
    headers
        .get(PAYLOAD_HASH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|hash| hash.starts_with(STREAMING_PAYLOAD))
}

/// Joins the chunks of an `aws-chunked` body: each is its size in hex, an
/// optional `;extension`, a line break, the bytes and a line break; a
/// zero-sized chunk and the trailers end the body.
fn unchunk(body: &Bytes) -> Bytes {
    let mut joined = Vec::with_capacity(body.len());
    let mut rest: &[u8] = body;
    while let Some(line_end) = rest.windows(2).position(|pair| pair == b"\r\n") {
        let line = String::from_utf8_lossy(&rest[..line_end]);
        let size = line.split(';').next().unwrap_or_default();
        let Ok(size) = usize::from_str_radix(size.trim(), 16) else {
            break;
        };
        let start = line_end + 2;
        let Some(chunk) = rest.get(start..start + size) else {
            break;
        };
        if size == 0 {
            break;
        }
        joined.extend_from_slice(chunk);
        rest = rest.get(start + size + 2..).unwrap_or_default();
    }
    Bytes::from(joined)
}

/// The refusal of a `SendMessage` a scenario asked to fail, when this is one.
fn refused_send(refused: &RefusedSends, headers: &HeaderMap, body: &Bytes) -> Option<Response> {
    let target = headers.get(SQS_TARGET)?.to_str().ok()?;
    if !target.ends_with(SEND_MESSAGE) {
        return None;
    }
    let request: serde_json::Value = serde_json::from_slice(body).ok()?;
    let queue_url = request["QueueUrl"].as_str()?;
    let mut refused = refused.lock().unwrap_or_else(PoisonError::into_inner);
    let index = refused.iter().position(|url| url == queue_url)?;
    refused.remove(index);
    Some(
        (
            StatusCode::BAD_REQUEST,
            [(CONTENT_TYPE, SQS_CONTENT_TYPE)],
            REFUSED_SEND,
        )
            .into_response(),
    )
}

/// Passes an SQS request on and answers what the SQS server answered.
async fn forward_to_sqs(
    endpoint: &Endpoint,
    method: Method,
    headers: &HeaderMap,
    path: &str,
    query: Option<&str>,
    body: Bytes,
) -> Response {
    let mut url = format!("{}{path}", endpoint.sqs_url);
    if let Some(query) = query {
        url.push('?');
        url.push_str(query);
    }

    let mut forwarded = endpoint.http.request(method, url).body(body);
    for (name, value) in headers {
        if name != HOST && name != CONTENT_LENGTH {
            forwarded = forwarded.header(name, value);
        }
    }

    let answered = match forwarded.send().await {
        Ok(answered) => answered,
        Err(error) => {
            tracing::error!(error = ?error, "could not reach the SQS server");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    let status = answered.status();
    let answered_headers = answered.headers().clone();
    let Ok(bytes) = answered.bytes().await else {
        return StatusCode::BAD_GATEWAY.into_response();
    };

    let mut response = (status, bytes).into_response();
    for (name, value) in &answered_headers {
        if name != CONTENT_LENGTH && name != axum::http::header::TRANSFER_ENCODING {
            response.headers_mut().insert(name, value.clone());
        }
    }
    response
}
