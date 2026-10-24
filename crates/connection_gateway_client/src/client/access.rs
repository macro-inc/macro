use super::ConnectionGatewayClient;
use model_entity::EntityType;
use serde::Serialize;

/// The message web clients refresh an entity's shared access on: its lists,
/// search answers and open views (`refreshSharedAccess`).
pub const ACCESS_CHANGED_MESSAGE_TYPE: &str = "access_requests_changed";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessChanged<'a> {
    entity_type: EntityType,
    entity_id: &'a str,
}

impl ConnectionGatewayClient {
    /// Tell users their access to an entity may have changed, so their open
    /// clients show or drop it without a reload. Someone who kept access only
    /// refetches what they already see.
    #[tracing::instrument(skip(self, user_ids), fields(recipients = user_ids.len()), err)]
    pub async fn send_access_changed(
        &self,
        user_ids: &[&str],
        entity_type: EntityType,
        entity_id: &str,
    ) -> anyhow::Result<()> {
        if user_ids.is_empty() {
            return Ok(());
        }
        self.batch_send_message(
            ACCESS_CHANGED_MESSAGE_TYPE.to_string(),
            serde_json::to_value(AccessChanged {
                entity_type,
                entity_id,
            })?,
            user_ids
                .iter()
                .map(|user_id| EntityType::User.with_entity_str(user_id))
                .collect(),
        )
        .await?;
        Ok(())
    }
}
