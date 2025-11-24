use models_opensearch::SearchEntityType;

use crate::{
    OpensearchClient, Result,
    delete::name::delete_entity_name,
    upsert::name::{UpsertEntityNameArgs, upsert_entity_name},
};

impl OpensearchClient {
    /// Upserts an entity name into the opensearch index
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_entity_name(&self, args: &UpsertEntityNameArgs) -> Result<()> {
        upsert_entity_name(&self.inner, args).await
    }

    /// Delete entity name
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_entity_name(
        &self,
        entity_id: &str,
        entity_type: &SearchEntityType,
    ) -> Result<()> {
        delete_entity_name(&self.inner, entity_id, entity_type).await
    }
}
