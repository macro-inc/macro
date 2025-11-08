use crate::PropertiesServiceClient;
use anyhow::Result;
use models_properties::EntityType;

impl PropertiesServiceClient {
    /// Delete all properties for an entity
    #[tracing::instrument(skip(self))]
    pub async fn delete_entity(&self, entity_id: &str, entity_type: EntityType) -> Result<()> {
        let response = self
            .client
            .delete(format!(
                "{}/internal/properties/{}/entities/{}",
                self.url, entity_type, entity_id
            ))
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("HTTP {}: {}", status, body);
        }

        Ok(())
    }
}
