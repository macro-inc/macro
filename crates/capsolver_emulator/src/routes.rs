//! The HTTP surface: CapSolver's task API and `/_emulator/`.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{CapsolverEmulator, CreatedTask, KEPT_TASKS, Outcome, Task};

const TURNSTILE: &str = "AntiTurnstileTaskProxyLess";
/// The token task types the emulator answers; any other is
/// `ERROR_TASK_NOT_SUPPORTED`.
const SUPPORTED_TASK_TYPES: &[&str] = &[
    "ReCaptchaV2TaskProxyLess",
    "ReCaptchaV2EnterpriseTaskProxyLess",
    "ReCaptchaV3TaskProxyLess",
    "ReCaptchaV3EnterpriseTaskProxyLess",
    TURNSTILE,
];
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) CapsolverEmulator/1.0";

pub(crate) fn router() -> Router<CapsolverEmulator> {
    Router::new()
        .route("/createTask", post(create_task))
        .route("/getTaskResult", post(get_task_result))
        .route("/_emulator/outcomes/{site_key}", put(set_outcome))
        .route("/_emulator/tasks", get(created_tasks))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTask {
    #[serde(default)]
    client_key: String,
    task: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetTaskResult {
    #[serde(default)]
    client_key: String,
    #[serde(default)]
    task_id: String,
}

/// CapSolver's error body: `errorId` 1, with a 400 (401 for a bad key).
fn error(code: &str) -> Response {
    let status = if code == "ERROR_KEY_DENIED_ACCESS" {
        StatusCode::UNAUTHORIZED
    } else {
        StatusCode::BAD_REQUEST
    };
    let body = json!({ "errorId": 1, "errorCode": code, "errorDescription": code });
    (status, Json(body)).into_response()
}

/// `POST /createTask`: a task id, or the error scripted for the site key.
async fn create_task(
    State(emulator): State<CapsolverEmulator>,
    Json(request): Json<CreateTask>,
) -> Response {
    let task_type = request.task["type"].as_str().unwrap_or_default().to_owned();
    let site_key = request.task["websiteKey"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    let url = request.task["websiteURL"].as_str().unwrap_or_default();

    let mut state = emulator.state();
    let outcome = state.outcomes.get(&site_key).copied().unwrap_or_default();
    let refusal = if request.client_key.is_empty() {
        Some("ERROR_KEY_DENIED_ACCESS")
    } else if !SUPPORTED_TASK_TYPES.contains(&task_type.as_str()) {
        Some("ERROR_TASK_NOT_SUPPORTED")
    } else if site_key.is_empty() || url.is_empty() {
        Some("ERROR_INVALID_TASK_DATA")
    } else if outcome == Outcome::RateLimited {
        Some("ERROR_RATE_LIMIT")
    } else if outcome == Outcome::ZeroBalance {
        Some("ERROR_ZERO_BALANCE")
    } else {
        None
    };

    let task_id = refusal.is_none().then(|| Uuid::now_v7().to_string());
    if state.created.len() == KEPT_TASKS {
        state.created.remove(0);
    }
    state.created.push(CreatedTask {
        client_key: request.client_key,
        task: request.task,
        task_id: task_id.clone(),
    });
    let (Some(task_id), None) = (task_id, refusal) else {
        return error(refusal.unwrap_or("ERROR_BAD_REQUEST"));
    };

    let token = format!("emulated-token-{task_id}");
    let solution = if task_type == TURNSTILE {
        json!({ "token": token, "type": "turnstile", "userAgent": USER_AGENT })
    } else {
        json!({ "gRecaptchaResponse": token, "userAgent": USER_AGENT })
    };
    state.tasks.insert(
        task_id.clone(),
        Task {
            solution,
            outcome,
            polls: 0,
        },
    );
    Json(json!({
        "errorId": 0,
        "errorCode": "",
        "errorDescription": "",
        "status": "idle",
        "taskId": task_id,
    }))
    .into_response()
}

/// `POST /getTaskResult`: the task's state after one more poll.
async fn get_task_result(
    State(emulator): State<CapsolverEmulator>,
    Json(request): Json<GetTaskResult>,
) -> Response {
    if request.client_key.is_empty() {
        return error("ERROR_KEY_DENIED_ACCESS");
    }
    let mut state = emulator.state();
    let Some(task) = state.tasks.get_mut(&request.task_id) else {
        return error("ERROR_TASKID_INVALID");
    };
    task.polls += 1;

    let processing = match task.outcome {
        Outcome::Processing => true,
        Outcome::ProcessingThenReady { polls } => task.polls <= polls,
        Outcome::Unsolvable => {
            let body = json!({
                "errorId": 1,
                "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
                "errorDescription": "ERROR_CAPTCHA_UNSOLVABLE",
                "status": "failed",
                "taskId": request.task_id,
            });
            return (StatusCode::BAD_REQUEST, Json(body)).into_response();
        }
        Outcome::Timeout => return error("ERROR_TASK_TIMEOUT"),
        Outcome::Ready | Outcome::RateLimited | Outcome::ZeroBalance => false,
    };
    if processing {
        return Json(json!({ "errorId": 0, "status": "processing", "taskId": request.task_id }))
            .into_response();
    }
    Json(json!({
        "errorId": 0,
        "errorCode": null,
        "errorDescription": null,
        "status": "ready",
        "solution": task.solution,
        "taskId": request.task_id,
    }))
    .into_response()
}

/// `PUT /_emulator/outcomes/{site_key}` with an [`Outcome`] body.
async fn set_outcome(
    State(emulator): State<CapsolverEmulator>,
    Path(site_key): Path<String>,
    Json(outcome): Json<Outcome>,
) -> StatusCode {
    emulator.set_outcome(&site_key, outcome);
    StatusCode::NO_CONTENT
}

/// `GET /_emulator/tasks`: the `createTask` requests received.
async fn created_tasks(State(emulator): State<CapsolverEmulator>) -> Json<Vec<CreatedTask>> {
    Json(emulator.created_tasks())
}
