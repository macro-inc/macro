use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use fusionauth::error::FusionAuthClientError;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_middleware::tracking::ClientIp;
use model::response::ErrorResponse;
use serde_utils::urlencode::UrlEncoded;
use url::Url;

use crate::api::{
    context::{ApiContext, AuthorizationService},
    oauth2::OAuthState,
};

#[cfg(test)]
mod test;

const MICROSOFT_IDENTITY_PROVIDER_NAME: &str = "microsoft";
const MAX_IN_PROGRESS_LINKS: i64 = 5;

/// Response returned when a Microsoft Outlook link is initiated.
#[derive(Debug, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
pub struct InitOutlookLinkResponse {
    /// The OAuth authorization URL to redirect the user to.
    pub authorization_url: String,
    /// The link ID for tracking the OAuth flow.
    pub link_id: uuid::Uuid,
}

/// Errors that can occur while initiating a Microsoft Outlook link.
#[derive(Debug, thiserror::Error)]
pub enum InitOutlookLinkError {
    /// Too many account-link attempts are already in progress.
    #[error("too many in progress links")]
    TooManyInProgressLinks,
    /// The Microsoft identity provider does not exist in FusionAuth.
    #[error("identity provider not found")]
    IdentityProviderNotFound,
    /// An internal operation failed.
    #[error("internal error occurred")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for InitOutlookLinkError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            Self::TooManyInProgressLinks => StatusCode::TOO_MANY_REQUESTS,
            Self::IdentityProviderNotFound => StatusCode::NOT_FOUND,
            Self::InternalError(error) => {
                tracing::error!(error=?error, "failed to initiate Outlook link");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct InitOutlookLinkQueryParams {
    /// Once the frontend is updated to not double-urlencode this, change this to `Option<Url>`.
    original_url: Option<UrlEncoded<Url>>,
}

/// Initiates a Microsoft Outlook account link for an authenticated user.
#[utoipa::path(
    post,
    operation_id = "init_outlook_link",
    path = "/link/outlook",
    params(
        ("original_url" = Option<String>, Query, description = "**OPTIONAL**. The original URL to redirect to.")
    ),
    responses(
        (status = 200, body = InitOutlookLinkResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, ip_context, authorization), fields(client_ip=%ip_context, user_id=%authorization.authorization.user.user_context.user_id, fusion_user_id=%authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn init_outlook_link_handler(
    State(ctx): State<ApiContext>,
    Query(InitOutlookLinkQueryParams { original_url }): Query<InitOutlookLinkQueryParams>,
    ip_context: ClientIp,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<InitOutlookLinkResponse>, InitOutlookLinkError> {
    let microsoft_idp_id = ctx
        .auth_client
        .get_identity_provider_id_by_name(MICROSOFT_IDENTITY_PROVIDER_NAME)
        .await
        .map_err(map_identity_provider_lookup_error)?;

    let fusion_user_id = &authorization.authorization.user.user_context.fusion_user_id;
    let count =
        macro_db_client::in_progress_user_link::count_existing_in_progress_user_links_for_user(
            &ctx.db,
            fusion_user_id,
        )
        .await?;

    if count >= MAX_IN_PROGRESS_LINKS {
        return Err(InitOutlookLinkError::TooManyInProgressLinks);
    }

    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &ctx.db,
        fusion_user_id,
    )
    .await?;
    let state = OAuthState {
        identity_provider_id: microsoft_idp_id,
        link_id: Some(link_id),
        original_url: original_url.map(|url| url.0.to_string()),
        is_mobile: None,
    };
    let redirect_uri = crate::api::oauth2::format_redirect_uri("microsoft");

    let authorization_url = match ctx
        .auth_client
        .construct_microsoft_authorize_url(&redirect_uri, &state)
    {
        Ok(authorization_url) => authorization_url,
        Err(error) => {
            let _ = macro_db_client::in_progress_user_link::delete_in_progress_user_link(
                &ctx.db, &link_id,
            )
            .await
            .inspect_err(|cleanup_error| {
                tracing::warn!(
                    error=?cleanup_error,
                    %link_id,
                    "failed to clean up pending Outlook link"
                );
            });
            return Err(map_microsoft_oauth_error(error));
        }
    };

    Ok(Json(InitOutlookLinkResponse {
        authorization_url,
        link_id,
    }))
}

fn map_identity_provider_lookup_error(error: FusionAuthClientError) -> InitOutlookLinkError {
    match error {
        FusionAuthClientError::NoIdentityProviderFound => {
            InitOutlookLinkError::IdentityProviderNotFound
        }
        error => InitOutlookLinkError::InternalError(error.into()),
    }
}

fn map_microsoft_oauth_error(error: FusionAuthClientError) -> InitOutlookLinkError {
    InitOutlookLinkError::InternalError(error.into())
}
