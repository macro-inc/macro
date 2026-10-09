//! Adapters for the owner-bound Microsoft OAuth lifecycle.

use crate::{
    account_link_state::{
        AccountLinkState, AccountLinkStateKey, LinkProvider, sign_account_link_state,
    },
    domain::microsoft::{token::MicrosoftRefreshToken, *},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use zeroize::Zeroizing;

mod repository;
pub use repository::PgMicrosoftGrants;

pub struct MicrosoftOAuthProvider {
    client: Arc<fusionauth::FusionAuthClient>,
    state_key: AccountLinkStateKey,
}

impl MicrosoftOAuthProvider {
    pub(crate) fn new(
        client: Arc<fusionauth::FusionAuthClient>,
        state_key: AccountLinkStateKey,
    ) -> Self {
        Self { client, state_key }
    }
}

#[async_trait::async_trait]
impl MicrosoftIdentityProvider for MicrosoftOAuthProvider {
    async fn identity_provider_id(&self) -> Result<String, MicrosoftAuthError> {
        self.client
            .get_identity_provider_id_by_name("microsoft")
            .await
            .map_err(|_| MicrosoftAuthError::NotConfigured)
    }

    fn authorize(&self, attempt: &LinkAttempt) -> Result<String, MicrosoftAuthError> {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(attempt.verifier.as_bytes()));
        // Bind the signed callback state to the same owner and expiration as
        // the server-owned PKCE attempt; the callback rejects unsigned links.
        let state = AccountLinkState {
            provider: LinkProvider::Microsoft,
            identity_provider_id: attempt.identity_provider_id.clone(),
            link_id: attempt.id,
            fusion_user_id: attempt.owner,
            original_url: attempt.return_uri.clone(),
            exp: attempt.expires_at.timestamp(),
        };
        let state = sign_account_link_state(&state, &self.state_key)
            .map_err(|_| MicrosoftAuthError::Unavailable)?;
        self.client
            .construct_bound_microsoft_authorize_url(
                &attempt.redirect_uri,
                &state,
                &challenge,
                &attempt.nonce,
                attempt.calendar_requested,
            )
            .map_err(|_| MicrosoftAuthError::NotConfigured)
    }

    async fn exchange(
        &self,
        attempt: &LinkAttempt,
        code: &str,
    ) -> Result<VerifiedGrant, MicrosoftAuthError> {
        let tokens = self
            .client
            .exchange_bound_microsoft_code(code, &attempt.redirect_uri, &attempt.verifier)
            .await
            .map_err(|_| MicrosoftAuthError::InvalidAttempt)?;
        let id_token = Zeroizing::new(tokens.id_token);
        let access_token = Zeroizing::new(tokens.access_token);
        let refresh_token = MicrosoftRefreshToken::new(tokens.refresh_token);
        let identity = self
            .client
            .parse_bound_microsoft_id_token(&id_token, &attempt.nonce)
            .await
            .map_err(|_| MicrosoftAuthError::InvalidIdentity)?;
        let mailbox = self
            .client
            .microsoft_mailbox_identity(&access_token)
            .await
            .map_err(|_| MicrosoftAuthError::InvalidIdentity)?;
        let email = mailbox
            .mail
            .as_deref()
            .filter(|email| !email.is_empty())
            .or(mailbox.user_principal_name.as_deref())
            .and_then(email_validator::normalize_email)
            .ok_or(MicrosoftAuthError::InvalidIdentity)?
            .into_owned();
        Ok(VerifiedGrant {
            tenant_id: identity.tenant_id,
            subject_id: identity.sub,
            mailbox_id: mailbox.id,
            email,
            scopes: tokens.scope.split_whitespace().map(str::to_owned).collect(),
            refresh_token,
        })
    }

    async fn refresh(
        &self,
        token: &MicrosoftRefreshToken,
    ) -> Result<RefreshedGrant, MicrosoftAuthError> {
        use fusionauth::microsoft::runtime::MicrosoftRuntimeError;
        let refreshed = self
            .client
            .refresh_microsoft_tokens(token.as_str())
            .await
            .map_err(|error| match error {
                MicrosoftRuntimeError::ReauthorizationRequired => {
                    MicrosoftAuthError::ReauthorizationRequired
                }
                _ => MicrosoftAuthError::Unavailable,
            })?;
        Ok(RefreshedGrant {
            access_token: Zeroizing::new(refreshed.access_token),
            refresh_token: refreshed.refresh_token.map(MicrosoftRefreshToken::new),
            expires_in: refreshed.expires_in,
            scopes: refreshed
                .scope
                .split_whitespace()
                .map(str::to_owned)
                .collect(),
        })
    }
}
