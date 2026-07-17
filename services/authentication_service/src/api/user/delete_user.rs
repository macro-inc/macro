use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::MacroAuthorizationExtractor;
use tower_cookies::Cookies;

use crate::api::{
    context::{ApiContext, AuthorizationService},
    jwt_session::JwtSessionContext,
    utils::{create_access_token_cookie, create_refresh_token_cookie},
};

use model::response::{ErrorResponse, GenericSuccessResponse};

/// Deletes the user who calls this endpoint
#[utoipa::path(
        delete,
        path = "/user/me",
        operation_id = "delete_user",
        responses(
            (status = 200, body=GenericSuccessResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, authorization, jwt_session, cookies), fields(user_id=%authorization.user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService>,
    JwtSessionContext(jwt_session): JwtSessionContext,
    cookies: Cookies,
) -> Result<Response, Response> {
    let user_context = &authorization.user_context;
    let user_id = &*user_context.user_id;
    // This may seem dumb, but if you delete this account it will delete my fusionauth account and
    // we will then be locked out of fusionauth. So this is a way to prevent any accidental fuck
    // ups from occurring.
    if user_context.user_id == "macro|hutch@macro.com" {
        return Err((StatusCode::FORBIDDEN, "you cannot delete hutch").into_response());
    }
    // Perform a logout for the user
    // Remove access token cookie
    let mut access_token_cookie = create_access_token_cookie("");
    access_token_cookie.set_expires(Some(time::OffsetDateTime::now_utc()));
    cookies.add(access_token_cookie);

    // Remove refresh token cookie
    let mut refresh_token_cookie = create_refresh_token_cookie("");
    refresh_token_cookie.set_expires(Some(time::OffsetDateTime::now_utc()));
    cookies.add(refresh_token_cookie);

    // Logout of fusionauth when the request used a FusionAuth session.
    if let Some(jwt_context) = jwt_session
        && let Err(e) = ctx.auth_client.logout(&jwt_context.tid).await
    {
        tracing::warn!(error=?e, "error logging out");
    }

    let email = user_id.replace("macro|", "");

    // Delete the user from fusionauth
    // This will trigger the delete user webhook to clear out the user's items from the db async
    let fusion_auth_user_id = ctx
        .auth_client
        .get_user_id_by_email(&email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, email, "unable to get user id by email");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    ctx.auth_client
        .delete_user(&fusion_auth_user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, user_id, fusion_auth_user_id, email, "unable to delete user");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        })?;

    Ok((StatusCode::OK, Json(GenericSuccessResponse::default())).into_response())
}
