//! The HTTP surface: Gemini's GenerateContent API and `/_emulator/`.

use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{ModelEmulator, ReceivedRequest, Reply, Script, ScriptName};

/// The method a GenerateContent path ends in, after the model and a colon.
const STREAM: &str = "streamGenerateContent";
const AT_ONCE: &str = "generateContent";

pub(crate) fn router() -> Router<ModelEmulator> {
    Router::new()
        .route("/v1beta/models/{call}", post(generate_content))
        .route(
            "/_emulator/scripts/{name}",
            put(set_script).delete(remove_script),
        )
        .route(
            "/_emulator/requests",
            get(list_requests).delete(clear_requests),
        )
}

/// `POST /v1beta/models/<model>:<method>`: the reply as one complete
/// response, alone or as the only event of a stream.
async fn generate_content(
    State(emulator): State<ModelEmulator>,
    Path(call): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    let Some((model, method)) = call.rsplit_once(':') else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if method != STREAM && method != AT_ONCE {
        return StatusCode::NOT_FOUND.into_response();
    }

    let reply = emulator.answer(model.to_owned(), body);
    let response = response(model, reply);
    if method == AT_ONCE {
        return Json(response).into_response();
    }
    (
        [(header::CONTENT_TYPE, "text/event-stream")],
        format!("data: {response}\n\n"),
    )
        .into_response()
}

/// A finished GenerateContent response carrying the reply. The token counts
/// are made up, and add up, so a caller that meters usage accepts them.
fn response(model: &str, reply: Reply) -> Value {
    let text = reply.text.into_iter().map(|text| json!({ "text": text }));
    let calls = reply.calls.into_iter().map(|call| {
        json!({
            "functionCall": {
                "id": format!("call-{}", Uuid::now_v7()),
                "name": call.name,
                "args": call.args,
            }
        })
    });

    json!({
        "candidates": [{
            "content": { "role": "model", "parts": text.chain(calls).collect::<Vec<_>>() },
            "finishReason": "STOP",
            "index": 0,
        }],
        "usageMetadata": {
            "promptTokenCount": 2,
            "candidatesTokenCount": 1,
            "totalTokenCount": 3,
        },
        "modelVersion": model,
        "responseId": Uuid::now_v7().to_string(),
    })
}

async fn set_script(
    State(emulator): State<ModelEmulator>,
    Path(name): Path<ScriptName>,
    Json(script): Json<Script>,
) -> Response {
    match emulator.set_script(name, script) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
    }
}

async fn remove_script(
    State(emulator): State<ModelEmulator>,
    Path(name): Path<ScriptName>,
) -> StatusCode {
    emulator.remove_script(&name);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct RequestFilter {
    script: Option<ScriptName>,
}

async fn list_requests(
    State(emulator): State<ModelEmulator>,
    Query(filter): Query<RequestFilter>,
) -> Json<Vec<ReceivedRequest>> {
    Json(emulator.requests(filter.script.as_ref()))
}

async fn clear_requests(State(emulator): State<ModelEmulator>) -> StatusCode {
    emulator.clear_requests();
    StatusCode::NO_CONTENT
}
