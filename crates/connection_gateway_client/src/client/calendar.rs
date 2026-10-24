use super::ConnectionGatewayClient;
use connection_gateway_models::MessageReceipt;
use model_entity::EntityType;

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
            "refresh_calendar".to_string(),
            event,
        )
        .await
    }

    /// Tell users a calendar event they could see through a channel share is
    /// no longer visible to them.
    pub async fn calendar_event_access_changed(
        &self,
        user_ids: &[&str],
        event_id: &str,
    ) -> anyhow::Result<()> {
        self.send_access_changed(user_ids, EntityType::CalendarEvent, event_id)
            .await
    }
}
