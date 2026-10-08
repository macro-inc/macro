//! Private, authenticated WebSocket API with bounded connections and messages.

use crate::{domain::*, protocol::*};
use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::Semaphore;

#[derive(Clone)]
struct ApiState {
    service: ExecutionService,
    token: ServiceToken,
    connections: Arc<Semaphore>,
}

/// Build a service-only API. No browser CORS, cookies, or public gateway route.
pub fn router(service: ExecutionService, token: ServiceToken, max_connections: usize) -> Router {
    Router::new()
        .route("/health", get(|| async { StatusCode::OK }))
        .route("/v1/execute", get(upgrade))
        .with_state(ApiState {
            service,
            token,
            connections: Arc::new(Semaphore::new(max_connections)),
        })
}

async fn upgrade(
    State(state): State<ApiState>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let authenticated = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .is_some_and(|value| state.token.matches(value));
    if !authenticated {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(permit) = state.connections.clone().try_acquire_owned() else {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    };
    ws.max_message_size(MAX_WIRE_BYTES)
        .max_frame_size(MAX_WIRE_BYTES)
        .on_upgrade(move |socket| async move {
            let _permit = permit;
            connection(socket, state.service).await;
        })
        .into_response()
}

async fn connection(mut socket: WebSocket, service: ExecutionService) {
    let first = tokio::time::timeout(Duration::from_secs(5), socket.recv()).await;
    let Ok(Some(Ok(Message::Text(text)))) = first else {
        return;
    };
    let Ok(ClientMessage::Execute { request }) = serde_json::from_str(&text) else {
        let _ = send(
            &mut socket,
            ServerMessage::Rejected {
                message: "expected execute frame".into(),
            },
        )
        .await;
        return;
    };
    let mut execution = match service.execute(request) {
        Ok(execution) => execution,
        Err(error) => {
            let _ = send(
                &mut socket,
                ServerMessage::Rejected {
                    message: error.to_string(),
                },
            )
            .await;
            return;
        }
    };
    loop {
        tokio::select! {
            event = execution.events.recv() => {
                let Some(event) = event else { break };
                let finished = matches!(event.kind, EventKind::Finished { .. });
                if !send(&mut socket, ServerMessage::Event { event }).await || finished { break }
            }
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => match serde_json::from_str(&text) {
                        Ok(ClientMessage::Reply { reply }) => {
                            if execution.replies.try_send(reply).is_err() { break }
                        }
                        Ok(ClientMessage::Cancel) => execution.cancellation.cancel(),
                        _ => break,
                    },
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {},
                    _ => break,
                }
            }
        }
    }
    // Dropping execution cancels the process, including on a failed socket send.
}

async fn send(socket: &mut WebSocket, message: ServerMessage) -> bool {
    let Ok(json) = serde_json::to_string(&message) else {
        return false;
    };
    matches!(
        tokio::time::timeout(
            Duration::from_secs(2),
            socket.send(Message::Text(json.into()))
        )
        .await,
        Ok(Ok(()))
    )
}

#[cfg(test)]
mod test;
