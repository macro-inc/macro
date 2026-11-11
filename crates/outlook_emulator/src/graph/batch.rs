//! JSON batching: up to twenty requests in one `POST /$batch`, each
//! answered with its own status.

use axum::http::{HeaderMap, HeaderValue, Method, header};
use axum::response::Response;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use super::{API_VERSION, Call, Reply, Served, logged, open, response, serve};
use crate::OutlookEmulator;
use crate::error::GraphError;
use crate::fault::Route;
use crate::render;
use crate::state::State;

const MAX_REQUESTS: usize = 20;

/// Serves one request of a batch and renders its response entry.
fn step(
    state: &mut State,
    token: Option<&str>,
    root: &str,
    request: &Value,
) -> Result<Value, GraphError> {
    let invalid = |what: &str| GraphError::bad_request(&format!("A batch request needs {what}."));
    let id = request["id"].as_str().ok_or_else(|| invalid("an id"))?;
    let method: Method = request["method"]
        .as_str()
        .and_then(|method| method.parse().ok())
        .ok_or_else(|| invalid("a method"))?;
    let url = request["url"].as_str().ok_or_else(|| invalid("a url"))?;
    let (path, query) = match url.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (url, None),
    };
    let path = path.trim_start_matches('/');
    let path = path
        .strip_prefix(API_VERSION)
        .map_or(path, |rest| rest.trim_start_matches('/'));

    let mut headers = HeaderMap::new();
    if let Some(version) = request["headers"]["If-Match"].as_str()
        && let Ok(version) = HeaderValue::from_str(version)
    {
        headers.insert(header::IF_MATCH, version);
    }
    let body = match request.get("body") {
        Some(body) => serde_json::to_vec(body).unwrap_or_default(),
        None => Vec::new(),
    };
    let call = Call::new(method, path, query, &headers, body, root.to_string());
    if call
        .segments
        .first()
        .is_some_and(|first| first == "subscriptions")
        && call.method == Method::POST
    {
        return Err(GraphError::bad_request(
            "The emulator does not create subscriptions inside a batch.",
        ));
    }

    let date = render::time(state.now());
    let served = serve(state, token, &call);
    let mut entry_headers = serde_json::Map::new();
    let (status, body) = match served.result {
        Ok(Reply::Json(status, body)) => (status, Some(body)),
        Ok(Reply::Bytes(content_type, bytes)) => {
            entry_headers.insert("Content-Type".to_string(), json!(content_type));
            (200, Some(json!(STANDARD.encode(bytes))))
        }
        Ok(Reply::Empty(status)) => (status, None),
        Err(error) => {
            if let Some(seconds) = error.retry_after_seconds {
                entry_headers.insert("Retry-After".to_string(), json!(seconds.to_string()));
            }
            (error.status, Some(error.body(id, &date)))
        }
    };
    let mut entry = json!({"id": id, "status": status, "headers": entry_headers});
    if let Some(body) = body {
        entry["body"] = body;
    }
    Ok(entry)
}

pub(crate) async fn serve_batch(
    emulator: &OutlookEmulator,
    token: Option<&str>,
    call: &Call,
) -> Response {
    let (served, date) = emulator.with_state(|state| {
        let date = state.now();
        let mut ctx = match open(state, token, call) {
            Ok(ctx) => ctx,
            Err((mailbox, error)) => {
                let failed = Served {
                    route: Some(Route::Batch),
                    mailbox,
                    delay: None,
                    result: Err(error),
                };
                return (failed, date);
            }
        };
        let result = ctx.enter(Route::Batch).and_then(|()| {
            let body = ctx.json_body()?;
            let requests = body["requests"]
                .as_array()
                .ok_or_else(|| GraphError::bad_request("A batch needs a requests array."))?;
            if requests.len() > MAX_REQUESTS {
                return Err(GraphError::bad_request(
                    "The batch has more than 20 requests.",
                ));
            }
            let mut responses = Vec::new();
            for request in requests {
                responses.push(step(ctx.state, token, &call.root, request)?);
            }
            Ok(Reply::Json(200, json!({ "responses": responses })))
        });
        (ctx.served(result), date)
    });
    if let Some(delay) = served.delay {
        tokio::time::sleep(delay).await;
    }
    logged(response(served.result, date), served.route, served.mailbox)
}
