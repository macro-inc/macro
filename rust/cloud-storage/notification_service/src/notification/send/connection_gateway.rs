use connection_gateway_client::model::sender::MessageReceipt;
use model_notifications::NotificationWithRecipient;
use std::collections::HashSet;

/// Sends the notification to all users via connection gateway
/// Returns a list of users who received the notification successfully
pub async fn send_connection_gateway(
    conn_gateway_client: &connection_gateway_client::client::ConnectionGatewayClient,
    notifications: &[NotificationWithRecipient],
) -> anyhow::Result<HashSet<String>> {
    let start_time = std::time::Instant::now();
    let batch_send_results: Vec<MessageReceipt> = {
        #[cfg(not(feature = "connection_gateway"))]
        {
            tracing::info!("bypassing connection gateway");
            user_ids
                .iter()
                .map(|user_id| connection_gateway_client::MessageReceipt {
                    user_id: user_id.to_string(),
                    delivery_count: 0,
                    active: false,
                })
                .collect()
        }
        #[cfg(feature = "connection_gateway")]
        {
            use anyhow::Context;
            let messages = notifications
                .iter()
                .filter_map(|notif| {
                    use connection_gateway_client::model::message::UniqueMessage;
                    use model_entity::EntityType;

                    let message_content = serde_json::to_value(notif)
                        .context("unable to serialize notification")
                        .ok()?;

                    Some(UniqueMessage {
                        message_content,
                        message_type: "notification".to_string(),
                        entity: EntityType::User.with_entity_string(notif.recipient_id.to_string()),
                    })
                })
                .collect();
            conn_gateway_client
                .batch_send_unique_messages(messages)
                .await
                .map_err(|e| {
                    tracing::error!(error=?e, "batch_send_message failed to send notifications");
                    anyhow::anyhow!("unable to send notification to connection gateway")
                })?
        }
    };
    tracing::debug!(time_elapsed=?start_time.elapsed(), batch_send_results=?batch_send_results, "batch_send_message results");

    // Users that were sent the notification via connection gateway
    // A user is considered sent if they have received a delivery count > 0 and they are shown as
    // active.
    let users_sent_connection_gateway = batch_send_results
        .iter()
        .filter_map(|r| {
            if r.delivery_count != 0 && r.active {
                Some(r.user_id.clone())
            } else {
                None
            }
        })
        .collect::<HashSet<String>>();

    Ok(users_sent_connection_gateway)
}
