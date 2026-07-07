use crate::{
    OpensearchClient, Result, delete,
    upsert::{self, project::UpsertProjectArgs, properties::IndexedProperty},
};

impl OpensearchClient {
    #[tracing::instrument(skip(self, upsert_project_args), fields(project_id=%upsert_project_args.project_id))]
    pub async fn upsert_project(
        &self,
        upsert_project_args: &UpsertProjectArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        upsert::project::upsert_project(&self.inner, upsert_project_args, index_override).await
    }

    /// Deletes a project from the opensearch projects index
    #[tracing::instrument(skip(self))]
    pub async fn delete_project(
        &self,
        project_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        delete::project::delete_project_by_id(&self.inner, project_id, index_override).await
    }

    /// Updates only the denormalized `properties` on an indexed project
    #[tracing::instrument(skip(self, properties))]
    pub async fn update_project_properties(
        &self,
        project_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        upsert::project::update_project_properties(&self.inner, project_id, properties, None).await
    }
}
