//! Duplicate transport: a copy of a database the caller can see, owned by
//! the caller.

use super::*;

/// Request body for duplicating a database.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateDatabaseRequest {
    /// The copy's name; left out, "<name> copy".
    #[serde(default)]
    pub name: Option<String>,
}

/// Copy a database, with its tables, columns, views and rows, into a new one
/// the caller owns. Its sharing, forms, webhooks and history stay behind.
#[utoipa::path(post, tag = "databases", operation_id = "duplicate_database",
    path = "/databases/{id}/duplicate", params(("id" = Uuid, Path)),
    request_body = DuplicateDatabaseRequest,
    responses((status = 201, body = Database), (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 500, body = ErrorResponse)))]
#[tracing::instrument(err, skip_all, fields(acting_bot = tracing::field::Empty))]
pub async fn duplicate_database_handler<Service, EntityAccess, Authorization>(
    access: DatabaseAccessLevelExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    State(state): State<DatabasesRouterState<Service, EntityAccess, Authorization>>,
    user: MacroAuthorizationExtractor<Authorization, UserOrInternal>,
    Json(request): Json<DuplicateDatabaseRequest>,
) -> Result<(StatusCode, Json<Database>), DatabaseError>
where
    Service: DatabasesService + DatabaseDuplicateService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let acting_bot = agent_attribution(&user);
    let copy = state
        .service
        .duplicate_database(
            access.entity_access_receipt,
            viewer_of(&user).user_id,
            acting_bot,
            request.name,
        )
        .await?;
    Ok((StatusCode::CREATED, Json(copy)))
}
