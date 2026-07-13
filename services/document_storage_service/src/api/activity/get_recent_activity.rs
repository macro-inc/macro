#![allow(
    deprecated,
    reason = "allow GetActivitiesResponse & UserActivitiesResponse and mark get_recent_activity_handler for utoipa"
)]
use axum::{
    Extension,
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
};

use crate::{
    api::context::ApiContext,
    model::response::activity::{GetActivitiesResponse, UserActivitiesResponse},
};
use model::{
    request::pagination::{Pagination, PaginationQueryParams},
    response::{GenericErrorResponse, GenericResponse},
    user::UserContext,
};

/// Gets the users recent activities
#[utoipa::path(
        get,
        path = "/activity",
        params(
            ("limit" = i64, Query, description = "The maximum number of items to retreive. Default 10, max 100."),
            ("offset" = i64, Query, description = "The offset to start from. Default 0."),
        ),
        responses(
            (status = 200, body=GetActivitiesResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, pagination_query), fields(user_id=?user_context.user_id))]
#[deprecated]
pub async fn get_recent_activity_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Query(pagination_query): Query<PaginationQueryParams>,
) -> impl IntoResponse {
    if let Some(limit) = pagination_query.limit
        && limit > 100
    {
        tracing::warn!("exceeded max value for limit on activity limit={}", limit);
        return GenericResponse::builder()
            .message("limit must be less than or equal to 100")
            .is_error(true)
            .send(StatusCode::BAD_REQUEST);
    }

    // Create the  pagination object from the query parameters
    let pagination = Pagination::from_query_params(pagination_query);

    let result = match macro_db_client::activity::get_recent_activities(
        ctx.db.clone(),
        user_context.user_id.as_str(),
        pagination.limit,
        pagination.offset,
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            tracing::error!(error=?e, "error getting recent activities");
            return GenericResponse::builder()
                .message("error getting recent activity")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    // Only include the next offset if there are more documents to fetch
    let next_offset = if pagination.offset + pagination.limit < result.1 {
        Some(pagination.offset + pagination.limit)
    } else {
        None
    };

    let response_data = UserActivitiesResponse {
        recent: result.0,
        total: result.1,
        next_offset,
    };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
