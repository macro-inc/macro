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
    requests: super::HttpRecording,
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
    let state = state.lock().expect("stub mutex");
    let (status, response) = state
        .replies
        .iter()
        .rev()
        .find(|(m, prefix, _, _)| m == method.as_str() && uri.path().starts_with(prefix))
        .map(|(_, _, status, body)| (*status, body.clone()))
        .unwrap_or((200, json!({})));
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
    (
        StatusCode::from_u16(status).expect("scripted HTTP status"),
        axum::Json(response),
    )
        .into_response()
}
