use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use github::domain::{models::GithubError, ports::GithubLinkService};
use macro_middleware::tracking::ClientIp;
use model_user::axum_extractor::MacroUserExtractor;
use serde_utils::urlencode::UrlEncoded;
use url::Url;

use crate::api::{context::ApiContext, oauth2::OAuthState};

use model::response::{EmptyResponse, ErrorResponse};

#[derive(serde::Deserialize, serde::Serialize, Debug, utoipa::ToSchema)]
pub struct InitGithubLinkResponse {
    /// The OAuth authorization URL to redirect the user to
    pub authorization_url: String,
    /// The link ID for tracking the OAuth flow
    pub link_id: uuid::Uuid,
}

/// Error type for init Github operations
#[derive(thiserror::Error, Debug)]
pub enum InitGithubLinkError {
    /// Invalid user ID format
    #[error("invalid user ID format")]
    InvalidUserId(#[from] uuid::Error),
    /// Too many in-progress links
    #[error("too many in progress links")]
    TooManyInProgressLinks,
    /// Internal error
    #[error("internal error occurred")]
    InternalError(#[from] anyhow::Error),
    /// Internal github error
    #[error("internal error occurred")]
    GithubServiceError(#[from] GithubError),
    /// The identity provider was not found
    #[error("identity provider not found")]
    IdentityProviderNotFound,
}

impl IntoResponse for InitGithubLinkError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let status_code: StatusCode = match &self {
            InitGithubLinkError::InvalidUserId(_) => StatusCode::BAD_REQUEST,
            InitGithubLinkError::TooManyInProgressLinks => StatusCode::TOO_MANY_REQUESTS,
            InitGithubLinkError::InternalError(_)
            | InitGithubLinkError::GithubServiceError(_)
            | InitGithubLinkError::IdentityProviderNotFound => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct InitGithubLinkQueryParams {
    /// Once the frontend is update to NOT 2x urlencode this then this should be changed to
    /// `Option<Url>`
    original_url: Option<UrlEncoded<Url>>,
}

/// Initiates a link for a user
#[utoipa::path(
        post,
        operation_id = "init_github_link",
        path = "/link/github",
        params(
            ("original_url" = String, Query, description = "**OPTIONAL**. The original url to redirect to.")
        ),
        responses(
            (status = 200, body=InitGithubLinkResponse),
            (status = 400, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context, user_id=%user_context.user_context.user_id, fusion_user_id=%user_context.user_context.fusion_user_id), err)]
pub async fn init_github_link_handler(
    State(ctx): State<ApiContext>,
    query: Query<InitGithubLinkQueryParams>,
    ip_context: ClientIp,
    user_context: MacroUserExtractor,
) -> Result<Json<InitGithubLinkResponse>, InitGithubLinkError> {
    let Query(InitGithubLinkQueryParams { original_url }) = query;
    // TODO: this should probably be a middleware or extractor
    // Check count of in-progress links
    let count =
        macro_db_client::in_progress_user_link::count_existing_in_progress_user_links_for_user(
            &ctx.db,
            &user_context.user_context.fusion_user_id,
        )
        .await?;

    if count >= 5 {
        return Err(InitGithubLinkError::TooManyInProgressLinks);
    }

    // Create in-progress link
    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &ctx.db,
        &user_context.user_context.fusion_user_id,
    )
    .await?;

    // Get Github integration identity provider ID from context
    let github_idp_id = &ctx
        .auth_client
        .get_identity_provider_id_by_name("github")
        .await
        .map_err(|_| InitGithubLinkError::IdentityProviderNotFound)?;

    // Build OAuth state
    let state = OAuthState {
        identity_provider_id: github_idp_id.clone(),
        link_id: Some(link_id),
        original_url: original_url.map(|x| x.0.to_string()),
        is_mobile: None,
    };

    // Build Github OAuth URL
    let redirect_uri = crate::api::oauth2::format_redirect_uri("github");

    let authorization_url = ctx
        .github_link_service
        .construct_oauth_url(&redirect_uri, state)
        .map_err(InitGithubLinkError::GithubServiceError)?;

    Ok(Json(InitGithubLinkResponse {
        authorization_url,
        link_id,
    }))
}

/// Error type for delete Github link operations
#[derive(thiserror::Error, Debug)]
pub enum DeleteGithubLinkError {
    /// Internal error
    #[error("internal error occurred")]
    InternalError(#[from] anyhow::Error),
    /// Internal github error
    #[error("internal error occurred")]
    GithubServiceError(#[from] GithubError),
}

impl IntoResponse for DeleteGithubLinkError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let status_code: StatusCode = match &self {
            DeleteGithubLinkError::InternalError(_)
            | DeleteGithubLinkError::GithubServiceError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

/// Deletes a github link for a user
#[utoipa::path(
        delete,
        operation_id = "delete_github_link",
        path = "/link/github",
        responses(
            (status = 200, body=EmptyResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context, user_id=%user_context.macro_user_id), err)]
pub async fn delete_github_link_handler(
    State(ctx): State<ApiContext>,
    ip_context: ClientIp,
    user_context: MacroUserExtractor,
) -> Result<Json<EmptyResponse>, DeleteGithubLinkError> {
    ctx.github_link_service
        .delete_user_link(&user_context.macro_user_id)
        .await?;

    Ok(Json(EmptyResponse::default()))
}
