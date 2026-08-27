//! Macro's own MCP server, answered on its own route.
//!
//! Unlike the owner's connected apps, this destination is not resolved from
//! their rows - every session gets it, because every session's owner is a
//! Macro user. What has to be resolved per owner is the credential:
//! `mcp_service` authenticates a *user*, so the proxy exchanges the session
//! owner's identity for a short-lived Macro API token and stamps that.
//!
//! The exchange is deliberately a call to `authentication_service`'s existing
//! mint endpoint rather than local signing. The RS256 key behind Macro API
//! tokens can impersonate any user at every service that accepts them; custody
//! stays where it is, and the only thing this process ever holds is a
//! single-user token already near its expiry.

use chrono::{DateTime, Duration as ChronoDuration, TimeZone, Utc};
use dashmap::DashMap;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
};
use macro_user_id::user_id::MacroUserIdStr;
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
    /// for one owner can never answer for another.
    cached: DashMap<MacroUserIdStr<'static>, CachedToken>,
}

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
            cached: DashMap::new(),
        })
    }

    async fn token(&self, owner: &MacroUserIdStr<'static>) -> Result<String, EgressError> {
        if let Some(cached) = usable(self.cached.get(owner).map(|entry| entry.clone())) {
            return Ok(cached.token);
        }

        let token = self.tokens.mint(owner).await?;
        let expires_at = token_expiry(&token)?;
        self.cached.insert(
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
/// Read *unverified*, deliberately: this process just received the token from
/// `authentication_service` over an internally-authenticated call, and it only
/// needs the timestamp to schedule a re-mint - `mcp_service` is what verifies
/// the signature before anything acts on the token.
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

/// Mints tokens through `authentication_service`'s existing endpoint, as an
/// internal caller acting for the owner.
///
/// The endpoint identifies the acting user by Macro id *and* FusionAuth id,
/// and the session row only carries the first - so this adapter looks the
/// second up from the owner's `User` row before it dials.
pub struct AuthenticationServiceTokens {
    http: reqwest::Client,
    base_url: String,
    internal_api_key: String,
    pool: sqlx::PgPool,
}

impl AuthenticationServiceTokens {
    /// Build the exchange over `authentication_service`'s address, the
    /// internal API key, and the database holding user rows.
    pub fn new(
        base_url: impl Into<String>,
        internal_api_key: impl Into<String>,
        pool: sqlx::PgPool,
    ) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_owned(),
            internal_api_key: internal_api_key.into(),
            pool,
        }
    }
}

impl MacroApiTokens for AuthenticationServiceTokens {
    #[tracing::instrument(skip_all, err, fields(%owner))]
    async fn mint(&self, owner: &MacroUserIdStr<'static>) -> Result<String, EgressError> {
        // The session row names the owner as `macro|<email>`; the FusionAuth
        // id lives on their `User` row. An owner with no row is a session
        // created wrong, which is ours to fix - not something the sandbox can
        // retry its way out of.
        let (_, fusion_user_id) =
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

        let response = self
            .http
            .get(format!("{}/jwt/macro_api_token", self.base_url))
            .header(INTERNAL_API_KEY_HEADER, &self.internal_api_key)
            .header(INTERNAL_MACRO_USER_ID_HEADER, owner.as_ref())
            .header(INTERNAL_FUSIONAUTH_USER_ID_HEADER, &fusion_user_id)
            .send()
            .await
            .map_err(|error| {
                EgressError::Upstream(rootcause::report!(
                    "could not reach authentication_service to mint a token: {error}"
                ))
            })?;

        let status = response.status();
        if !status.is_success() {
            return Err(EgressError::Upstream(rootcause::report!(
                "authentication_service refused to mint a token: {status}"
            )));
        }

        #[derive(serde::Deserialize)]
        struct Minted {
            macro_api_token: String,
        }
        let minted: Minted = response.json().await.map_err(|error| {
            EgressError::Upstream(rootcause::report!(
                "authentication_service answered unintelligibly: {error}"
            ))
        })?;

        Ok(minted.macro_api_token)
    }
}
