//! The held call's own HTTP response: an event stream that keeps the client
//! waiting, then carries the tool's answer or why it did not run.

use bytes::Bytes;
use http::header::{CACHE_CONTROL, CONTENT_TYPE};
use http::{HeaderValue, StatusCode};
use http_body_util::{BodyExt, StreamBody};
use tokio::sync::mpsc;

use super::ForwardOnce;
use crate::domain::model::{BoxError, ProxyRequest, ProxyResponse};

/// Send the approved call upstream and relay its answer into the stream.
pub(super) async fn pass_through(
    forward: ForwardOnce,
    request: ProxyRequest,
    id: &serde_json::Value,
    server_name: &str,
    events: &mpsc::Sender<Bytes>,
) {
    let response = match forward(request).await {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = ?error, "an approved tool call could not reach its upstream");
            let text = format!("The call was approved, but {server_name} could not be reached.");
            let _ = events.send(sse_message(&tool_error(id, &text))).await;
            return;
        }
    };
    if !response.status().is_success() {
        let text = format!(
            "The call was approved, but {server_name} answered with HTTP {}.",
            response.status().as_u16()
        );
        let _ = events.send(sse_message(&tool_error(id, &text))).await;
        return;
    }
    let is_event_stream = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    let mut body = response.into_body();
    if is_event_stream {
        // Already events: relay them as they come.
        while let Some(frame) = body.frame().await {
            match frame {
                Ok(frame) => {
                    if let Ok(data) = frame.into_data()
                        && events.send(data).await.is_err()
                    {
                        return;
                    }
                }
                Err(error) => {
                    tracing::warn!(error = %error, "an approved tool call's stream broke");
                    return;
                }
            }
        }
        return;
    }
    let bytes = match body.collect().await {
        Ok(collected) => collected.to_bytes(),
        Err(error) => {
            tracing::warn!(error = %error, "an approved tool call's answer could not be read");
            return;
        }
    };
    let message = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(message) => sse_message(&message),
        Err(_) => sse_message(&tool_error(
            id,
            &format!(
                "The call was approved, but {server_name} answered with something that is not JSON."
            ),
        )),
    };
    let _ = events.send(message).await;
}

/// A tool result the model reads as the tool's own failed answer.
pub(super) fn tool_error(id: &serde_json::Value, text: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "isError": true,
            "content": [{ "type": "text", "text": text }],
        },
    })
}

/// One JSON-RPC message as a server-sent event.
pub(super) fn sse_message(message: &serde_json::Value) -> Bytes {
    let mut event = b"event: message\ndata: ".to_vec();
    event.extend(serde_json::to_vec(message).expect("a JSON value serializes"));
    event.extend(b"\n\n");
    Bytes::from(event)
}

pub(super) fn json_response(message: &serde_json::Value) -> ProxyResponse {
    let bytes = Bytes::from(serde_json::to_vec(message).expect("a JSON value serializes"));
    let mut response = http::Response::new(
        http_body_util::Full::new(bytes)
            .map_err(|never| match never {})
            .boxed_unsync(),
    );
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

pub(super) fn stream_response(received: mpsc::Receiver<Bytes>) -> ProxyResponse {
    let frames = futures::stream::unfold(received, |mut received| async move {
        received
            .recv()
            .await
            .map(|bytes| (Ok::<_, BoxError>(http_body::Frame::data(bytes)), received))
    });
    let mut response = http::Response::new(StreamBody::new(frames).boxed_unsync());
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}
