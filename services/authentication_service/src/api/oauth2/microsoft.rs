use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Response},
};
use email_validator::normalize_email;
use fusionauth::{
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
    microsoft::oauth::MicrosoftUserInfo,
};
use model::response::ErrorResponse;
use reqwest::StatusCode;
use uuid::Uuid;

use crate::api::{
    context::ApiContext,
    oauth2::{
        OAuthState,
        account_link::{
            build_callback_redirect, cleanup_pending_link, replace_identity_provider_grant,
        },
        format_redirect_uri,
    },
};

#[cfg(test)]
mod test;

const MICROSOFT_IDENTITY_PROVIDER_NAME: &str = "microsoft";

type MicrosoftCallbackResult<T> = Result<T, (StatusCode, String)>;

#[derive(Debug, Eq, PartialEq)]
struct MicrosoftLinkIdentity {
    subject: String,
    email: String,
}

fn extract_identity(
    user_info: MicrosoftUserInfo,
) -> MicrosoftCallbackResult<MicrosoftLinkIdentity> {
    if user_info.sub.trim().is_empty() {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "Microsoft identity does not contain a subject".into(),
        ));
    }

    let email = normalize_email(&user_info.email)
        .map(Cow::into_owned)
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Microsoft identity does not contain a usable email".into(),
            )
        })?;

    Ok(MicrosoftLinkIdentity {
        subject: user_info.sub,
        email,
    })
}

fn require_link_id(state: &OAuthState) -> MicrosoftCallbackResult<Uuid> {
    state.link_id.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Microsoft OAuth callback requires link_id".into(),
        )
    })
}

fn verify_identity_provider(
    state: &OAuthState,
    microsoft_identity_provider_id: &str,
) -> MicrosoftCallbackResult<()> {
    if state.identity_provider_id != microsoft_identity_provider_id {
        return Err((
            StatusCode::BAD_REQUEST,
            "Microsoft identity provider does not match callback state".into(),
        ));
    }

    Ok(())
}

#[tracing::instrument(skip(ctx, code, state), fields(%link_id), err(Debug))]
async fn link_user(
    ctx: &ApiContext,
    code: &str,
    state: &OAuthState,
    link_id: &Uuid,
) -> MicrosoftCallbackResult<()> {
    let microsoft_identity_provider_id = ctx
        .auth_client
        .get_identity_provider_id_by_name(MICROSOFT_IDENTITY_PROVIDER_NAME)
        .await
        .map_err(|error| match error {
            FusionAuthClientError::NoIdentityProviderFound => {
                (StatusCode::NOT_FOUND, "identity provider not found".into())
            }
            error => (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to resolve Microsoft identity provider {error}"),
            ),
        })?;
    verify_identity_provider(state, &microsoft_identity_provider_id)?;

    let pending_link =
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&ctx.db, link_id)
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to load pending Microsoft link {error}"),
                )
            })?;

    let token_response = ctx
        .auth_client
        .exchange_microsoft_code_for_tokens(code, &format_redirect_uri("microsoft"))
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to exchange Microsoft code for tokens {error}"),
            )
        })?;
    let user_info = ctx
        .auth_client
        .parse_microsoft_id_token(&token_response.id_token)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to decode Microsoft ID token {error}"),
            )
        })?;
    let identity = extract_identity(user_info)?;

    // The identity-provider link is also a login identity. If the mailbox already belongs to a
    // Macro account, keep its Microsoft login attached to that owner rather than the requester.
    let link_owner_id = match macro_db_client::user::get::get_macro_user_id_by_email(
        &ctx.db,
        &identity.email,
    )
    .await
    {
        Ok(Some(mailbox_owner_id)) => mailbox_owner_id.to_string(),
        Ok(None) => pending_link.macro_user_id.to_string(),
        Err(error) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to look up mailbox owner for linked email {error}"),
            ));
        }
    };

    match ctx
        .auth_client
        .link_user(LinkUserRequest {
            identity_provider_link: IdentityProviderLink {
                display_name: Cow::Borrowed(&identity.email),
                identity_provider_id: Cow::Borrowed(&microsoft_identity_provider_id),
                identity_provider_user_id: Cow::Borrowed(&identity.subject),
                user_id: Cow::Borrowed(&link_owner_id),
                token: Cow::Borrowed(&token_response.refresh_token),
            },
        })
        .await
    {
        Ok(()) => {}
        Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
            replace_identity_provider_grant(
                &ctx.auth_client,
                &microsoft_identity_provider_id,
                &link_owner_id,
                &identity.email,
                &token_response.refresh_token,
            )
            .await?;
        }
        Err(error) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to link Microsoft user {error}"),
            ));
        }
    }

    macro_db_client::in_progress_user_link::set_linked_email(&ctx.db, link_id, &identity.email)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to record linked Microsoft email {error}"),
            )
        })?;

    Ok(())
}

pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    code: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    let link_id = require_link_id(state).map_err(callback_error_response)?;
    let link_result = link_user(ctx, code, state, &link_id).await;

    if link_result.is_err() {
        cleanup_pending_link(ctx, &link_id).await;
    }

    link_result.map_err(callback_error_response)?;

    if let Some(original_url) = &state.original_url {
        return match build_callback_redirect(original_url, &link_id) {
            Ok(response) => Ok(response),
            Err(error) => {
                cleanup_pending_link(ctx, &link_id).await;
                Err(error.into_response())
            }
        };
    }

    Ok(StatusCode::OK.into_response())
}

fn callback_error_response((status_code, message): (StatusCode, String)) -> Response {
    tracing::error!(error=?message, "unable to link Microsoft user");
    (
        status_code,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
