//! User-scoped accessible folders query for the Drive sidebar.

use std::sync::Arc;

use async_graphql::Context;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::{item::SoupItem, project::SoupProject};

use crate::objects::{GraphqlSoupEntity, GraphqlSoupProject, SoupEntityEdges};

/// Error returned while listing accessible folders for GraphQL.
#[derive(Debug, thiserror::Error)]
pub enum FoldersQueryError {
    /// Underlying domain/storage failure.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

/// Lists non-deleted projects the authenticated user can access.
#[async_trait]
pub trait FoldersQueryReader: Send + Sync {
    /// Return accessible folders (projects), newest `updatedAt` first.
    async fn list_folders<'a>(
        &'a self,
        user_id: &'a MacroUserIdStr<'static>,
    ) -> Result<Vec<SoupProject<()>>, FoldersQueryError>;
}

/// Request-scoped folders reader inserted into GraphQL context by the host.
#[derive(Clone)]
pub struct FoldersQuery(Arc<dyn FoldersQueryReader>);

impl FoldersQuery {
    /// Wrap any folders reader for GraphQL request data.
    pub fn new(reader: impl FoldersQueryReader + 'static) -> Self {
        Self(Arc::new(reader))
    }

    /// Empty folders list used by SDL export and schema-only tests.
    pub fn noop() -> Self {
        Self::new(NoOpFoldersQueryReader)
    }
}

/// No-op folders reader that always returns an empty list.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpFoldersQueryReader;

#[async_trait]
impl FoldersQueryReader for NoOpFoldersQueryReader {
    async fn list_folders<'a>(
        &'a self,
        _user_id: &'a MacroUserIdStr<'static>,
    ) -> Result<Vec<SoupProject<()>>, FoldersQueryError> {
        Ok(Vec::new())
    }
}

/// Resolve `user.folders` from GraphQL request data.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_folders<E>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
) -> async_graphql::Result<Vec<GraphqlSoupProject<E>>>
where
    E: SoupEntityEdges,
{
    let FoldersQuery(reader) = ctx.data::<FoldersQuery>().map_err(|error| {
        tracing::error!(error = ?error, "folders query reader missing from GraphQL context");
        async_graphql::Error::new("folders are unavailable")
    })?;

    let projects = reader.list_folders(user_id).await.map_err(|error| {
        tracing::error!(
            error = ?error,
            user_id = %user_id,
            "failed to load authenticated user's folders"
        );
        async_graphql::Error::new("folders are unavailable")
    })?;

    Ok(projects
        .into_iter()
        .map(
            |project| match GraphqlSoupEntity::new(SoupItem::Project(project)) {
                GraphqlSoupEntity::Project(project) => project,
                _ => unreachable!("SoupItem::Project must map to GraphqlSoupEntity::Project"),
            },
        )
        .collect())
}
