use anyhow::{Context, Result};
use futures::StreamExt;
use redis::{AsyncCommands, FromRedisValue, ParsingError, Value, aio::MultiplexedConnection};
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use crate::{
    context::ApiContext,
    model::message::{Message, record_span_error},
};

pub const REDIS_CHANNEL: &str = "connection_gateway.messages";

#[derive(serde::Serialize, serde::Deserialize)]
pub struct MessageWithConnection {
    pub message: Message,
    pub connection_id: String,
}

/// Post's a given message to a specific entity to the redis channel
///
/// Redis will broadcast this message to all replicas of the connection gateway
/// The instance of the connection gateway that holds a handle to the connection
/// will handle sending the message to the client correctly.
pub async fn post_message(
    mut connection: MultiplexedConnection,
    mut message: MessageWithConnection,
) -> Result<()> {
    let span = tracing::info_span!(
        "connection_gateway.redis_publish",
        otel.kind = "producer",
        message_type = %message.message.message_type,
        otel.status_code = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    );
    let result = async {
        message.message = message.message.with_current_trace_context();
        let message_json =
            serde_json::to_string(&message).context("Failed to serialize message")?;

        connection
            .publish::<&str, &str, ()>(REDIS_CHANNEL, message_json.as_str())
            .await
            .context("Failed to publish message")
    }
    .instrument(span.clone())
    .await;
    if let Err(error) = &result {
        record_span_error(&span, error);
    }
    result
}

impl FromRedisValue for MessageWithConnection {
    fn from_redis_value(v: redis::Value) -> Result<Self, ParsingError> {
        match v {
            Value::BulkString(bytes) => serde_json::from_slice::<MessageWithConnection>(&bytes)
                .map_err(|e| ParsingError::from(e.to_string())),
            _ => Err(ParsingError::from("Invalid data type")),
        }
    }
}

/// Polls redis for messages and forwards them to the connection requested
///
/// Redis will broadcast requests for message sending to all instances of the `connection_gateway`
/// If this instance has the connection_id handle to the connection, then it will send the message
pub async fn poll_messages(ctx: ApiContext) -> Result<()> {
    tracing::trace!("started polling redis messages");

    let (mut sink, mut stream) = ctx.redis_client.get_async_pubsub().await?.split();

    sink.subscribe(REDIS_CHANNEL)
        .await
        .context("Failed to subscribe to reddis channel")?;

    while let Some(maybe_message) = stream.next().await {
        let mut message: MessageWithConnection =
            match maybe_message.get_payload::<MessageWithConnection>() {
                Ok(msg) => msg,
                Err(err) => {
                    tracing::error!(error=?err, "failed to parse message");
                    continue;
                }
            };

        if !ctx
            .connection_manager
            .has_connection(&message.connection_id)
        {
            tracing::debug!(
                "connection id {} not found, skipping message",
                message.connection_id
            );
            continue;
        }

        tracing::trace!(
            connection_id = message.connection_id,
            "received message from redis, sending to connection"
        );
        let span = tracing::info_span!(
            "connection_gateway.redis_dispatch",
            otel.kind = "consumer",
            message_type = %message.message.message_type,
            otel.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        if let Some(parent) = message.message.remote_trace_context() {
            let _ = span.set_parent(parent);
        }
        let result = async {
            message.message = message.message.with_current_trace_context();
            ctx.connection_manager
                .send_message(message.connection_id.as_str(), message.message)
                .await
        }
        .instrument(span.clone())
        .await;
        if let Err(err) = result {
            record_span_error(&span, &err);
            tracing::error!(error=?err, "failed to send message");
        }
    }

    tracing::trace!("poller exited");

    Ok(())
}
