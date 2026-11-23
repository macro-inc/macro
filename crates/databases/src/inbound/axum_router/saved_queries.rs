use super::*;
use crate::domain::models::{QueryId, SavedQuery};

/// Path params for the saved-query routes.
#[derive(Debug, Deserialize)]
pub struct QueryPath {
    /// Saved query id.
    pub query_id: QueryId,
}

/// A saved query's definition, for its creator or a viewer of its database.
#[utoipa::path(
    get,
    tag = "databases",
    operation_id = "get_database_query",
    path = "/databases/queries/{query_id}",
    params(("query_id" = Uuid, Path, description = "Saved query id")),
    responses(
        (status = 200, body = SavedQuery),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, description = "Missing, or not readable by the caller", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err(level = Level::INFO), skip_all)]
pub async fn get_query_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Path(QueryPath { query_id }): Path<QueryPath>,
) -> Result<Json<SavedQuery>, SavedQueryError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    state
        .service
        .get_query(viewer_of(&user), query_id)
        .await
        .map(Json)
}
