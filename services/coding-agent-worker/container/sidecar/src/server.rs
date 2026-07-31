//! The bridge itself: one websocket connection piped to one harness process.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;

use axum::Router;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Semaphore;

#[cfg(test)]
mod test;

/// Shared handler state.
#[derive(Clone)]
pub struct Config {
    harness: String,
    workspace: String,
    /// When set, bridge connections must present this token (needed wherever
    /// the sidecar is reachable from the open internet; /ping stays open as a
    /// readiness probe).
    token: Option<String>,
    /// Only one agent connection at a time (ACP is 1:1).
    busy: Arc<Semaphore>,
}

impl Config {
    pub fn new(harness: String, workspace: String, token: Option<String>) -> Self {
        Self {
            harness,
            workspace,
            token,
            busy: Arc::new(Semaphore::new(1)),
        }
    }

    /// Accept `?token=` (websocket clients often can't set headers) or an
    /// `Authorization: Bearer` header.
    fn authorized(&self, params: &HashMap<String, String>, headers: &HeaderMap) -> bool {
        let Some(expected) = &self.token else {
            return true;
        };
        let query_ok = params.get("token").is_some_and(|t| t == expected);
        let header_ok = headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|t| t == expected);
        query_ok || header_ok
    }
}

pub fn app(config: Config) -> Router {
    Router::new()
        .route("/ping", get(async || "ok"))
        .route("/", get(bridge))
        .with_state(config)
}

async fn bridge(
    State(config): State<Config>,
    Query(params): Query<HashMap<String, String>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !config.authorized(&params, &headers) {
        return (StatusCode::UNAUTHORIZED, "invalid or missing token").into_response();
    }
    let Ok(permit) = config.busy.clone().try_acquire_owned() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            "an agent connection is already active",
        )
            .into_response();
    };
    // ACP frames carry file contents; don't limit their size.
    ws.max_message_size(usize::MAX)
        .max_frame_size(usize::MAX)
        .on_upgrade(move |socket| async move {
            pipe(socket, &config.harness, &config.workspace).await;
            drop(permit);
        })
        .into_response()
}

async fn pipe(socket: WebSocket, harness: &str, workspace: &str) {
    let mut child = match Command::new(harness)
        .args(["acp", "--cwd", workspace])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit()) // → sandbox logs
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            tracing::error!(error = ?e, harness, "failed to spawn harness");
            return;
        }
    };
    let mut stdin = child.stdin.take().expect("stdin was piped");
    let stdout = child.stdout.take().expect("stdout was piped");
    tracing::info!("agent connected, harness spawned");

    let (mut ws_tx, mut ws_rx) = socket.split();
    let mut lines = BufReader::new(stdout).lines();
    loop {
        tokio::select! {
            line = lines.next_line() => match line {
                Ok(Some(line)) => {
                    if ws_tx.send(Message::Text(line.into())).await.is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    tracing::info!("harness exited, closing socket");
                    let _ = ws_tx.send(Message::Close(None)).await;
                    break;
                }
                Err(e) => {
                    tracing::error!(error = ?e, "failed to read harness stdout, closing socket");
                    let _ = ws_tx.send(Message::Close(None)).await;
                    break;
                }
            },
            msg = ws_rx.next() => {
                let bytes = match msg {
                    Some(Ok(Message::Binary(data))) => data,
                    Some(Ok(Message::Text(text))) => text.into(),
                    // axum answers pings itself; ignore strays.
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                };
                if stdin.write_all(&bytes).await.is_err()
                    || stdin.write_all(b"\n").await.is_err()
                {
                    break;
                }
            },
        }
    }

    let _ = child.kill().await;
    tracing::info!("agent disconnected, harness killed");
}
