//! Macro's own MCP server, answered on its own route.
//!
//! Unlike the owner's connected apps, this destination is not resolved from
//! their rows - every session gets it, because every session's owner is a
//! Macro user. What has to be resolved per owner is the credential:
//! `mcp_service` authenticates a *user*, so the proxy exchanges the session
//! owner's identity for a short-lived Macro API token and stamps that.
//!
//! The exchange is local signing with the same RS256 key
//! `authentication_service` uses - this process holds a key that can
//! impersonate any user at every service accepting Macro API tokens. That
//! custody is the cost of not putting a mint-for-anyone endpoint on the
//! network; what limits the blast radius is that every token minted here is
//! single-user, scoped to the session's owner, and minutes from expiry.

use chrono::{DateTime, Duration as ChronoDuration, TimeZone, Utc};
use lru::LruCache;
use macro_auth::macro_api_token::{EncodeMacroApiTokenArgs, encode_macro_api_token};
use macro_user_id::user_id::MacroUserIdStr;
use std::num::NonZeroUsize;
use std::sync::Mutex;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{BearerToken, McpDestination, UpstreamCall};
use crate::domain::ports::McpCredentials;

#[cfg(test)]
mod test;

/// How long before expiry a cached token stops being handed out. A tool call
/// can stream for a while, and a token that expires mid-call fails it.
const EXPIRY_MARGIN_MINUTES: i64 = 5;

