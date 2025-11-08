use axum::{
    Extension, Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{
    api::context::ApiContext,
    model::{request::invite_user::InviteUserRequest, response::EmptyResponse},
};

use model::user::UserContext;

/// Removes the users invitation from OrganizationInvitation
///
/// If the user is `allow_list_only` we will also remove the `OrganizationEmailMatch`
#[utoipa::path(
        delete,
        path = "/users/invite",
        responses(
            (status = 200),
            (status = 401, body=String),
            (status = 400, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id))]
pub async fn revoke_user_invite_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    extract::Json(req): extract::Json<InviteUserRequest>,
) -> Result<Response, Response> {
    macro_db_client::organization::remove::organization_invitation::revoke_organization_invitation_for_user(
        ctx.db.clone(),
        user_context.organization_id.expect("organization ID required"),
        &req.email,
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to revoke organization invitation");
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
