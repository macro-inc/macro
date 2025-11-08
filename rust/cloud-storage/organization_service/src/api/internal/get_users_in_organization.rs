use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
};
use macro_middleware::auth::internal_access::ValidInternalKey;

use crate::{api::context::ApiContext, model::response::user::get_users::GetUsersInternalResponse};
use model::request::pagination::PaginationQueryParams;

#[derive(serde::Deserialize)]
pub struct Params {
    pub organization_id: i32,
}

#[utoipa::path(
    get,
    path = "/internal/organization/{organization_id}/users",
    operation_id = "get_users_in_organization",
    params(
        ("organization_id" = i32, Path, description = "The organization id")
    ),
    responses(
        (status = 200, body=GetUsersInternalResponse),
        (status = 401, body=String),
        (status = 400, body=String),
        (status = 500, body=String),
    )
)]
#[tracing::instrument(skip(ctx, params))]
pub async fn handler(
    _access: ValidInternalKey,
    State(ctx): State<ApiContext>,
    Path(Params { organization_id }): Path<Params>,
    Query(params): Query<PaginationQueryParams>,
) -> impl IntoResponse {
    if let Some(limit) = params.limit
        && limit > 100
    {
        tracing::warn!(limit=%limit, "exceeded max value for limit");
        return Err((StatusCode::BAD_REQUEST, "limit cannot exceed 100"));
    }

    let limit = params.limit.unwrap_or(10);
    let offset = params.offset.unwrap_or(0);

    let (users, total) = macro_db_client::user::get_all::get_user_ids_by_organization(
        &ctx.db,
        organization_id,
        limit,
        offset,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get users in organization");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get users in organization",
        )
    })?;

    // Only include the next offset if there are more users to fetch
    let next_offset = if offset + limit < total {
        Some(offset + limit)
    } else {
        None
    };

    let response = GetUsersInternalResponse {
        users,
        total,
        next_offset,
    };

    Ok((StatusCode::OK, Json(response)))
}
