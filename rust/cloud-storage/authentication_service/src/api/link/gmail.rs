use anyhow::Context;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::tracking::ClientIp;
use macro_middleware::user_permissions::attach_user_permissions::PermissionsExtractor;
use model::response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use serde_utils::urlencode::UrlEncoded;
use url::Url;

use crate::api::{
    context::ApiContext, link::github::REAUTHENTICATION_REQUIRED_MESSAGE, oauth2::OAuthState,
};

const GOOGLE_AUTHORIZATION_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GMAIL_IDENTITY_PROVIDER_NAME: &str = "google_gmail";
const GMAIL_SCOPES: &str = "openid profile email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/gmail.settings.basic";

#[derive(serde::Deserialize, serde::Serialize, Debug, utoipa::ToSchema)]
pub struct InitGmailLinkResponse {
    /// The OAuth authorization URL to redirect the user to
    pub authorization_url: String,
    /// The link ID for tracking the OAuth flow
    pub link_id: uuid::Uuid,
}

/// Error type for init Gmail operations
#[derive(thiserror::Error, Debug)]
pub enum InitGmailLinkError {
    /// Too many in-progress links
    #[error("too many in progress links")]
    TooManyInProgressLinks,
    /// The user lacks the subscription required to link an additional inbox
    #[error("a professional subscription is required to link an additional inbox")]
    #[allow(dead_code)]
    PaymentRequired,
    /// Internal error
    #[error("internal error occurred")]
    InternalError(#[from] anyhow::Error),
    /// The identity provider was not found
    #[error("identity provider not found")]
    IdentityProviderNotFound,
}

impl IntoResponse for InitGmailLinkError {
    fn into_response(self) -> Response {
        let message = self.to_string();
        let status_code: StatusCode = match &self {
            InitGmailLinkError::TooManyInProgressLinks => StatusCode::TOO_MANY_REQUESTS,
            InitGmailLinkError::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            InitGmailLinkError::InternalError(_) | InitGmailLinkError::IdentityProviderNotFound => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
pub(crate) struct InitGmailLinkQueryParams {
    /// Once the frontend is update to NOT 2x urlencode this then this should be changed to
    /// `Option<Url>`
    original_url: Option<UrlEncoded<Url>>,
}

/// Initiates a Gmail link for a user
#[utoipa::path(
        post,
        operation_id = "init_gmail_link",
        path = "/link/gmail",
        params(
            ("original_url" = String, Query, description = "**OPTIONAL**. The original url to redirect to.")
        ),
        responses(
            (status = 200, body=InitGmailLinkResponse),
            (status = 400, body=ErrorResponse),
            (status = 402, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context, _permissions), fields(client_ip=%ip_context, user_id=%user_context.user_context.user_id, fusion_user_id=%user_context.user_context.fusion_user_id), err)]
pub async fn init_gmail_link_handler(
    State(ctx): State<ApiContext>,
    query: Query<InitGmailLinkQueryParams>,
    ip_context: ClientIp,
    user_context: MacroUserExtractor,
    PermissionsExtractor(_permissions): PermissionsExtractor,
) -> Result<Json<InitGmailLinkResponse>, InitGmailLinkError> {
    let Query(InitGmailLinkQueryParams { original_url }) = query;

    // NOTE: removed to fix issue of free users not being able to link their gmail account.
    // if !permissions.contains(&PermissionId::ReadProfessionalFeatures.to_string()) {
    //     return Err(InitGmailLinkError::PaymentRequired);
    // }

    let count =
        macro_db_client::in_progress_user_link::count_existing_in_progress_user_links_for_user(
            &ctx.db,
            &user_context.user_context.fusion_user_id,
        )
        .await?;

    if count >= 5 {
        return Err(InitGmailLinkError::TooManyInProgressLinks);
    }

    let link_id = macro_db_client::in_progress_user_link::create_in_progress_user_link(
        &ctx.db,
        &user_context.user_context.fusion_user_id,
    )
    .await?;

    let gmail_idp_id = ctx
        .auth_client
        .get_identity_provider_id_by_name(GMAIL_IDENTITY_PROVIDER_NAME)
        .await
        .map_err(|_| InitGmailLinkError::IdentityProviderNotFound)?;

    let state = OAuthState {
        identity_provider_id: gmail_idp_id,
        link_id: Some(link_id),
        original_url: original_url.map(|x| x.0.to_string()),
        is_mobile: None,
    };

    let redirect_uri = crate::api::oauth2::format_redirect_uri("google");
    let state_str = serde_json::to_string(&state).context("failed to serialize OAuth state")?;

    let mut authorization_url =
        Url::parse(GOOGLE_AUTHORIZATION_URL).context("invalid Google authorization URL")?;
    authorization_url
        .query_pairs_mut()
        .append_pair("client_id", ctx.auth_client.google_client_id())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GMAIL_SCOPES)
        .append_pair("state", &state_str)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    Ok(Json(InitGmailLinkResponse {
        authorization_url: authorization_url.to_string(),
        link_id,
    }))
}

#[derive(serde::Deserialize, serde::Serialize, Debug, utoipa::ToSchema)]
pub struct GmailLinkStatusResponse {
    /// Whether the user must reauthenticate their Gmail link.
    pub reauthentication_required: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum GmailLinkStatusError {
    #[error("reauthentication required")]
    ReauthenticationRequired,
    #[error("internal")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for GmailLinkStatusError {
    fn into_response(self) -> Response {
        match &self {
            GmailLinkStatusError::ReauthenticationRequired => (
                StatusCode::PRECONDITION_REQUIRED,
                Json(ErrorResponse {
                    message: REAUTHENTICATION_REQUIRED_MESSAGE.into(),
                }),
            ),
            GmailLinkStatusError::Internal(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error occurred".into(),
                }),
            ),
        }
        .into_response()
    }
}

/// Checks whether the authenticated user's gmail link is valid.
#[utoipa::path(
        get,
        operation_id = "check_gmail_link_status",
        path = "/link/gmail/status",
        responses(
            (status = 200, body=GmailLinkStatusResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 428, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, ip_context, user_context), fields(client_ip=%ip_context, user_id=%user_context.macro_user_id), err)]
pub async fn check_gmail_link_status_handler(
    State(ctx): State<ApiContext>,
    ip_context: ClientIp,
    user_context: MacroUserExtractor,
) -> Result<Json<GmailLinkStatusResponse>, GmailLinkStatusError> {
    // Check if the user has an email link in db
    if macro_db_client::email::check_user_email_link(&ctx.db, &user_context.macro_user_id)
        .await
        .map_err(GmailLinkStatusError::Internal)?
    {
        let links = ctx
            .auth_client
            .get_links(&user_context.user_context.fusion_user_id, None)
            .await
            .map_err(|e| GmailLinkStatusError::Internal(e.into()))?;

        let result = links
            .iter()
            .filter_map(|l| {
                if l.identity_provider_name.eq("google_gmail") {
                    Some(true)
                } else {
                    None
                }
            })
            .collect::<Vec<bool>>();

        // If no, return 428
        if result.is_empty() {
            return Err(GmailLinkStatusError::ReauthenticationRequired);
        }
    }

    Ok(Json(GmailLinkStatusResponse {
        reauthentication_required: false,
    }))
}
