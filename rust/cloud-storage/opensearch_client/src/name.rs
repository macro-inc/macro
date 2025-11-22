use crate::{
    OpensearchClient, Result,
    upsert::name::{UpsertEntityNameArgs, upsert_entity_name},
};

impl OpensearchClient {
    /// Upserts an entity name into the opensearch index
    #[tracing::instrument(skip(self), err)]
    pub async fn upsert_entity_name(&self, args: &UpsertEntityNameArgs) -> Result<()> {
        upsert_entity_name(&self.inner, args).await
    }
}
