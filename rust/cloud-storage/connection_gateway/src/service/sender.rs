use super::redis::post_message;
use crate::config::Config;
use crate::constants::DEFAULT_TIMEOUT_THRESHOLD;
use crate::context::ApiContext;
use crate::model::connection::StoredConnectionEntity;
use crate::model::message::Message;
use crate::model::sender::MessageReceipt;
use crate::service::redis::MessageWithConnection;
use anyhow::Result;
use futures::future::try_join_all;
use model_entity::Entity;
use std::collections::HashMap;
use std::time::Instant;

pub struct Delivery {
    pub user_id: String,
    pub active: bool,
}

#[tracing::instrument(skip(ctx))]
pub async fn send_message_to_entity<Ctx>(
    ctx: Ctx,
    entity: &Entity<'_>,
    message: Message,
) -> Result<Vec<MessageReceipt>>
where
    Ctx: AsRef<ApiContext> + AsRef<Config> + Copy,
{
    tracing::trace!("sending message to entity");
    let api_context: &ApiContext = ctx.as_ref();
    let redis_connection = api_context.get_multiplexed_tokio_connection().await?;

    let instant = Instant::now();
    let connections = api_context
        .connection_manager
        .get_entries_by_entity(entity)
        .await?;

    tracing::trace!(
        "fetched {} connections in {:?}",
        connections.len(),
        instant.elapsed()
    );

    tracing::trace!("sending message to {} connections", connections.len());

    let instant = Instant::now();

    let local_connections: Vec<&StoredConnectionEntity> = connections
        .iter()
        .filter(|c| {
            api_context
                .connection_manager
                .has_connection(&c.connection_id)
        })
        .collect();

    let remote_connections: Vec<&StoredConnectionEntity> = connections
        .iter()
        .filter(|c| {
            !api_context
                .connection_manager
                .has_connection(&c.connection_id)
        })
        .collect();

    let local_send_futures = local_connections.into_iter().map(|connection| {
        let message = message.clone();

        async move {
            let instant = Instant::now();
            let active = api_context
                .connection_manager
                .send_message(connection.connection_id.as_str(), message.clone())
                .await
                .is_ok()
                && connection.is_active_in_threshold(Some(DEFAULT_TIMEOUT_THRESHOLD));

            tracing::trace!(
                "sent message to connection directly in {:?}",
                instant.elapsed()
            );

            let delivery = Delivery {
                user_id: connection.user_id.clone(),
                active,
            };

            Ok::<Delivery, anyhow::Error>(delivery)
        }
    });

    let remote_send_futures = remote_connections.into_iter().map(|connection| {
        let message = message.clone();
        let redis_connection = redis_connection.clone();
        async move {
            let instant = Instant::now();
            let active = connection.is_active_in_threshold(Some(DEFAULT_TIMEOUT_THRESHOLD));

            post_message(
                redis_connection,
                MessageWithConnection {
                    message: message.clone(),
                    connection_id: connection.connection_id.clone(),
                },
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to publish message to redis");
            })?;

            tracing::trace!(
                "sent message to connection through redis in {:?}",
                instant.elapsed()
            );

            let delivery = Delivery {
                user_id: connection.user_id.clone(),
                active,
            };

            Ok::<Delivery, anyhow::Error>(delivery)
        }
    });

    let local_results = try_join_all(local_send_futures).await.unwrap_or_default();
    let remote_results = try_join_all(remote_send_futures).await.unwrap_or_default();

    let mut receipts: HashMap<String, MessageReceipt> = HashMap::new();

    for delivery in local_results.into_iter().chain(remote_results.into_iter()) {
        if let Some(receipt) = receipts.get_mut(&delivery.user_id) {
            receipt.delivery_count += 1;
            receipt.active = receipt.active || delivery.active;
        } else {
            receipts.insert(
                delivery.user_id.clone(),
                MessageReceipt {
                    user_id: delivery.user_id,
                    delivery_count: 1,
                    active: delivery.active,
                },
            );
        }
    }

    tracing::trace!("sent message to connections in {:?}", instant.elapsed());

    Ok(receipts.into_values().collect())
}