/// Exchange a session owner's identity for a short-lived Macro API token.
///
/// Implementations own the whole exchange - including finding whatever else
/// the minting side needs to know about the owner beyond their id.
pub trait MacroApiTokens: Send + Sync {
    /// A token that acts as `owner`, and nobody else.
    fn mint(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<String, EgressError>> + Send;
}

/// Layers Macro's own MCP destination over another resolver.
///
/// [`McpDestination::Macro`] is answered here; everything else passes
/// straight through to `Inner`. The two destinations arrive from different
/// routes, so there is no name for a connected app to collide with.
pub struct WithMacroMcp<Inner, Tokens> {
    inner: Inner,
    tokens: Tokens,
    url: Url,
    /// Whether [`UpstreamCall::bearer_over_local_cleartext`] is permitted.
    /// Set only by a composition root that has checked `ENVIRONMENT=local`.
    local_cleartext: bool,
    /// Keyed by owner: the token *is* the owner's identity, so a cache hit
    /// for one owner can never answer for another. Bounded, so the map cannot
    /// grow with every owner ever seen; freshness still comes from each
    /// token's own expiry, never from cache residency.
    cached: Mutex<LruCache<MacroUserIdStr<'static>, CachedToken>>,
}

/// How many owners' tokens are kept at once. Far past any real concurrency;
/// the bound exists so entries for owners who never come back are eventually
/// evicted instead of holding expired credentials forever.
const CACHE_CAPACITY: usize = 1024;

#[derive(Clone)]
struct CachedToken {
    token: String,
    expires_at: DateTime<Utc>,
}

impl<Inner, Tokens> WithMacroMcp<Inner, Tokens>
where
    Inner: McpCredentials,
    Tokens: MacroApiTokens,
{
    /// Wrap `inner`, answering [`McpDestination::Macro`] at `url` with tokens
    /// from `tokens`.
    ///
    /// `local_cleartext` permits an `http` URL, and the caller must gate it on
    /// `ENVIRONMENT=local` - it exists for the one destination that never
    /// leaves the machine, the local stack's own `mcp-service` across the
    /// compose bridge. Refused here, at boot, rather than at the first tool
    /// call: a deployed environment with a cleartext URL is misconfigured,
    /// not unlucky.
    pub fn new(
        inner: Inner,
        tokens: Tokens,
        url: Url,
        local_cleartext: bool,
    ) -> Result<Self, EgressError> {
        if url.scheme() != "https" && !local_cleartext {
            return Err(EgressError::InsecureUpstream(url));
        }

        Ok(Self {
            inner,
            tokens,
            url,
            local_cleartext,
            cached: Mutex::new(LruCache::new(
                NonZeroUsize::new(CACHE_CAPACITY).expect("a nonzero capacity"),
            )),
        })
    }

    async fn token(&self, owner: &MacroUserIdStr<'static>) -> Result<String, EgressError> {
        {
            let mut cached = self.cached.lock().expect("token cache poisoned");
            match usable(cached.get(owner).cloned()) {
                Some(live) => {
                    tracing::debug!(%owner, "macro api token cache hit");
                    return Ok(live.token);
                }
                // A stale entry is evicted now rather than on capacity
                // pressure: there is no reason to keep a dead credential.
                None => {
                    let expired = cached.pop(owner).is_some();
                    tracing::debug!(%owner, expired, "macro api token cache miss; minting");
                }
            }
        }

        let token = self.tokens.mint(owner).await?;
        let expires_at = token_expiry(&token)?;
        self.cached.lock().expect("token cache poisoned").put(
            owner.clone(),
            CachedToken {
                token: token.clone(),
                expires_at,
            },
        );

        Ok(token)
    }
}

impl<Inner, Tokens> McpCredentials for WithMacroMcp<Inner, Tokens>
where
    Inner: McpCredentials,
    Tokens: MacroApiTokens,
{
    #[tracing::instrument(skip_all, err, fields(%owner, ?destination))]
    async fn resolve(
        &self,
        owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<UpstreamCall, EgressError> {
        if *destination != McpDestination::Macro {
            return self.inner.resolve(owner, destination).await;
        }

        let token = BearerToken::new(self.token(owner).await?);
        if self.local_cleartext && self.url.scheme() != "https" {
            Ok(UpstreamCall::bearer_over_local_cleartext(
                self.url.clone(),
                token,
            ))
        } else {
            UpstreamCall::bearer(self.url.clone(), token)
        }
    }
}

/// A cached token, if it will still be valid long enough to be worth using.
fn usable(cached: Option<CachedToken>) -> Option<CachedToken> {
    let cached = cached?;
    let deadline = Utc::now() + ChronoDuration::minutes(EXPIRY_MARGIN_MINUTES);
    (cached.expires_at > deadline).then_some(cached)
}

/// When a freshly minted token expires, read off its own `exp` claim.
///
/// Read *unverified*, deliberately: this process signed the token itself
/// moments ago, and it only needs the timestamp to schedule a re-mint -
/// `mcp_service` is what verifies the signature before anything acts on the
/// token.
fn token_expiry(token: &str) -> Result<DateTime<Utc>, EgressError> {
    use base64::Engine;

    let unreadable = |detail: &str| {
        EgressError::Upstream(rootcause::report!(
            "minted Macro API token is unreadable: {detail}"
        ))
    };

    let payload = token
        .split('.')
        .nth(1)
        .ok_or_else(|| unreadable("not a three-part JWT"))?;
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| unreadable("payload is not base64url"))?;

    #[derive(serde::Deserialize)]
    struct Claims {
        exp: i64,
    }
    let claims: Claims =
        serde_json::from_slice(&payload).map_err(|_| unreadable("payload has no exp claim"))?;

    Utc.timestamp_opt(claims.exp, 0)
        .single()
        .ok_or_else(|| unreadable("exp is not a timestamp"))
}

/// Mints tokens by signing them here, with the same key
/// `authentication_service` signs with.
///
/// Inline rather than a call to the auth service's mint endpoint: minting is
/// one signature over facts this process can read itself, the shared
/// `macro_auth` vocabulary exists exactly so key-holders sign locally (the
/// document-permission JWT follows the same pattern), and this process is
/// already the credential concentrator - it holds the GitHub App key and the
/// Pipedream project token on the same terms. The key can act as any user
/// wherever Macro API tokens are accepted, which is why everything minted
/// here is short-lived and names only the one owner the grant did.
pub struct MacroApiTokenSigner {
    pool: sqlx::PgPool,
    issuer: String,
    private_key: String,
}

/// How long a minted token lives. Short on purpose - the cache re-mints
/// freely - so a token that leaks out of a response somewhere is stale before
/// anyone can do much with it.
const MINTED_TOKEN_LIFETIME_SECONDS: usize = 900;

impl MacroApiTokenSigner {
    /// Build the signer over the database holding user rows, the token
    /// issuer, and the RSA signing key.
    pub fn new(
        pool: sqlx::PgPool,
        issuer: impl Into<String>,
        private_key: impl Into<String>,
    ) -> Self {
        Self {
            pool,
            issuer: issuer.into(),
            private_key: private_key.into(),
        }
    }
}

impl MacroApiTokens for MacroApiTokenSigner {
    #[tracing::instrument(skip_all, err, fields(%owner))]
    async fn mint(&self, owner: &MacroUserIdStr<'static>) -> Result<String, EgressError> {
        // The claims name the owner three ways - the FusionAuth root id, the
        // Macro user id, and their organization - and the session row only
        // carries the second, so the rest is read off their `User` row. An
        // owner with no row is a session created wrong, which is ours to fix,
        // not something the sandbox can retry its way out of.
        let (fusion_root_id, macro_user_id) =
            macro_db_client::user::get::get_user_macro_user_id_and_id_by_email(
                &self.pool,
                owner.email_str(),
            )
            .await
            .map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "session owner has no user row to mint a token for: {error}"
                ))
            })?;
        let organization_id = macro_db_client::user::get_user_organization::get_user_organization(
            self.pool.clone(),
            &macro_user_id,
        )
        .await
        .map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "could not read the session owner's organization: {error}"
            ))
        })?;

        encode_macro_api_token(EncodeMacroApiTokenArgs {
            fusionauth_id: fusion_root_id.to_string(),
            macro_user_id,
            organization_id,
            issuer: self.issuer.clone(),
            private_key: self.private_key.clone(),
            expiry_seconds: MINTED_TOKEN_LIFETIME_SECONDS,
        })
        .map_err(|error| {
            EgressError::Internal(rootcause::report!(
                "could not sign a Macro API token: {error}"
            ))
        })
    }
}
