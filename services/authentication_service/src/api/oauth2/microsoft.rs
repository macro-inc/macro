use std::borrow::Cow;

use axum::{
    Json,
    response::{IntoResponse, Response},
};
use email_validator::normalize_email;
use fusionauth::{
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
    microsoft::oauth::{MicrosoftExchangeTokenResponse, MicrosoftUserInfo},
};
use microsoft_oauth_grant_db_utils::EncryptedMicrosoftOAuthGrant;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use uuid::Uuid;

use crate::{
    api::{
        context::ApiContext,
        oauth2::{
            OAuthState,
            account_link::{
                build_callback_redirect, cleanup_pending_link, replace_identity_provider_grant,
            },
            format_redirect_uri,
        },
    },
    microsoft_token_cipher::{EncryptedMicrosoftToken, MicrosoftRefreshToken},
};

#[cfg(test)]
mod test;

const MICROSOFT_IDENTITY_PROVIDER_NAME: &str = "microsoft";
const GRANT_STORAGE_ERROR: &str = "unable to securely store Microsoft grant";

type MicrosoftCallbackResult<T> = Result<T, (StatusCode, String)>;

#[derive(Debug, Eq, PartialEq)]
struct MicrosoftLinkIdentity {
    subject: String,
    email: String,
}

enum FusionLinkChange {
    Fresh,
    Replaced {
        previous_refresh_token: MicrosoftRefreshToken,
    },
    Unchanged,
}

struct GrantEncryptionFailed;
struct GrantPersistenceFailed;

#[async_trait::async_trait]
trait MicrosoftCallbackDependencies: Send + Sync {
    async fn identity_provider_id(&self) -> MicrosoftCallbackResult<String>;

    async fn pending_link_owner(&self, link_id: &Uuid) -> MicrosoftCallbackResult<String>;

    async fn exchange_tokens(
        &self,
        code: &str,
    ) -> MicrosoftCallbackResult<MicrosoftExchangeTokenResponse>;

    async fn parse_identity(&self, id_token: &str) -> MicrosoftCallbackResult<MicrosoftUserInfo>;

    async fn mailbox_owner(
        &self,
        email: &str,
        pending_link_owner: &str,
    ) -> MicrosoftCallbackResult<String>;

    async fn link_identity(
        &self,
        identity_provider_id: &str,
        link_owner_id: &str,
        identity: &MicrosoftLinkIdentity,
        refresh_token: &str,
    ) -> MicrosoftCallbackResult<FusionLinkChange>;

    async fn encrypt_grant(
        &self,
        link_owner_id: &str,
        email: &str,
        refresh_token: MicrosoftRefreshToken,
    ) -> Result<EncryptedMicrosoftToken, GrantEncryptionFailed>;

    async fn persist_grant(
        &self,
        link_owner_id: &str,
        email: &str,
        encrypted_token: &EncryptedMicrosoftToken,
    ) -> Result<(), GrantPersistenceFailed>;

    async fn mark_link_consumable(
        &self,
        link_id: &Uuid,
        email: &str,
    ) -> MicrosoftCallbackResult<()>;

    async fn compensate_link(
        &self,
        identity_provider_id: &str,
        link_owner_id: &str,
        identity: &MicrosoftLinkIdentity,
        change: FusionLinkChange,
    );

    async fn cleanup_pending_link(&self, link_id: &Uuid);
}

