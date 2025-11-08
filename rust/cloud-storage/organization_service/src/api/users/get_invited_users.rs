use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::context::ApiContext, model::response::user::get_invited_users::GetInvitedUsersResponse,
};

use model::user::UserContext;

/// Gets all invited users for your organization
#[utoipa::path(
        get,
        path = "/users/invited",
        responses(
            (status = 200, body=GetInvitedUsersResponse),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn get_invited_users_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let invited_users = macro_db_client::user::get_invited::get_invited_users_by_organization(
        ctx.db.clone(),
        user_context
            .organization_id
            .expect("organization ID required"),
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to get invited users in organization");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get invited users in organization",
        )
            .into_response()
    })?;

    let response = GetInvitedUsersResponse { invited_users };

    Ok((StatusCode::OK, Json(response)).into_response())
}
