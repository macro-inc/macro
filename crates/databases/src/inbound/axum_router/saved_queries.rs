use super::*;
use crate::domain::models::{QueryDefinition, QueryId, SavedQuery};

/// Request body for saving a query.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryRequest {
    /// What the query asks: `{"version": 1, "query": "<SELECT>"}`.
    pub definition: QueryDefinition,
    /// The database whose tables win name resolution. The caller must be
    /// able to see it.
    #[serde(default)]
    #[schema(nullable = false, value_type = Option<Uuid>)]
    pub database_id: Option<DatabaseId>,
}

/// Path params for the saved-query routes.
#[derive(Debug, Deserialize)]
pub struct QueryPath {
    /// Saved query id.
    pub query_id: QueryId,
}

/// Save an immutable query. Editing a question saves a new one.
#[utoipa::path(
    post,
    tag = "databases",
    operation_id = "save_database_query",
    path = "/databases/queries",
    request_body = SaveQueryRequest,
    responses(
        (status = 201, body = SavedQuery),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, description = "The database is missing or not visible", body = ErrorResponse),
        (status = 422, description = "The query is too long", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn save_query_handler<Service, EntityAccess, Authorization>(
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<SaveQueryRequest>,
) -> Result<(StatusCode, Json<SavedQuery>), SavedQueryError>
where
    Service: DatabasesService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let saved = state
        .service
        .save_query(viewer_of(&user), request.database_id, request.definition)
        .await?;
    Ok((StatusCode::CREATED, Json(saved)))
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
#[tracing::instrument(err, skip_all)]
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
