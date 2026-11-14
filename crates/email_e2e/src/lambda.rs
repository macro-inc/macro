//! One invocation of a scheduled handler.
//!
//! The work the crons do in production lives in Lambda binaries. This module
//! runs one of them as it is deployed: it serves the Lambda runtime API,
//! hands the binary one EventBridge event, and reports how the handler
//! answered it.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderName, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use rootcause::prelude::*;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::process::ServiceProcess;

/// How long a handler may take before the invocation counts as failed.
const INVOCATION_TIMEOUT: Duration = Duration::from_secs(120);
/// The request id of the one invocation.
/// How often the handler process is checked for having exited.
const EXIT_CHECK_EVERY: Duration = Duration::from_millis(100);
const REQUEST_ID: &str = "00000000-0000-7000-8000-000000000001";
const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("lambda-runtime-aws-request-id");
const DEADLINE_HEADER: HeaderName = HeaderName::from_static("lambda-runtime-deadline-ms");
const FUNCTION_ARN_HEADER: HeaderName =
    HeaderName::from_static("lambda-runtime-invoked-function-arn");
/// The event EventBridge sends on a schedule.
const SCHEDULED_EVENT: &str = r#"{"version":"0","id":"00000000-0000-7000-8000-000000000002","detail-type":"Scheduled Event","source":"aws.events","account":"000000000000","time":"2026-01-01T00:00:00Z","region":"us-east-1","resources":[],"detail":{}}"#;

/// How the handler answered: `Ok` with its response, `Err` with its error.
type Outcome = Result<String, String>;

#[derive(Clone)]
struct Runtime {
    /// Taken by the first poll for work; later polls wait for ever.
    event: Arc<Mutex<Option<&'static str>>>,
    outcome: Arc<Mutex<Option<oneshot::Sender<Outcome>>>>,
}

/// Runs the handler binary `name` for one scheduled event, with `env` and
/// what the Lambda runtime needs on top, and fails when the handler does.
pub(crate) async fn invoke_scheduled(
    name: &'static str,
    env: &BTreeMap<String, String>,
    log_dir: &Path,
) -> Result<(), Report> {
    crate::process::ensure_built(&[name])?;

    let (sender, receiver) = oneshot::channel();
    let runtime = Runtime {
        event: Arc::new(Mutex::new(Some(SCHEDULED_EVENT))),
        outcome: Arc::new(Mutex::new(Some(sender))),
    };
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("could not bind the Lambda runtime API")?;
    let address = listener.local_addr()?;
    let app = Router::new()
        .route("/2018-06-01/runtime/invocation/next", get(next))
        .route(
            "/2018-06-01/runtime/invocation/{id}/response",
            post(responded),
        )
        .route("/2018-06-01/runtime/invocation/{id}/error", post(failed))
        .route("/2018-06-01/runtime/init/error", post(failed))
        .with_state(runtime);
    let server = tokio::spawn(async move { axum::serve(listener, app).await });

    let mut env = env.clone();
    for (key, value) in [
        ("AWS_LAMBDA_RUNTIME_API", address.to_string()),
        ("AWS_LAMBDA_FUNCTION_NAME", name.to_owned()),
        ("AWS_LAMBDA_FUNCTION_MEMORY_SIZE", "512".to_owned()),
        ("AWS_LAMBDA_FUNCTION_VERSION", "$LATEST".to_owned()),
    ] {
        env.insert(key.to_owned(), value);
    }
    let mut process = ServiceProcess::spawn(name, &env, log_dir)?;

    let outcome = tokio::time::timeout(INVOCATION_TIMEOUT, async {
        let mut receiver = receiver;
        let mut check = tokio::time::interval(EXIT_CHECK_EVERY);
        loop {
            tokio::select! {
                outcome = &mut receiver => return outcome.ok(),
                // A handler that cannot start exits without answering.
                _ = check.tick() => {
                    if process.ensure_running().is_err() {
                        return None;
                    }
                }
            }
        }
    })
    .await;
    process.stop().await;
    server.abort();

    let log = || {
        format!(
            "the end of {}:\n{}",
            process.log_path().display(),
            process.log_tail()
        )
    };
    match outcome {
        Ok(Some(Ok(_))) => Ok(()),
        Ok(Some(Err(error))) => Err(report!("{name} failed its invocation: {error}").attach(log())),
        Ok(None) => Err(report!("{name} exited before answering its invocation").attach(log())),
        Err(_) => Err(report!(
            "{name} did not answer its invocation within {INVOCATION_TIMEOUT:?}"
        )
        .attach(log())),
    }
}

async fn next(State(runtime): State<Runtime>) -> Response {
    let event = runtime
        .event
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    let Some(event) = event else {
        // The handler asks for more work once it is done; there is none, and
        // the process is stopped while it waits.
        return std::future::pending().await;
    };
    let deadline = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        + INVOCATION_TIMEOUT;
    (
        StatusCode::OK,
        [
            (REQUEST_ID_HEADER, REQUEST_ID.to_owned()),
            (DEADLINE_HEADER, deadline.as_millis().to_string()),
            (
                FUNCTION_ARN_HEADER,
                "arn:aws:lambda:us-east-1:000000000000:function:email-e2e".to_owned(),
            ),
        ],
        event,
    )
        .into_response()
}

async fn responded(State(runtime): State<Runtime>, body: Bytes) -> StatusCode {
    settle(&runtime, Ok(String::from_utf8_lossy(&body).into_owned()))
}

async fn failed(State(runtime): State<Runtime>, body: Bytes) -> StatusCode {
    settle(&runtime, Err(String::from_utf8_lossy(&body).into_owned()))
}

fn settle(runtime: &Runtime, outcome: Outcome) -> StatusCode {
    let sender = runtime
        .outcome
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take();
    if let Some(sender) = sender {
        // The receiver is gone only when the invocation already timed out.
        sender.send(outcome).ok();
    }
    StatusCode::ACCEPTED
}
