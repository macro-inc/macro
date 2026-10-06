//! Every user's first database: the Getting started template, given once.

use serde::Serialize;

use super::models::{DatabaseError, DatabaseId, TableId, ViewId, Viewer};

/// Starter result. A missing database means the user already started or removed it.
#[derive(Debug, Clone, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StarterDatabase {
    /// Accessible starter database, if still present.
    #[schema(required = true, value_type = Option<String>)]
    pub database_id: Option<DatabaseId>,
    /// Initial table, returned only on first creation.
    #[schema(required = true, value_type = Option<String>)]
    pub table_id: Option<TableId>,
    /// Initial board view, returned only on first creation.
    #[schema(required = true, value_type = Option<String>)]
    pub view_id: Option<ViewId>,
    /// Whether this request created the example.
    pub created: bool,
}

/// Authenticated-user provisioning capability. No caller-supplied owner or content.
pub trait DatabaseStarterService: Send + Sync + 'static {
    /// Give the acting user the Getting started database, once: never to a
    /// user given one before, even if they removed it, nor to one who has a
    /// database of their own.
    fn ensure_starter(
        &self,
        viewer: Viewer,
    ) -> impl Future<Output = Result<StarterDatabase, DatabaseError>> + Send;
}