#[async_trait::async_trait]
impl MicrosoftCallbackDependencies for ApiContext {
    async fn identity_provider_id(&self) -> MicrosoftCallbackResult<String> {
        self.auth_client
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
            })
    }

    async fn pending_link_owner(&self, link_id: &Uuid) -> MicrosoftCallbackResult<String> {
        macro_db_client::in_progress_user_link::get_in_progress_user_link(&self.db, link_id)
            .await
            .map(|link| link.macro_user_id.to_string())
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to load pending Microsoft link {error}"),
                )
            })
    }

    async fn exchange_tokens(
        &self,
        code: &str,
    ) -> MicrosoftCallbackResult<MicrosoftExchangeTokenResponse> {
        self.auth_client
            .exchange_microsoft_code_for_tokens(code, &format_redirect_uri("microsoft"))
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to exchange Microsoft code for tokens {error}"),
                )
            })
    }

    async fn parse_identity(&self, id_token: &str) -> MicrosoftCallbackResult<MicrosoftUserInfo> {
        self.auth_client
            .parse_microsoft_id_token(id_token)
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to decode Microsoft ID token {error}"),
                )
            })
    }

    async fn mailbox_owner(
        &self,
        email: &str,
        pending_link_owner: &str,
    ) -> MicrosoftCallbackResult<String> {
        match macro_db_client::user::get::get_macro_user_id_by_email(&self.db, email).await {
            Ok(Some(mailbox_owner_id)) => Ok(mailbox_owner_id.to_string()),
            Ok(None) => Ok(pending_link_owner.to_owned()),
            Err(error) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("unable to look up mailbox owner for linked email {error}"),
            )),
        }
    }

    async fn link_identity(
        &self,
        identity_provider_id: &str,
        link_owner_id: &str,
        identity: &MicrosoftLinkIdentity,
        refresh_token: &str,
    ) -> MicrosoftCallbackResult<FusionLinkChange> {
        let link_request = LinkUserRequest {
            identity_provider_link: IdentityProviderLink {
                display_name: Cow::Borrowed(&identity.email),
                identity_provider_id: Cow::Borrowed(identity_provider_id),
                identity_provider_user_id: Cow::Borrowed(&identity.subject),
                user_id: Cow::Borrowed(link_owner_id),
                token: Cow::Borrowed(refresh_token),
            },
        };

        match self.auth_client.link_user(link_request).await {
            Ok(()) => Ok(FusionLinkChange::Fresh),
            Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
                let previous_refresh_token = self
                    .auth_client
                    .get_links(link_owner_id, Some(identity_provider_id.to_owned()))
                    .await
                    .map_err(|error| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("unable to read existing Microsoft links {error}"),
                        )
                    })?
                    .into_iter()
                    .find(|link| link.display_name == identity.email)
                    .and_then(|link| {
                        (!refresh_token.is_empty() && link.token != refresh_token)
                            .then(|| MicrosoftRefreshToken::new(link.token))
                    });

                replace_identity_provider_grant(
                    &self.auth_client,
                    identity_provider_id,
                    link_owner_id,
                    &identity.email,
                    refresh_token,
                )
                .await
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "unable to replace Microsoft identity-provider grant".into(),
                    )
                })?;

                match previous_refresh_token {
                    Some(previous_refresh_token) => Ok(FusionLinkChange::Replaced {
                        previous_refresh_token,
                    }),
                    None => Ok(FusionLinkChange::Unchanged),
                }
            }
            Err(_) => Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to link Microsoft user".into(),
            )),
        }
    }

    async fn encrypt_grant(
        &self,
        link_owner_id: &str,
        email: &str,
        refresh_token: MicrosoftRefreshToken,
    ) -> Result<EncryptedMicrosoftToken, GrantEncryptionFailed> {
        let Some(cipher) = &self.microsoft_token_cipher else {
            tracing::error!("Microsoft token cipher is not configured");
            return Err(GrantEncryptionFailed);
        };

        cipher
            .encrypt(link_owner_id, email, refresh_token)
            .await
            .inspect_err(
                |error| tracing::error!(error=?error, "failed to encrypt Microsoft refresh token"),
            )
            .map_err(|_| GrantEncryptionFailed)
    }

    async fn persist_grant(
        &self,
        link_owner_id: &str,
        email: &str,
        encrypted_token: &EncryptedMicrosoftToken,
    ) -> Result<(), GrantPersistenceFailed> {
        let encrypted_grant = EncryptedMicrosoftOAuthGrant::new(
            encrypted_token.refresh_token_ciphertext.clone(),
            encrypted_token.encrypted_data_key.clone(),
            encrypted_token.nonce.clone(),
            i32::from(encrypted_token.encryption_version),
            encrypted_token.kms_key_id.clone(),
        );

        microsoft_oauth_grant_db_utils::upsert_microsoft_oauth_grant(
            &self.db,
            link_owner_id,
            email,
            &encrypted_grant,
        )
        .await
        .inspect_err(
            |error| tracing::error!(error=?error, "failed to persist encrypted Microsoft grant"),
        )
        .map(|_| ())
        .map_err(|_| GrantPersistenceFailed)
    }

    async fn mark_link_consumable(
        &self,
        link_id: &Uuid,
        email: &str,
    ) -> MicrosoftCallbackResult<()> {
        macro_db_client::in_progress_user_link::set_linked_email(&self.db, link_id, email)
            .await
            .map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("unable to record linked Microsoft email {error}"),
                )
            })
    }

    async fn compensate_link(
        &self,
        identity_provider_id: &str,
        link_owner_id: &str,
        identity: &MicrosoftLinkIdentity,
        change: FusionLinkChange,
    ) {
        let compensation_failed = match change {
            FusionLinkChange::Fresh => self
                .auth_client
                .unlink_user(link_owner_id, identity_provider_id, &identity.subject)
                .await
                .is_err(),
            FusionLinkChange::Replaced {
                previous_refresh_token,
            } => replace_identity_provider_grant(
                &self.auth_client,
                identity_provider_id,
                link_owner_id,
                &identity.email,
                previous_refresh_token.as_str(),
            )
            .await
            .is_err(),
            FusionLinkChange::Unchanged => false,
        };

        if compensation_failed {
            tracing::warn!("failed to compensate Microsoft identity-provider link");
        }
    }

    async fn cleanup_pending_link(&self, link_id: &Uuid) {
        cleanup_pending_link(self, link_id).await;
    }
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

