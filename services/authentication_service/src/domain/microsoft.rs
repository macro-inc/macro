//! Owner-bound Microsoft linking and serialized refresh-token rotation.

use chrono::{DateTime, Duration, Utc};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub mod token;
use token::{EncryptedMicrosoftToken, MicrosoftRefreshToken, MicrosoftTokenCipher};

#[cfg(test)]
mod test;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MicrosoftAuthError {
    #[error("a professional subscription is required to link an additional inbox")]
    PaymentRequired,
    #[error("Microsoft linking is not configured")]
    NotConfigured,
    #[error("this Microsoft linking attempt has expired or was already used")]
    InvalidAttempt,
    #[error("too many Microsoft linking attempts")]
    TooManyAttempts,
    #[error("Microsoft did not grant all required mailbox permissions")]
    MissingPermissions,
    #[error("Microsoft authorization requires reconnecting")]
    ReauthorizationRequired,
    #[error("Microsoft authorization is temporarily busy; retry shortly")]
    Busy,
    #[error("Microsoft authorization is temporarily unavailable")]
    Unavailable,
    #[error("the Microsoft mailbox identity could not be verified")]
    InvalidIdentity,
    #[error("this mailbox is already connected to another owner")]
    OwnershipConflict,
}

/// Secret state is deliberately neither Debug nor serializable to the client.
pub struct LinkAttempt {
    pub id: Uuid,
    pub owner: Uuid,
    pub identity_provider_id: String,
    pub redirect_uri: String,
    pub return_uri: Option<String>,
    pub verifier: Zeroizing<String>,
    pub nonce: String,
    pub calendar_requested: bool,
    pub expires_at: DateTime<Utc>,
}

pub struct LinkStart {
    pub id: Uuid,
    pub authorization_url: String,
}

/// The provider adapter verifies signature, issuer, audience, nonce and Graph /me.
pub struct VerifiedGrant {
    pub tenant_id: String,
    pub subject_id: String,
    pub mailbox_id: String,
    pub email: String,
    pub scopes: Vec<String>,
    pub refresh_token: MicrosoftRefreshToken,
}

pub struct StoredGrant {
    pub scopes: Vec<String>,
    pub id: Uuid,
    pub generation: i64,
    pub revision: i64,
    pub owner: String,
    pub email: String,
    pub envelope: EncryptedMicrosoftToken,
}

/// Verified, non-secret mailbox binding for the email domain's initializer.
/// The initiating principal must match the completed OAuth attempt.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CompletedMicrosoftGrant {
    pub calendar_requested: bool,
    pub grant_id: Uuid,
    pub generation: i64,
    pub owner: Uuid,
    pub email: String,
    pub tenant_id: String,
    pub mailbox_id: String,
    pub scopes: Vec<String>,
}

pub struct RefreshedGrant {
    pub access_token: Zeroizing<String>,
    pub refresh_token: Option<MicrosoftRefreshToken>,
    pub expires_in: u64,
    pub scopes: Vec<String>,
}

/// Token and the permissions observed for the same grant acquisition.
pub struct MicrosoftAccessGrant {
    token: Zeroizing<String>,
    pub scopes: Vec<String>,
}
impl MicrosoftAccessGrant {
    pub fn as_str(&self) -> &str {
        self.token.as_str()
    }
}

