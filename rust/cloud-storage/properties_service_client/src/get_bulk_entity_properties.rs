use crate::{BulkEntityPropertiesResponse, EntityReference, PropertiesServiceClient};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Request body for bulk entity properties endpoint
#[derive(Debug, Serialize, Deserialize)]
pub struct BulkEntityPropertiesRequest {
    pub entities: Vec<EntityReference>,
}

impl PropertiesServiceClient {
    /// Get properties for multiple entities in bulk
    #[tracing::instrument(skip(self))]
    pub async fn get_bulk_entity_properties(
        &self,
        entities: Vec<EntityReference>,
    ) -> Result<BulkEntityPropertiesResponse> {
        let request = BulkEntityPropertiesRequest { entities };

        let response = self
            .client
            .post(format!("{}/internal/properties/entities/bulk", self.url))
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("HTTP {}: {}", status, body);
        }

        let result = response.json::<BulkEntityPropertiesResponse>().await?;
        Ok(result)
    }
}
