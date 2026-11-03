use axum::{
    Json,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use github::domain::{models::GithubError, ports::GithubLinkService};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserId};
use model::authentication::github_token::GithubAccessToken;
use model::response::ErrorResponse;

use crate::api::context::{ApiContext, AuthorizationService};

#[derive(serde::Deserialize, Debug)]
pub struct GithubAccessTokenParams {
    macro_user_id: String,
}

/// The user's GitHub token from their account link: 404 when they never
/// linked, 428 when the token no longer works and they must link again.
#[tracing::instrument(skip(ctx, _internal_authorization))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _internal_authorization: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Query(params): extract::Query<GithubAccessTokenParams>,
) -> Response {
    let Ok(user_id) = MacroUserId::parse_from_str(&params.macro_user_id.to_lowercase())
        .map(|id| id.into_owned().lowercase())
    else {
        return error_response(StatusCode::BAD_REQUEST, "invalid macro user id");
    };

    match ctx
        .github_link_service
        .get_user_access_token(&user_id)
        .await
    {
        Ok(token) => Json(GithubAccessToken {
            access_token: token.as_str().to_owned(),
        })
        .into_response(),
        Err(GithubError::NoLinkFound) => {
            error_response(StatusCode::NOT_FOUND, "no github link found")
        }
        Err(GithubError::ReauthenticationRequired) => error_response(
            StatusCode::PRECONDITION_REQUIRED,
            "github reauthentication required",
        ),
        Err(error) => {
            tracing::error!(error=?error, "failed to read github access token");
            error_response(StatusCode::INTERNAL_SERVER_ERROR, "internal error")
        }
    }
}

fn error_response(status_code: StatusCode, message: &'static str) -> Response {
    (
        status_code,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
