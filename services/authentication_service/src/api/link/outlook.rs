use crate::domain::microsoft::{MicrosoftAuth, MicrosoftAuthError};
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{AccountHolderOrInternal, MacroAuthorizationExtractor};
use macro_middleware::tracking::ClientIp;
use macro_user_id::user_id::MacroUserIdStr;
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
#[tracing::instrument(skip(ctx, ip_context, authorization), fields(client_ip=%ip_context, user_id=%authorization.authorization.user.user_context.user_id, fusion_user_id=%authorization.authorization.user.user_context.fusion_user_id, outlook.flag = tracing::field::Empty), err)]
pub async fn init_outlook_link_handler(
    State(ctx): State<ApiContext>,
    Query(InitOutlookLinkQueryParams {
        original_url,
        scopes,
        reconnect_link_id,
    }): Query<InitOutlookLinkQueryParams>,
    ip_context: ClientIp,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
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
    start_outlook_link(
        service.as_ref(),
        owner,
        &authorization.authorization.user.macro_user_id,
        format_redirect_uri("microsoft"),
        original_url.map(String::from),
        ctx.calendar_scope_enabled && matches!(scopes, OutlookConsentScopes::MailAndCalendar),
        reconnect_link_id,
    )
    .await
    .map(Json)
}

/// A new connection that the deployment switch or the user's flag refuses
/// answers 404, the same as an unconfigured provider.
async fn start_outlook_link(
    service: &dyn MicrosoftAuth,
    owner: uuid::Uuid,
    user: &MacroUserIdStr<'_>,
    redirect_uri: String,
    original_url: Option<String>,
    calendar_requested: bool,
    reconnect_link_id: Option<uuid::Uuid>,
) -> Result<InitOutlookLinkResponse, InitOutlookLinkError> {
    let started = service
        .start_link(
            owner,
            user,
            redirect_uri,
            original_url,
            calendar_requested,
            reconnect_link_id,
        )
        .await
        .map_err(map_domain_error)?;
    Ok(InitOutlookLinkResponse {
        authorization_url: started.authorization_url,
        link_id: started.id,
    })
}

fn map_domain_error(error: MicrosoftAuthError) -> InitOutlookLinkError {
    match error {
        MicrosoftAuthError::PaymentRequired => InitOutlookLinkError::PaymentRequired,
        MicrosoftAuthError::NotConfigured => InitOutlookLinkError::IdentityProviderNotFound,
        MicrosoftAuthError::TooManyAttempts => InitOutlookLinkError::TooManyInProgressLinks,
        error => InitOutlookLinkError::InternalError(error.into()),
    }
}

/// What the provider selector offers the requesting user.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct EmailConnectionProviders {
    pub gmail: bool,
    /// Whether this user may start a new Outlook connection: the deployment
    /// switch and their `enable-outlook` flag.
    pub outlook: bool,
    /// Where a Microsoft 365 administrator approves Macro for their whole
    /// directory. Present when Outlook is configured and the request named an
    /// `original_url` for the administrator's browser to return to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outlook_admin_consent_url: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct EmailConnectionProvidersQueryParams {
    original_url: Option<Url>,
}

#[utoipa::path(
    get,
    operation_id = "email_connection_providers",
    path = "/link/email/providers",
    params(
        ("original_url" = Option<String>, Query, description = "**OPTIONAL**. Where the admin-consent flow returns to; required for `outlook_admin_consent_url`."),
    ),
    responses(
        (status = 200, body = EmailConnectionProviders),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all, fields(fusion_user_id=%authorization.authorization.user.user_context.fusion_user_id, outlook.flag = tracing::field::Empty), err)]
pub async fn email_connection_providers(
    State(ctx): State<ApiContext>,
    Query(EmailConnectionProvidersQueryParams { original_url }): Query<
        EmailConnectionProvidersQueryParams,
    >,
    authorization: MacroAuthorizationExtractor<AuthorizationService, AccountHolderOrInternal>,
) -> Result<Json<EmailConnectionProviders>, InitOutlookLinkError> {
    if original_url
        .as_ref()
        .is_some_and(|url| !crate::api::login::sso::is_allowed_original_url(url))
    {
        return Err(InitOutlookLinkError::InvalidReturnUrl);
    }
    Ok(Json(
        connection_providers(
            ctx.microsoft_auth.as_deref(),
            &authorization.authorization.user.macro_user_id,
            original_url,
            ctx.calendar_scope_enabled,
        )
        .await,
    ))
}

async fn connection_providers(
    microsoft_auth: Option<&dyn MicrosoftAuth>,
    user: &MacroUserIdStr<'_>,
    original_url: Option<Url>,
    calendar_scope_enabled: bool,
) -> EmailConnectionProviders {
    // The consent URL is an optional extra; a failure to sign it must not hide
    // which providers are available. It stays independent of the flag: an
    // inbox being reconnected can still need an administrator's approval.
    let outlook_admin_consent_url = match (microsoft_auth, original_url) {
        (Some(service), Some(original_url)) => service
            .admin_consent_url(
                &format_redirect_uri("microsoft"),
                original_url.as_str(),
                calendar_scope_enabled,
            )
            .inspect_err(|error| {
                tracing::warn!(error=?error, "unable to build Outlook admin-consent URL");
            })
            .ok(),
        _ => None,
    };
    let outlook = match microsoft_auth {
        Some(service) => service.new_connections_enabled(user).await,
        None => false,
    };
    EmailConnectionProviders {
        gmail: true,
        outlook,
        outlook_admin_consent_url,
    }
}
