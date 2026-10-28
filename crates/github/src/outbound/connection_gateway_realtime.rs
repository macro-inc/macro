//! Forward saved PR entities through the connection gateway.
//!
//! Paired with `apps/web/src/lib/queries/storage/pr-mention-sync.ts`.
//! `github_pull_request_updated` carries the same camelCase ForeignEntity as GET.

use crate::domain::{models::GithubError, ports::GithubSyncRealtime};
use connection_gateway_client::ConnectionGatewayClient;
use foreign_entity::domain::models::ForeignEntity;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

/// Connection gateway publisher for saved GitHub PR mappings.
pub struct ConnectionGatewayGithubRealtime {
    client: ConnectionGatewayClient,
}

impl ConnectionGatewayGithubRealtime {
    /// Create a publisher using the shared gateway client.
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl GithubSyncRealtime for ConnectionGatewayGithubRealtime {
    #[tracing::instrument(skip(self, recipients, entity), err)]
    async fn publish_pull_request(
        &self,
        recipients: &[MacroUserIdStr<'static>],
        entity: &ForeignEntity,
    ) -> Result<(), GithubError> {
        let message =
            serde_json::to_value(entity).map_err(|error| GithubError::Internal(error.into()))?;
        self.client
            .batch_send_message(
                "github_pull_request_updated".to_string(),
                message,
                recipients
                    .iter()
                    .map(|user| EntityType::User.with_entity_str(user.as_ref()))
                    .collect(),
            )
            .await
            .map_err(GithubError::Internal)?;
        Ok(())
    }
}
