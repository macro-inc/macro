use crate::{
    OpensearchClient, Result, delete,
    retry::resend_on_lost_connection,
    upsert::{self, project::UpsertProjectArgs, properties::IndexedProperty},
};

impl OpensearchClient {
    #[tracing::instrument(skip(self, upsert_project_args), fields(project_id=%upsert_project_args.project_id), err)]
    pub async fn upsert_project(
        &self,
        upsert_project_args: &UpsertProjectArgs,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::project::upsert_project(&self.inner, upsert_project_args, index_override)
        })
        .await
    }

    /// Deletes a project from the opensearch projects index
    #[tracing::instrument(skip(self), err)]
    pub async fn delete_project(
        &self,
        project_id: &str,
        index_override: Option<&str>,
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            delete::project::delete_project_by_id(&self.inner, project_id, index_override)
        })
        .await
    }

    /// Updates only the denormalized `properties` on an indexed project
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn update_project_properties(
        &self,
        project_id: &str,
        properties: &[IndexedProperty],
    ) -> Result<()> {
        resend_on_lost_connection(|| {
            upsert::project::update_project_properties(&self.inner, project_id, properties, None)
        })
        .await
    }
}