#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait MicrosoftGrantRepository: Send + Sync {
    /// Expire completed/abandoned link attempts, then collect unbound grants.
    /// Keep every grant referenced by a mailbox, custodian, or remaining attempt.
    async fn collect_expired_grants(
        &self,
        older_than: DateTime<Utc>,
        limit: i64,
    ) -> Result<u64, MicrosoftAuthError>;
    async fn connection_facts(
        &self,
        owner: Uuid,
        reconnect: Option<Uuid>,
    ) -> Result<email::domain::inbox_entitlement::InboxConnectionFacts, MicrosoftAuthError>;
    /// Delete only the exact released grant when no active mailbox binds it.
    /// Delayed work cannot revoke a later reconnect or a current custodian.
    async fn revoke_released_grant(
        &self,
        id: Uuid,
        generation: i64,
        owner: &str,
    ) -> Result<(), MicrosoftAuthError>;
    /// Enforces the pending-attempt cap atomically for this owner.
    async fn begin_link(&self, attempt: &LinkAttempt) -> Result<(), MicrosoftAuthError>;
    /// Atomically claims an unexpired, provider-bound attempt exactly once.
    async fn claim_link(&self, id: Uuid) -> Result<LinkAttempt, MicrosoftAuthError>;
    async fn abandon_link(&self, id: Uuid) -> Result<(), MicrosoftAuthError>;
    async fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> Result<CompletedMicrosoftGrant, MicrosoftAuthError>;
    /// Persists the grant and marks the same owner's pending link consumable in
    /// one transaction. Reconnecting increments generation and fences rotation.
    async fn complete_link(
        &self,
        attempt: &LinkAttempt,
        identity: &VerifiedGrant,
        envelope: &EncryptedMicrosoftToken,
        grant_id: Uuid,
    ) -> Result<(), MicrosoftAuthError>;
    /// Resolves an active Outlook link's exact grant generation; never accepts a
    /// caller-supplied email address as proof of mailbox ownership.
    async fn active_grant(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<StoredGrant, MicrosoftAuthError>;
    /// Only the frozen exact binding may obtain credentials for disconnect cleanup.
    async fn disconnecting_grant(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<StoredGrant, MicrosoftAuthError>;
    async fn acquire_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
    ) -> Result<bool, MicrosoftAuthError>;
    /// Compare-and-swap includes generation, revision and lease owner.
    async fn finish_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
        envelope: &EncryptedMicrosoftToken,
        scopes: &[String],
    ) -> Result<bool, MicrosoftAuthError>;
    async fn release_refresh(
        &self,
        grant: &StoredGrant,
        lease: Uuid,
        revoke: bool,
    ) -> Result<(), MicrosoftAuthError>;
}

#[cfg_attr(test, mockall::automock)]
#[async_trait::async_trait]
pub trait MicrosoftIdentityProvider: Send + Sync {
    async fn identity_provider_id(&self) -> Result<String, MicrosoftAuthError>;
    fn authorize(&self, attempt: &LinkAttempt) -> Result<String, MicrosoftAuthError>;
    async fn exchange(
        &self,
        attempt: &LinkAttempt,
        code: &str,
    ) -> Result<VerifiedGrant, MicrosoftAuthError>;
    async fn refresh(
        &self,
        token: &MicrosoftRefreshToken,
    ) -> Result<RefreshedGrant, MicrosoftAuthError>;
}

