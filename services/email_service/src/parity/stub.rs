use axum::{
    Router,
    body::Bytes,
    extract::State,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub(super) struct Stub {
    pub url: String,
    state: Arc<Mutex<StateData>>,
    task: Arc<tokio::task::JoinHandle<()>>,
}

#[derive(Default)]
struct StateData {
    replies: Vec<(String, String, u16, Value)>,
    sequences: Vec<(String, String, std::collections::VecDeque<(u16, Value)>)>,
    byte_replies: Vec<(String, String, u16, Vec<u8>, String)>,
    wire_replies: Vec<WireReply>,
    requests: super::HttpRecording,
}

#[derive(Clone)]
pub(super) enum WireBody {
    Stream {
        chunks: Vec<Vec<u8>>,
        fail: bool,
    },
    /// Keep the request pending until the production client's timeout fires.
    Pending,
}

#[derive(Clone)]
struct WireReply {
    prefix: String,
    headers: Vec<(String, String)>,
    body: WireBody,
}

impl Stub {
    pub async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("stub listener");
        let url = format!("http://{}", listener.local_addr().expect("stub address"));
        let state = Arc::new(Mutex::new(StateData::default()));
        let app = Router::new().fallback(handle).with_state(state.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("stub server");
        });
        Self {
            url,
            state,
            task: Arc::new(task),
        }
    }

    pub fn reply(&self, method: &str, prefix: &str, status: u16, body: Value) {
        self.state.lock().expect("stub mutex").replies.push((
            method.into(),
            prefix.into(),
            status,
            body,
        ));
    }

    /// Consume successive responses, then retain the final response for retries.
    pub fn reply_sequence(&self, method: &str, prefix: &str, replies: Vec<(u16, Value)>) {
        self.state.lock().expect("stub mutex").sequences.push((
            method.into(),
            prefix.into(),
            replies.into(),
        ));
    }

    pub fn reply_bytes(
        &self,
        method: &str,
        prefix: &str,
        status: u16,
        body: Vec<u8>,
        content_type: &str,
    ) {
        self.state.lock().expect("stub mutex").byte_replies.push((
            method.into(),
            prefix.into(),
            status,
            body,
            content_type.into(),
        ));
    }

    /// Opt-in GET response for image size, stream, redirect and timeout cases.
    pub fn reply_wire(&self, prefix: &str, headers: &[(&str, &str)], body: WireBody) {
        self.state
            .lock()
            .expect("stub mutex")
            .wire_replies
            .push(WireReply {
                prefix: prefix.into(),
                headers: headers
                    .iter()
                    .map(|(name, value)| ((*name).into(), (*value).into()))
                    .collect(),
                body,
            });
    }

    pub fn recording(&self) -> super::HttpRecording {
        self.state.lock().expect("stub mutex").requests.clone()
    }

    pub fn take(&self) -> Vec<Value> {
        std::mem::take(&mut self.recording().lock().expect("HTTP recording"))
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        if Arc::strong_count(&self.task) == 1 {
            self.task.abort();
        }
    }
}

async fn handle(
    State(state): State<Arc<Mutex<StateData>>>,
    headers: HeaderMap,
    method: Method,
    uri: Uri,
    body: Bytes,
) -> Response {
    let wire = {
        let state = state.lock().expect("stub mutex");
        state
            .wire_replies
            .iter()
            .rev()
            .find(|reply| method == Method::GET && uri.path().starts_with(&reply.prefix))
            .cloned()
    };
    if let Some(reply) = wire {
        let pending = matches!(reply.body, WireBody::Pending);
        let redirect = reply.headers.iter().any(|(name, _)| name == "location");
        let status: u16 = if redirect { 302 } else { 200 };
        state
            .lock()
            .expect("stub mutex")
            .requests
            .lock()
            .expect("HTTP recording")
            .push(json!({
                "method": method.as_str(), "path": uri.to_string(), "body": super::http_body(&body),
                "status": if pending { None } else { Some(status) }
            }));
        let WireBody::Stream { chunks, fail } = reply.body else {
            return std::future::pending().await;
        };
        let chunks = chunks.into_iter().map(|bytes| Ok(Bytes::from(bytes)));
        let failure = fail.then(|| {
            Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionReset,
                "scripted image stream failure",
            ))
        });
        let body = axum::body::Body::from_stream(futures::stream::iter(chunks.chain(failure)));
        let mut response = Response::builder().status(status);
        for (name, value) in reply.headers {
            response = response.header(name, value);
        }
        return response.body(body).expect("scripted image response");
    }
    let mut state = state.lock().expect("stub mutex");
    let sequence = state
        .sequences
        .iter_mut()
        .rev()
        .find(|(m, prefix, _)| m == method.as_str() && uri.path().starts_with(prefix))
        .and_then(|(_, _, replies)| {
            if replies.len() > 1 {
                replies.pop_front()
            } else {
                replies.front().cloned()
            }
        });
    let bytes = state
        .byte_replies
        .iter()
        .rev()
        .find(|(m, prefix, _, _, _)| m == method.as_str() && uri.path().starts_with(prefix));
    let (mut status, response) = sequence.unwrap_or_else(|| {
        state
            .replies
            .iter()
            .rev()
            .find(|(m, prefix, _, _)| m == method.as_str() && uri.path().starts_with(prefix))
            .map(|(_, _, status, body)| (*status, body.clone()))
            .unwrap_or((200, json!({})))
    });
    if let Some((_, _, byte_status, _, _)) = bytes {
        status = *byte_status;
    }
    // The local environment probes listeners with an unauthenticated GET /.
    // These are not requests sent by the service. Signed S3 root calls remain.
    if method != Method::GET
        || uri.path() != "/"
        || headers.contains_key("authorization")
        || headers.contains_key("x-internal-auth-key")
    {
        state
            .requests
            .lock()
            .expect("HTTP recording")
            .push(json!({"method": method.as_str(), "path": uri.to_string(),
            "body": super::http_body(&body), "status": status}));
    }
    if let Some((_, _, _, bytes, content_type)) = bytes {
        return (
            StatusCode::from_u16(status).expect("scripted status"),
            [("content-type", content_type.clone())],
            bytes.clone(),
        )
            .into_response();
    }
    (
        StatusCode::from_u16(status).expect("scripted HTTP status"),
        axum::Json(response),
    )
        .into_response()
}
