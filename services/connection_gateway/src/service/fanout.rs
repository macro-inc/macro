//! Republish this instance's entire inbound websocket traffic to Redis.
//!
//! Every accepted connection, every client frame (text or binary, unparsed),
//! and every disconnect is published on
//! [`connection_gateway_models::fanout::INBOUND_CHANNEL`], so backend services
//! can consume client traffic without the gateway knowing they exist. The
//! sync tier is the first consumer.
//!
//! Publishing is fire-and-forget by design: a publish failure is logged and
//! never fails the connection's own message handling.

use crate::context::ApiContext;
use crate::model::connection::ConnectionContext;
use anyhow::{Context, Result};
use connection_gateway_models::fanout::{
    ConnId, FromGateway, GatewayId, HEARTBEAT_INTERVAL_SECS, INBOUND_CHANNEL, ToGateway,
    outbound_channel,
};
use futures::StreamExt;
use macro_user_id::user_id::MacroUserIdStr;
use redis::AsyncCommands;

async fn publish(ctx: &ConnectionContext<'_>, message: &FromGateway) -> Result<()> {
    let payload = postcard::to_stdvec(message).context("failed to encode fanout message")?;
    let mut connection = ctx.api_context.get_multiplexed_async_connection()?;
    connection
        .publish::<&str, &[u8], ()>(INBOUND_CHANNEL, &payload)
        .await
        .context("failed to publish fanout message")?;
    Ok(())
}

/// Log-and-continue wrapper: fanout must never break connection handling.
async fn publish_best_effort(ctx: &ConnectionContext<'_>, message: &FromGateway) {
    publish(ctx, message)
        .await
        .inspect_err(|error| tracing::warn!(error=?error, "failed to publish fanout message"))
        .ok();
}

/// Announce an accepted, authenticated connection.
pub async fn connected(ctx: &ConnectionContext<'_>, user_id: &MacroUserIdStr<'static>) {
    publish_best_effort(
        ctx,
        &FromGateway::Connected {
            gateway: GatewayId(ctx.api_context.fanout_gateway_id.to_string()),
            conn: ConnId(ctx.connection_id.to_string()),
            user_id: user_id.clone(),
        },
    )
    .await;
}

/// Forward one client frame, unparsed.
pub async fn frame(ctx: &ConnectionContext<'_>, text: bool, payload: Vec<u8>) {
    publish_best_effort(
        ctx,
        &FromGateway::Frame {
            gateway: GatewayId(ctx.api_context.fanout_gateway_id.to_string()),
            conn: ConnId(ctx.connection_id.to_string()),
            text,
            payload,
        },
    )
    .await;
}

/// Announce a closed connection.
pub async fn disconnected(ctx: &ConnectionContext<'_>) {
    publish_best_effort(
        ctx,
        &FromGateway::Disconnected {
            gateway: GatewayId(ctx.api_context.fanout_gateway_id.to_string()),
            conn: ConnId(ctx.connection_id.to_string()),
        },
    )
    .await;
}

/// Liveness beacon so consumers can drop state for dead gateway instances.
/// Spawned once at boot.
pub async fn heartbeat_loop(
    redis_connection: redis::aio::MultiplexedConnection,
    gateway_id: std::sync::Arc<str>,
) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(HEARTBEAT_INTERVAL_SECS));
    loop {
        tick.tick().await;
        let message = FromGateway::Heartbeat {
            gateway: GatewayId(gateway_id.to_string()),
        };
        let Ok(payload) = postcard::to_stdvec(&message) else {
            continue;
        };
        let mut connection = redis_connection.clone();
        connection
            .publish::<&str, &[u8], ()>(INBOUND_CHANNEL, &payload)
            .await
            .inspect_err(|error| tracing::warn!(error=?error, "failed to publish fanout heartbeat"))
            .ok();
    }
}

/// Consume this instance's outbound fanout channel: frames published by
/// backend consumers (the sync tier) addressed to connections whose sockets
/// this instance holds. Mirrors [`crate::service::redis::poll_messages`].
pub async fn poll_outbound(ctx: ApiContext) -> Result<()> {
    let gateway_id = GatewayId(ctx.fanout_gateway_id.to_string());
    let channel = outbound_channel(&gateway_id);

    let (mut sink, mut stream) = ctx.redis_client.get_async_pubsub().await?.split();
    sink.subscribe(&channel)
        .await
        .context("failed to subscribe to fanout outbound channel")?;
    tracing::debug!(channel, "subscribed to fanout outbound channel");

    while let Some(message) = stream.next().await {
        let payload: Vec<u8> = match message.get_payload() {
            Ok(payload) => payload,
            Err(error) => {
                tracing::warn!(error = ?error, "unreadable outbound fanout payload; skipping");
                continue;
            }
        };
        match postcard::from_bytes::<ToGateway>(&payload) {
            Ok(ToGateway::Frame {
                conn,
                text: false,
                payload,
            }) => {
                ctx.connection_manager
                    .send_binary(&conn.0, payload)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, conn = %conn, "failed to deliver outbound frame");
                    })
                    .ok();
            }
            Ok(ToGateway::Frame {
                conn, text: true, ..
            }) => {
                // No consumer sends text frames yet; refuse rather than guess
                // at framing for the existing JSON protocol.
                tracing::warn!(conn = %conn, "text outbound frames are not supported; dropping");
            }
            Ok(ToGateway::Close { conn, code }) => {
                // TODO: plumb a real close (with code) through the connection
                // manager; for now drop the connection, which closes the socket.
                tracing::debug!(conn = %conn, code, "closing connection at consumer request");
                ctx.connection_manager
                    .remove_connection(&conn.0)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, conn = %conn, "failed to close connection");
                    })
                    .ok();
            }
            Err(error) => {
                tracing::warn!(error = ?error, "undecodable outbound fanout message; skipping");
            }
        }
    }

    tracing::warn!("fanout outbound poller exited");
    Ok(())
}