#[async_trait::async_trait]
pub trait MicrosoftAuth: Send + Sync {
    fn new_connections_enabled(&self) -> bool;
    async fn revoke_released_grant(
        &self,
        id: Uuid,
        generation: i64,
        owner: &str,
    ) -> Result<(), MicrosoftAuthError>;
    async fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> Result<CompletedMicrosoftGrant, MicrosoftAuthError>;
    async fn start_link(
        &self,
        owner: Uuid,
        redirect_uri: String,
        return_uri: Option<String>,
        calendar_requested: bool,
        reconnect: Option<Uuid>,
    ) -> Result<LinkStart, MicrosoftAuthError>;
    /// Return destinations come from server state, never the callback's mutable state.
    async fn complete_link(
        &self,
        id: Uuid,
        identity_provider_id: &str,
        code: &str,
    ) -> Result<Option<String>, MicrosoftAuthError>;
    async fn disconnect_token(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<MicrosoftAccessGrant, MicrosoftAuthError>;
    async fn access_token(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
        force_refresh: bool,
    ) -> Result<MicrosoftAccessGrant, MicrosoftAuthError>;
}

/// Credential retention must not depend on the owner signing in again.
pub async fn collect_expired_grants(
    repository: &impl MicrosoftGrantRepository,
) -> Result<u64, MicrosoftAuthError> {
    const BATCH_SIZE: i64 = 256;
    repository
        .collect_expired_grants(Utc::now() - Duration::hours(24), BATCH_SIZE)
        .await
}

struct CachedToken {
    value: Zeroizing<String>,
    scopes: Vec<String>,
    expires_at: DateTime<Utc>,
}

pub struct MicrosoftAuthService<R, P> {
    connections_enabled: bool,
    repo: R,
    provider: P,
    cipher: Arc<dyn MicrosoftTokenCipher>,
    cache: Mutex<HashMap<(Uuid, i64), CachedToken>>,
}

impl<R, P> MicrosoftAuthService<R, P> {
    pub fn with_connections_enabled(mut self, enabled: bool) -> Self {
        self.connections_enabled = enabled;
        self
    }
    pub fn new(repo: R, provider: P, cipher: Arc<dyn MicrosoftTokenCipher>) -> Self {
        Self {
            repo,
            provider,
            cipher,
            cache: Mutex::new(HashMap::new()),
            connections_enabled: true,
        }
    }
}

/// Persist one spelling for Graph capabilities so every consumer sees the same grant.
fn normalize_scopes(scopes: Vec<String>) -> Vec<String> {
    const KNOWN: &[&str] = &[
        "User.Read",
        "Mail.ReadWrite",
        "Mail.Send",
        "Contacts.Read",
        "Calendars.ReadWrite",
        "MailboxSettings.ReadWrite",
        "openid",
        "profile",
        "email",
        "offline_access",
    ];
    let mut normalized = scopes
        .into_iter()
        .map(|scope| {
            let name = scope.rsplit('/').next().unwrap_or(&scope);
            KNOWN
                .iter()
                .find(|known| known.eq_ignore_ascii_case(name))
                .map_or(scope.clone(), |known| (*known).to_owned())
        })
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn has_required_scopes(scopes: &[String]) -> bool {
    ["user.read", "mail.readwrite", "mail.send"]
        .iter()
        .all(|required| {
            scopes.iter().any(|scope| {
                scope
                    .rsplit('/')
                    .next()
                    .is_some_and(|scope| scope.eq_ignore_ascii_case(required))
            })
        })
}

#[async_trait::async_trait]
impl<R: MicrosoftGrantRepository, P: MicrosoftIdentityProvider> MicrosoftAuth
    for MicrosoftAuthService<R, P>
{
    fn new_connections_enabled(&self) -> bool {
        self.connections_enabled
    }
    async fn revoke_released_grant(
        &self,
        id: Uuid,
        generation: i64,
        owner: &str,
    ) -> Result<(), MicrosoftAuthError> {
        self.repo
            .revoke_released_grant(id, generation, owner)
            .await?;
        self.cache
            .lock()
            .map_err(|_| MicrosoftAuthError::Unavailable)?
            .remove(&(id, generation));
        Ok(())
    }
    async fn completed_grant(
        &self,
        attempt: Uuid,
        owner: Uuid,
    ) -> Result<CompletedMicrosoftGrant, MicrosoftAuthError> {
        let grant = self.repo.completed_grant(attempt, owner).await?;
        if grant.owner != owner {
            return Err(MicrosoftAuthError::InvalidAttempt);
        }
        if !has_required_scopes(&grant.scopes) {
            return Err(MicrosoftAuthError::MissingPermissions);
        }
        Ok(grant)
    }
    async fn start_link(
        &self,
        owner: Uuid,
        redirect_uri: String,
        return_uri: Option<String>,
        calendar_requested: bool,
        reconnect: Option<Uuid>,
    ) -> Result<LinkStart, MicrosoftAuthError> {
        let facts = self.repo.connection_facts(owner, reconnect).await?;
        if !self.connections_enabled && !facts.reconnecting {
            return Err(MicrosoftAuthError::NotConfigured);
        }
        if !facts.permits_connection() {
            return Err(MicrosoftAuthError::PaymentRequired);
        }
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        // OS-backed randomness; no caller-controlled OAuth secrets.
        let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
        let nonce = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
        let attempt = LinkAttempt {
            id: macro_uuid::generate_uuid_v7(),
            owner,
            identity_provider_id: self.provider.identity_provider_id().await?,
            redirect_uri,
            return_uri,
            verifier: Zeroizing::new(verifier),
            nonce,
            calendar_requested,
            expires_at: Utc::now() + Duration::minutes(10),
        };
        let authorization_url = self.provider.authorize(&attempt)?;
        self.repo.begin_link(&attempt).await?;
        Ok(LinkStart {
            id: attempt.id,
            authorization_url,
        })
    }

    async fn complete_link(
        &self,
        id: Uuid,
        identity_provider_id: &str,
        code: &str,
    ) -> Result<Option<String>, MicrosoftAuthError> {
        let attempt = self.repo.claim_link(id).await?;
        let result = async {
            if attempt.identity_provider_id != identity_provider_id {
                return Err(MicrosoftAuthError::InvalidAttempt);
            }
            let mut identity = self.provider.exchange(&attempt, code).await?;
            identity.scopes = normalize_scopes(identity.scopes);
            if !has_required_scopes(&identity.scopes) {
                return Err(MicrosoftAuthError::MissingPermissions);
            }
            if identity.subject_id.is_empty()
                || identity.mailbox_id.is_empty()
                || identity.tenant_id.is_empty()
                || email_validator::normalize_email(&identity.email).is_none()
            {
                return Err(MicrosoftAuthError::InvalidIdentity);
            }
            let owner = attempt.owner.to_string();
            // The owner is always the principal that initiated this attempt.
            let envelope = self
                .cipher
                .encrypt(
                    &owner,
                    &identity.email,
                    MicrosoftRefreshToken::new(identity.refresh_token.as_str().to_owned()),
                )
                .await
                .map_err(|_| MicrosoftAuthError::Unavailable)?;
            self.repo
                .complete_link(
                    &attempt,
                    &identity,
                    &envelope,
                    macro_uuid::generate_uuid_v7(),
                )
                .await?;
            Ok(attempt.return_uri.clone())
        }
        .await;
        if result.is_err() {
            let _ = self.repo.abandon_link(id).await;
        }
        result
    }

    async fn disconnect_token(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
    ) -> Result<MicrosoftAccessGrant, MicrosoftAuthError> {
        let grant = self
            .repo
            .disconnecting_grant(link_id, generation, sync_generation)
            .await?;
        self.token_for_grant(grant, false).await
    }

    async fn access_token(
        &self,
        link_id: Uuid,
        generation: i64,
        sync_generation: i64,
        force_refresh: bool,
    ) -> Result<MicrosoftAccessGrant, MicrosoftAuthError> {
        // Check revocation/generation on every call, including cache hits.
        let grant = self
            .repo
            .active_grant(link_id, generation, sync_generation)
            .await?;
        self.token_for_grant(grant, force_refresh).await
    }
}

impl<R: MicrosoftGrantRepository, P: MicrosoftIdentityProvider> MicrosoftAuthService<R, P> {
    async fn token_for_grant(
        &self,
        grant: StoredGrant,
        force_refresh: bool,
    ) -> Result<MicrosoftAccessGrant, MicrosoftAuthError> {
        let key = (grant.id, grant.generation);
        if force_refresh {
            self.cache
                .lock()
                .map_err(|_| MicrosoftAuthError::Unavailable)?
                .remove(&key);
        }
        if let Some(cached) = self
            .cache
            .lock()
            .map_err(|_| MicrosoftAuthError::Unavailable)?
            .get(&key)
            .filter(|cached| cached.expires_at > Utc::now())
        {
            return Ok(MicrosoftAccessGrant {
                token: cached.value.clone(),
                scopes: cached.scopes.clone(),
            });
        }
        let lease = macro_uuid::generate_uuid_v7();
        if !self.repo.acquire_refresh(&grant, lease).await? {
            return Err(MicrosoftAuthError::Busy);
        }
        let result = async {
            let refresh = self
                .cipher
                .decrypt(&grant.owner, &grant.email, &grant.envelope)
                .await
                .map_err(|_| MicrosoftAuthError::Unavailable)?;
            let mut refreshed = self.provider.refresh(&refresh).await?;
            // OAuth permits omitting scope when the granted set is unchanged.
            if refreshed.scopes.is_empty() {
                refreshed.scopes = grant.scopes.clone();
            }
            refreshed.scopes = normalize_scopes(refreshed.scopes);
            if !has_required_scopes(&refreshed.scopes) {
                return Err(MicrosoftAuthError::MissingPermissions);
            }
            let envelope = if let Some(replacement) = refreshed.refresh_token {
                self.cipher
                    .encrypt(&grant.owner, &grant.email, replacement)
                    .await
                    .map_err(|_| MicrosoftAuthError::Unavailable)?
            } else {
                grant.envelope.clone()
            };
            if !self
                .repo
                .finish_refresh(&grant, lease, &envelope, &refreshed.scopes)
                .await?
            {
                return Err(MicrosoftAuthError::Busy);
            }
            let lifetime = refreshed.expires_in.min(86_400).saturating_sub(120) as i64;
            let mut cache = self
                .cache
                .lock()
                .map_err(|_| MicrosoftAuthError::Unavailable)?;
            cache.retain(|_, token| token.expires_at > Utc::now());
            if cache.len() >= 10_000 {
                cache.clear();
            }
            cache.insert(
                key,
                CachedToken {
                    value: refreshed.access_token.clone(),
                    scopes: refreshed.scopes.clone(),
                    expires_at: Utc::now() + Duration::seconds(lifetime),
                },
            );
            Ok(MicrosoftAccessGrant {
                token: refreshed.access_token,
                scopes: refreshed.scopes,
            })
        }
        .await;
        if let Err(error) = &result {
            self.repo
                .release_refresh(
                    &grant,
                    lease,
                    matches!(
                        error,
                        MicrosoftAuthError::ReauthorizationRequired
                            | MicrosoftAuthError::MissingPermissions
                    ),
                )
                .await?;
        }
        result
    }
}
