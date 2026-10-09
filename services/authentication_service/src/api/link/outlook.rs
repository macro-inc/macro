use crate::domain::microsoft::MicrosoftAuthError;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_middleware::tracking::ClientIp;
use model::response::ErrorResponse;
use serde_utils::urlencode::UrlEncoded;
use url::Url;

use crate::api::{
    context::{ApiContext, AuthorizationService},
    oauth2::format_redirect_uri,
};

#[cfg(test)]
mod test;

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
    #[error("a professional subscription is required to link an additional inbox")]
    PaymentRequired,
    #[error("invalid return URL")]
    InvalidReturnUrl,
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
            Self::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            Self::InvalidReturnUrl => StatusCode::BAD_REQUEST,
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
    reconnect_link_id: Option<uuid::Uuid>,
    /// Once the frontend is updated to not double-urlencode this, change this to `Option<Url>`.
    original_url: Option<UrlEncoded<Url>>,
    #[serde(default)]
    scopes: OutlookConsentScopes,
}

#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum OutlookConsentScopes {
    #[default]
    Mail,
    MailAndCalendar,
}

/// Initiates a Microsoft Outlook account link for an authenticated user.
#[utoipa::path(
    post,
    operation_id = "init_outlook_link",
    path = "/link/outlook",
    params(
        ("original_url" = Option<String>, Query, description = "**OPTIONAL**. The original URL to redirect to."),
        ("scopes" = Option<String>, Query, description = "mail (default) or mail_and_calendar. Calendar requests obey the deployment calendar consent switch."),
        ("reconnect_link_id" = Option<uuid::Uuid>, Query, description = "Existing accessible inbox being reconnected or granted calendar consent.")
    ),
    responses(
        (status = 200, body = InitOutlookLinkResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 402, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, ip_context, authorization), fields(client_ip=%ip_context, user_id=%authorization.authorization.user.user_context.user_id, fusion_user_id=%authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn init_outlook_link_handler(
    State(ctx): State<ApiContext>,
    Query(InitOutlookLinkQueryParams {
        original_url,
        scopes,
        reconnect_link_id,
    }): Query<InitOutlookLinkQueryParams>,
    ip_context: ClientIp,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Json<InitOutlookLinkResponse>, InitOutlookLinkError> {
    let service = ctx
        .microsoft_auth
        .as_ref()
        .ok_or(InitOutlookLinkError::IdentityProviderNotFound)?;
    let original_url = original_url.map(|url| url.0);
    if original_url
        .as_ref()
        .is_some_and(|url| !crate::api::login::sso::is_allowed_original_url(url))
    {
        return Err(InitOutlookLinkError::InvalidReturnUrl);
    }
    let owner =
        uuid::Uuid::parse_str(&authorization.authorization.user.user_context.fusion_user_id)
            .map_err(|error| InitOutlookLinkError::InternalError(error.into()))?;
    let started = service
        .start_link(
            owner,
            format_redirect_uri("microsoft"),
            original_url.map(String::from),
            ctx.calendar_scope_enabled && matches!(scopes, OutlookConsentScopes::MailAndCalendar),
            reconnect_link_id,
        )
        .await
        .map_err(map_domain_error)?;
    Ok(Json(InitOutlookLinkResponse {
        authorization_url: started.authorization_url,
        link_id: started.id,
    }))
}

fn map_domain_error(error: MicrosoftAuthError) -> InitOutlookLinkError {
    match error {
        MicrosoftAuthError::PaymentRequired => InitOutlookLinkError::PaymentRequired,
        MicrosoftAuthError::NotConfigured => InitOutlookLinkError::IdentityProviderNotFound,
        MicrosoftAuthError::TooManyAttempts => InitOutlookLinkError::TooManyInProgressLinks,
        error => InitOutlookLinkError::InternalError(error.into()),
    }
}

/// Actual deployment availability for the provider selector.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct EmailConnectionProviders {
    pub gmail: bool,
    pub outlook: bool,
}
#[utoipa::path(get,operation_id="email_connection_providers",path="/link/email/providers",responses((status=200,body=EmailConnectionProviders)))]
pub async fn email_connection_providers(
    State(ctx): State<ApiContext>,
) -> Json<EmailConnectionProviders> {
    Json(EmailConnectionProviders {
        gmail: true,
        outlook: ctx
            .microsoft_auth
            .as_ref()
            .is_some_and(|service| service.new_connections_enabled()),
    })
}
