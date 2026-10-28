//! GraphQL folders reader backed by the projects domain service.

use std::sync::Arc;

use async_graphql::async_trait::async_trait;
use chrono::{TimeZone, Utc};
use graphql_soup::{FoldersQueryError, FoldersQueryReader};
use macro_user_id::user_id::MacroUserIdStr;
use model::project::Project;
use models_soup::project::SoupProject;
use projects_hex::domain::ports::ProjectService;
use uuid::Uuid;

use crate::api::context::ProjectService as DssProjectService;

/// Adapts [`ProjectService::list_accessible_projects`] into Soup projects for GraphQL.
#[derive(Clone)]
pub(crate) struct DssFoldersQueryReader(pub Arc<DssProjectService>);

#[async_trait]
impl FoldersQueryReader for DssFoldersQueryReader {
    async fn list_folders<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
    ) -> Result<Vec<SoupProject<()>>, FoldersQueryError> {
        let projects = self
            .0
            .list_accessible_projects(user_id.clone())
            .await
            .map_err(|error| FoldersQueryError::Internal(anyhow::Error::from(error)))?;

        Ok(projects
            .into_iter()
            .filter_map(|project| match project_to_soup(project) {
                Ok(project) => Some(project),
                Err(error) => {
                    tracing::error!(error = %error, "skipping inaccessible folder shape");
                    None
                }
            })
            .collect())
    }
}

fn project_to_soup(project: Project) -> Result<SoupProject<()>, String> {
    let id = Uuid::parse_str(&project.id).map_err(|error| error.to_string())?;
    let parent_id = project
        .parent_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|error| error.to_string())?;

    Ok(SoupProject {
        id,
        name: project.name,
        owner_id: project.user_id,
        parent_id,
        created_at: project
            .created_at
            .unwrap_or_else(|| Utc.timestamp_opt(0, 0).unwrap()),
        updated_at: project
            .updated_at
            .unwrap_or_else(|| Utc.timestamp_opt(0, 0).unwrap()),
        viewed_at: None,
        deleted_at: project.deleted_at,
        extra: (),
    })
}
