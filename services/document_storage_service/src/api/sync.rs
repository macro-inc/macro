//! Dedicated multiplexed document-sync transport. Authorization of each document
//! remains in sync-service's scoped-token handshake.

use super::context::{ApiContext, AuthorizationService};
use axum::{
    Router,
    extract::{
        Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use axum_extra::extract::Cached;
use macro_authorization::{OptionalMacroAuthorizationExtractor, UserOrInternalService};
use opentelemetry::trace::TraceContextExt;
use std::time::Duration;
use sync_router::session::{
    CLIENT_QUEUE_CAPACITY, MAX_FRAME_BYTES, SyncSession, SyncSessionFactory,
};
use tokio::sync::mpsc;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[cfg(test)]
mod test;

pub(super) fn router() -> Router<ApiContext> {
    Router::new().route("/sync/ws", get(upgrade))
}

#[derive(Default, serde::Deserialize)]
struct TraceQuery {
    traceparent: Option<String>,
}

async fn upgrade(
    State(state): State<ApiContext>,
    Cached(auth): Cached<
        OptionalMacroAuthorizationExtractor<AuthorizationService, UserOrInternalService>,
    >,
    Query(trace): Query<TraceQuery>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if auth
        .authorization
        .as_ref()
        .and_then(|auth| auth.acting_user())
        .is_none()
    {
        return (StatusCode::UNAUTHORIZED, "authentication required for sync").into_response();
    }
    upgrade_session(upgrade, &state.sync_sessions, trace.traceparent.as_deref())
}

fn upgrade_session(
    upgrade: WebSocketUpgrade,
    factory: &SyncSessionFactory,
    traceparent: Option<&str>,
) -> Response {
    let connection_id = uuid::Uuid::now_v7().to_string();
    let span = tracing::info_span!("sync.websocket", connection.id = %connection_id);
    if let Some(traceparent) = traceparent {
        let carrier =
            std::collections::HashMap::from([("traceparent".to_string(), traceparent.to_string())]);
        let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&carrier)
        });
        if parent.span().span_context().is_valid() {
            let _ = span.set_parent(parent);
        }
    }

    let (sender, receiver) = mpsc::channel(CLIENT_QUEUE_CAPACITY);
    let session = span.in_scope(|| factory.open(connection_id, sender));
    upgrade
        .max_message_size(MAX_FRAME_BYTES)
        .max_frame_size(MAX_FRAME_BYTES)
        .max_write_buffer_size(2 * MAX_FRAME_BYTES)
        .on_upgrade(move |socket| serve(socket, session, receiver).instrument(span))
}

async fn serve(mut socket: WebSocket, session: SyncSession, mut frames: mpsc::Receiver<Vec<u8>>) {
    // Cancellation surrounds all socket IO, including a blocked write or event
    // queue. Upgraded sockets therefore drain when DSS receives SIGTERM.
    tokio::select! {
        biased;
        _ = session.closed() => {},
        _ = async {
            loop {
                tokio::select! {
                    incoming = socket.recv() => match incoming {
                        Some(Ok(Message::Binary(bytes))) => {
                            if session.frame(bytes.to_vec()).await.is_err() { break; }
                        }
                        Some(Ok(Message::Text(text))) if text == "ping" => {
                            if socket.send(Message::Text("pong".into())).await.is_err() { break; }
                        }
                        Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {},
                        _ => break,
                    },
                    frame = frames.recv() => {
                        let Some(frame) = frame else { break; };
                        if socket.send(Message::Binary(frame.into())).await.is_err() { break; }
                    },
                    _ = tokio::time::sleep(Duration::from_secs(60)) => break,
                }
            }
        } => {},
    }
    let _ = tokio::time::timeout(Duration::from_secs(1), socket.send(Message::Close(None))).await;
    session.shutdown().await;
}
