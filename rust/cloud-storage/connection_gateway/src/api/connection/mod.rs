use crate::{
    config::Config,
    context::{ApiContext, AppState},
    model::{connection::ConnectionContext, message::OutgoingMessage},
};
use anyhow::Result;
use axum::{
    Router,
    extract::{
        Extension, State,
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
use messages::handle_websocket_stream;
use model::user::UserContext;
use model_entity::EntityType;
use std::sync::Arc;
use tokio::sync::mpsc::Receiver;

mod messages;

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(ws_handler))
}

/// Handle upgrading the https connection to a websocket connection
#[tracing::instrument(skip(ws, ctx, user_context, config), fields(user_id=?user_context.user_id))]
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(ctx): State<ApiContext>,
    State(config): State<Arc<Config>>,
    user_context: Extension<UserContext>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| {
        handle_websocket_connection(socket, ctx, config, user_context.clone())
    })
}

/// Handles a new websocket connection
/// Should create a new connection in the connection manager,
/// and spawn tasks for both forwarding of messages, and reading incoming messages from the client.
/// If any part of forwarding or reading fails, then the connection should be removed from the connection manager.
#[tracing::instrument(skip(socket, ctx, user_context, config), fields(user_id=?user_context.user_id))]
async fn handle_websocket_connection(
    socket: WebSocket,
    ctx: ApiContext,
    config: Arc<Config>,
    user_context: Extension<UserContext>,
) {
    let (sink, stream) = socket.split();
    let (sender, receiver) = tokio::sync::mpsc::channel::<OutgoingMessage>(100);
    let connection_id = uuid::Uuid::new_v4().to_string();
    let user_id = user_context.user_id.clone();

    let sender_task = tokio::spawn(async move { forwarder(sink, receiver).await });

    if let Err(err) = ctx
        .connection_manager
        .add_connection(
            EntityType::User
                .with_entity_str(&user_id)
                .with_connection_str(&connection_id)
                .with_user_str(&user_id),
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
}

/// Forwards messages from a [Receiver] to a [SplitSink]
/// This is useful as [SplitSink] does not implement [Clone]
pub async fn forwarder(
    mut sink: SplitSink<WebSocket, AxumWebsocketMessage>,
    mut receiver: Receiver<OutgoingMessage>,
) -> Result<()> {
    while let Some(message) = receiver.recv().await {
        if let Ok(msg) = message.try_into()
            && let Err(err) = sink.send(msg).await
        {
            tracing::warn!(
                error=?err,
                "Failed to send message to WebSocket, client likely disconnected"
            );
            break;
        }
    }

    Ok(())
}
