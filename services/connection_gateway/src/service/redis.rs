use anyhow::{Context, Result};
use futures::StreamExt;
use redis::{AsyncCommands, FromRedisValue, ParsingError, Value, aio::MultiplexedConnection};
use std::future::Future;
use tracing::Instrument as _;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use crate::{
    context::ApiContext,
    model::message::{Message, record_span_error},
};

#[cfg(test)]
mod test;

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
    connection: MultiplexedConnection,
    message: MessageWithConnection,
) -> Result<()> {
    publish_with_trace(message, |message| async move {
        let mut connection = connection;
        let message_json =
            serde_json::to_string(&message).context("Failed to serialize message")?;

        connection
            .publish::<&str, &str, ()>(REDIS_CHANNEL, message_json.as_str())
            .await
            .context("Failed to publish message")
    })
    .await
}

async fn publish_with_trace<T, F, Fut>(mut message: MessageWithConnection, publish: F) -> Result<T>
where
    F: FnOnce(MessageWithConnection) -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let span = tracing::info_span!(
        "connection_gateway.redis_publish",
        otel.kind = "producer",
        message_type = %message.message.message_type,
        otel.status_code = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
    );
    let result = async move {
        message.message = message.message.with_current_trace_context();
        publish(message).await
    }
    .instrument(span.clone())
    .await;
    if let Err(error) = &result {
        record_span_error(&span, error);
    }
    result
}

async fn dispatch_with_trace<T, F, Fut>(
    mut message: MessageWithConnection,
    dispatch: F,
) -> Result<T>
where
    F: FnOnce(MessageWithConnection) -> Fut,
    Fut: Future<Output = Result<T>>,
{
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

    let result = async move {
        message.message = message.message.with_current_trace_context();
        dispatch(message).await
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
        let message: MessageWithConnection =
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
            tracing::debug!("connection not found on this gateway instance, skipping message");
            continue;
        }

        tracing::trace!("received message from redis, sending to connection");
        let connection_manager = ctx.connection_manager.clone();

        if let Err(err) = dispatch_with_trace(message, |message| async move {
            connection_manager
                .send_message(message.connection_id.as_str(), message.message)
                .await
        })
        .await
        {
            tracing::error!(error=?err, "failed to send message");
        }
    }

    tracing::trace!("poller exited");

    Ok(())
}
