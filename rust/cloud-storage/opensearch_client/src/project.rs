use crate::{
    OpensearchClient, Result,
    delete::project::{delete_project_bulk_ids, delete_project_by_id, delete_projects_by_user_id},
    search::{model::SearchHit, projects::{ProjectSearchArgs,search_projects}},
    upsert::project::{UpsertProjectArgs, upsert_project},
};

impl OpensearchClient {
    /// Upserts a project into the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn upsert_project(&self, args: &UpsertProjectArgs) -> Result<()> {
        upsert_project(&self.inner, args).await
    }

    /// Deletes a project from the opensearch project index
    #[tracing::instrument(skip(self))]
    pub async fn delete_project(&self, id: &str) -> Result<()> {
        delete_project_by_id(&self.inner, id).await
    }

    /// Deletes a project from the opensearch project index
    #[tracing::instrument(skip(self))]
    pub async fn delete_project_bulk(&self, ids: &Vec<String>) -> Result<()> {
        delete_project_bulk_ids(&self.inner, ids).await
    }

    /// Searches for projects in the opensearch index
    #[tracing::instrument(skip(self))]
    pub async fn search_project(
        &self,
        args: ProjectSearchArgs,
    ) -> Result<Vec<SearchHit>> {
        search_projects(&self.inner, args).await
    }

    pub async fn delete_projects_by_user_id(&self, user_id: &str) -> Result<()> {
        delete_projects_by_user_id(&self.inner, user_id).await
    }
}