#[tracing::instrument(skip(dependencies, code, state), fields(%link_id), err(Debug))]
async fn link_user<D: MicrosoftCallbackDependencies + ?Sized>(
    dependencies: &D,
    code: &str,
    state: &OAuthState,
    link_id: &Uuid,
) -> MicrosoftCallbackResult<()> {
    let identity_provider_id = dependencies.identity_provider_id().await?;
    verify_identity_provider(state, &identity_provider_id)?;

    let pending_link_owner = dependencies.pending_link_owner(link_id).await?;
    let token_response = dependencies.exchange_tokens(code).await?;
    let user_info = dependencies
        .parse_identity(&token_response.id_token)
        .await?;
    let identity = extract_identity(user_info)?;
    let link_owner_id = dependencies
        .mailbox_owner(&identity.email, &pending_link_owner)
        .await?;

    let link_change = dependencies
        .link_identity(
            &identity_provider_id,
            &link_owner_id,
            &identity,
            &token_response.refresh_token,
        )
        .await?;

    let encrypted_token = match dependencies
        .encrypt_grant(
            &link_owner_id,
            &identity.email,
            MicrosoftRefreshToken::new(token_response.refresh_token),
        )
        .await
    {
        Ok(encrypted_token) => encrypted_token,
        Err(_) => {
            dependencies
                .compensate_link(
                    &identity_provider_id,
                    &link_owner_id,
                    &identity,
                    link_change,
                )
                .await;
            return Err(grant_storage_error());
        }
    };

    if dependencies
        .persist_grant(&link_owner_id, &identity.email, &encrypted_token)
        .await
        .is_err()
    {
        dependencies
            .compensate_link(
                &identity_provider_id,
                &link_owner_id,
                &identity,
                link_change,
            )
            .await;
        return Err(grant_storage_error());
    }

    dependencies
        .mark_link_consumable(link_id, &identity.email)
        .await
}

fn grant_storage_error() -> (StatusCode, String) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        GRANT_STORAGE_ERROR.into(),
    )
}

async fn handler_with_dependencies<D: MicrosoftCallbackDependencies + ?Sized>(
    dependencies: &D,
    code: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    let link_id = require_link_id(state).map_err(callback_error_response)?;
    let link_result = link_user(dependencies, code, state, &link_id).await;

    if link_result.is_err() {
        dependencies.cleanup_pending_link(&link_id).await;
    }

    link_result.map_err(callback_error_response)?;

    if let Some(original_url) = &state.original_url {
        return match build_callback_redirect(original_url, &link_id) {
            Ok(response) => Ok(response),
            Err(error) => {
                dependencies.cleanup_pending_link(&link_id).await;
                Err(error.into_response())
            }
        };
    }

    Ok(StatusCode::OK.into_response())
}

pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    code: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    handler_with_dependencies(ctx, code, state).await
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
