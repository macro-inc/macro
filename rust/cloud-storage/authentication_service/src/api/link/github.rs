use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use github::domain::{models::GithubError, ports::GithubLinkService};
use macro_middleware::tracking::ClientIp;

use crate::api::{context::ApiContext, oauth2::OAuthState};

use model::{response::ErrorResponse, user::UserContext};

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
        let message: &str = &self.to_string();
        let status_code: StatusCode = match &self {
            InitGithubLinkError::InvalidUserId(_) => StatusCode::BAD_REQUEST,
            InitGithubLinkError::TooManyInProgressLinks => StatusCode::TOO_MANY_REQUESTS,
            InitGithubLinkError::InternalError(_)
            | InitGithubLinkError::GithubServiceError(_)
            | InitGithubLinkError::IdentityProviderNotFound => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (status_code, Json(ErrorResponse { message })).into_response()
    }
}

/// Initiates a link for a user
#[utoipa::path(
        post,
        operation_id = "init_github_link",
        path = "/link/github",
        responses(
            (status = 200, body=InitGithubLinkResponse),
            (status = 400, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context, user_id=%user_context.user_id, fusion_user_id=%user_context.fusion_user_id), err)]
pub async fn init_github_link_handler(
    State(ctx): State<ApiContext>,
    ip_context: ClientIp,
    user_context: Extension<UserContext>,
) -> Result<Json<InitGithubLinkResponse>, InitGithubLinkError> {
    // TODO: this should probably be a middleware or extractor
    // Check count of in-progress links
    let count =
        macro_db_client::in_progress_user_link::count_existing_in_progress_user_links_for_user(
            &ctx.db,
            &user_context.fusion_user_id,
        )
        .await?;

    if count >= 5 {
        return Err(InitGithubLinkError::TooManyInProgressLinks);
    }

    // Create in-progress link
    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &ctx.db,
        &user_context.fusion_user_id,
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
        // TODO: support
        original_url: None,
        // TODO: support
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
