use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::{api::context::ApiContext, model::response::user::get_users::GetUsersResponse};
use model::request::pagination::PaginationQueryParams;
use model::user::UserContext;

/// Gets all users currently in your organization
#[utoipa::path(
        get,
        path = "/users",
        params(
            ("limit" = i64, Query, description = "The maximum number of users to retreive. Default 10, max 100."),
            ("offset" = i64, Query, description = "The offset to start from. Default 0."),
        ),
        responses(
            (status = 200, body=GetUsersResponse),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, params), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn get_users_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Query(params): extract::Query<PaginationQueryParams>,
) -> impl IntoResponse {
    if let Some(limit) = params.limit
        && limit > 100
    {
        tracing::warn!(limit=%limit, "exceeded max value for limit");
        return Err((StatusCode::BAD_REQUEST, "limit cannot exceed 100"));
    }

    let limit = params.limit.unwrap_or(10);
    let offset = params.offset.unwrap_or(0);

    let organization_id = match user_context.organization_id {
        Some(org_id) => org_id,
        None => {
            tracing::warn!(user_id=%user_context.user_id, "User is not part of an organization");
            return Err((
                StatusCode::FORBIDDEN,
                "User must be part of an organization to access this endpoint",
            ));
        }
    };

    let (users, total) = macro_db_client::user::get_all::get_users_by_organization(
        ctx.db.clone(),
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

    let response = GetUsersResponse {
        users,
        total,
        next_offset,
    };

    Ok((StatusCode::OK, Json(response)))
}
