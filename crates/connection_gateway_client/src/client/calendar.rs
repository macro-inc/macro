use super::ConnectionGatewayClient;
use connection_gateway_models::{MessageReceipt, UniqueMessage};
use model_entity::EntityType;

const REFRESH_CALENDAR: &str = "refresh_calendar";

impl ConnectionGatewayClient {
    /// Trigger refresh of the user's calendar views.
    #[tracing::instrument(skip(self, event))]
    pub async fn refresh_calendar(
        &self,
        user_id: &str,
        event: serde_json::Value,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        self.send_message(
            EntityType::User.with_entity_str(user_id),
            REFRESH_CALENDAR.to_string(),
            event,
        )
        .await
    }

    /// Trigger a refresh of several users' calendar views in one request,
    /// each with its own event. User ids hold email addresses, so they stay
    /// out of the span.
    #[tracing::instrument(skip_all, fields(users = i64::try_from(refreshes.len()).unwrap_or(i64::MAX)), err)]
    pub async fn refresh_calendars(
        &self,
        refreshes: Vec<(String, serde_json::Value)>,
    ) -> anyhow::Result<Vec<MessageReceipt>> {
        if refreshes.is_empty() {
            return Ok(vec![]);
        }
        self.batch_send_unique_messages(
            refreshes
                .into_iter()
                .map(|(user_id, event)| UniqueMessage {
                    message_content: event,
                    entity: EntityType::User.with_entity_string(user_id),
                    message_type: REFRESH_CALENDAR.to_string(),
                })
                .collect(),
        )
        .await
    }
}
