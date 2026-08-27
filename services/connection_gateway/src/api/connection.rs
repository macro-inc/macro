use crate::{
    config::Config,
    constants::SLOW_WEBSOCKET_OPERATION_THRESHOLD,
    context::{ApiContext, AppState, AuthorizationService},
    model::{
        connection::ConnectionContext,
        message::{OutgoingMessage, record_span_error},
        tracking::EntityConnectionExt,
    },
};
use anyhow::Result;
use axum::{
    Router,
    extract::{
        State,
        ws::{Message as AxumWebsocketMessage, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
};
use futures::{
    FutureExt,
    sink::SinkExt,
    stream::{SplitSink, StreamExt},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use messages::handle_websocket_stream;
use model::user::UserContext;
use model_entity::EntityType;
use std::sync::Arc;
use tokio::sync::mpsc::Receiver;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

mod messages;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(ws_handler))
}

/// Handle upgrading the https connection to a websocket connection
#[tracing::instrument(
    skip(ws, authorization, ctx, config),
    fields(actor = %authorization.acting_entity())
)]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    State(ctx): State<ApiContext>,
    State(config): State<Arc<Config>>,
) -> impl IntoResponse {
    let macro_user_id = authorization.authorization.user.macro_user_id.clone();
    let user_context = authorization.authorization.user.user_context.clone();

    ws.on_upgrade(move |socket| {
        handle_websocket_connection(socket, ctx, config, macro_user_id, user_context)
    })
}

/// Handles a new websocket connection
/// Should create a new connection in the connection manager,
/// and spawn tasks for both forwarding of messages, and reading incoming messages from the client.
/// If any part of forwarding or reading fails, then the connection should be removed from the connection manager.
#[tracing::instrument(skip(socket, ctx, config, macro_user_id, user_context), fields(user_id=?macro_user_id))]
async fn handle_websocket_connection(
    socket: WebSocket,
    ctx: ApiContext,
    config: Arc<Config>,
    macro_user_id: MacroUserIdStr<'static>,
    user_context: UserContext,
) {
    let (sink, stream) = socket.split();
    let (sender, receiver) = tokio::sync::mpsc::channel::<OutgoingMessage>(100);
    let connection_id = uuid::Uuid::new_v4().to_string();

    // Create guard that records last online time when websocket connection closes
    let last_online_guard = ctx.last_online_worker.new_guard(macro_user_id.clone());

    let sender_connection_id = connection_id.clone();
    let sender_task = tokio::spawn(forwarder(sink, receiver, sender_connection_id));

    if let Err(err) = ctx
        .connection_manager
        .add_connection(
            EntityType::User
                .with_entity_str(macro_user_id.as_ref())
                .with_connection_str(&connection_id)
                .with_user_str(macro_user_id.as_ref()),
            sender.clone(),
            sender_task.abort_handle(),
        )
        .await
    {
        tracing::error!(error=?err, "unable to add initial connection entry");
        return;
    }

    let connection_context = ConnectionContext {
        api_context: &ctx,
        config: &config,
        user_context: &user_context,
        connection_id: &connection_id,
    };

    let receiver_task = handle_websocket_stream(connection_context, stream, sender.clone()).fuse();

    tokio::select! {
        res = sender_task => {
            res.inspect(|_| tracing::debug!("sender task finished"))
                .inspect_err(|err| {
                    tracing::error!(error=?err, "sender task failed");
                }).ok();
        }
        res = receiver_task => {
            res.inspect(|_| tracing::debug!("receiver task finished"))
                .inspect_err(|err| {
                    tracing::error!(error=?err, "receiver task failed");
                }).ok();
        }
    }

    ctx.connection_manager
        .remove_connection(&connection_id.clone())
        .await
        .inspect(|_| tracing::debug!("connections removed"))
        .inspect_err(|e| {
            tracing::error!(
                error=?e,
                connection_id=?connection_id,
                user_id=?user_context.user_id,
                "failed to remove connection after websocket connection closed"
            );
        })
        .ok();
    drop(last_online_guard);
}

/// Forwards messages from a [Receiver] to a [SplitSink]
/// This is useful as [SplitSink] does not implement [Clone]
async fn forwarder(
    mut sink: SplitSink<WebSocket, AxumWebsocketMessage>,
    mut receiver: Receiver<OutgoingMessage>,
    connection_id: String,
) -> Result<()> {
    while let Some(mut message) = receiver.recv().await {
        let queue_depth = receiver.len();
        let queue_max_capacity = receiver.max_capacity();
        let span = match &message {
            OutgoingMessage::Message(message) => {
                let span = tracing::info_span!(
                    "connection_gateway.websocket_send",
                    otel.kind = "producer",
                    message_type = %message.message_type,
                    connection.id = %connection_id,
                    connection.queue.observed_depth = queue_depth,
                    connection.queue.max_capacity = queue_max_capacity,
                    websocket.write_ms = tracing::field::Empty,
                    otel.status_code = tracing::field::Empty,
                    otel.status_description = tracing::field::Empty,
                );
                if let Some(parent) = message.remote_trace_context() {
                    let _ = span.set_parent(parent);
                }
                span
            }
            OutgoingMessage::Pong => tracing::Span::none(),
        };
        if let OutgoingMessage::Message(message) = &mut message {
            message.trace.clear();
        }

        if let Ok(msg) = message.try_into() {
            let write_span = span.clone();
            let result = async {
                let started = tokio::time::Instant::now();
                let mut send = std::pin::pin!(sink.send(msg));
                let result = tokio::select! {
                    result = &mut send => result,
                    () = tokio::time::sleep(SLOW_WEBSOCKET_OPERATION_THRESHOLD) => {
                        tracing::warn!(
                            connection.id = %connection_id,
                            connection.queue.observed_depth = receiver.len(),
                            connection.queue.max_capacity = queue_max_capacity,
                            "websocket write is blocked"
                        );
                        send.await
                    }
                };
                (result, started.elapsed())
            }
            .instrument(write_span)
            .await;
            let (result, write) = result;
            span.record("websocket.write_ms", write.as_millis() as u64);
            if let Err(err) = result {
                record_span_error(&span, &err);
                tracing::warn!(
                    error=?err,
                    "Failed to send message to WebSocket, client likely disconnected"
                );
                break;
            }
        }
    }

    Ok(())
}
