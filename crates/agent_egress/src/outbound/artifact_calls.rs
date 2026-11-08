//! Macro's artifact endpoints on the document storage service, called as the
//! person who prompted the turn.
//!
//! The credential is a short-lived Macro API token minted the same way Macro's
//! own MCP server gets one ([`MacroApiTokens`]), so the storage service sees an
//! ordinary request from that user, attributed to the session's agent.

use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use url::Url;

use crate::domain::error::EgressError;
use crate::domain::model::{ArtifactEndpoint, BearerToken, UpstreamCall};
use crate::domain::ports::ArtifactCalls;
use crate::outbound::macro_mcp::MacroApiTokens;

#[cfg(test)]
mod test;

/// Addresses artifact endpoints under the storage service's base URL.
pub struct StorageArtifactCalls<Tokens> {
    tokens: Tokens,
    base_url: String,
    /// Whether a cleartext `base_url` is permitted. Set only by a composition
    /// root that has checked `ENVIRONMENT=local`.
    local_cleartext: bool,
}

impl<Tokens> StorageArtifactCalls<Tokens>
where
    Tokens: MacroApiTokens,
{
    /// Address endpoints under `base_url`, which may carry a gateway prefix
    /// (`https://gateway.macro.com/dss`). Refuses a cleartext URL unless
    /// `local_cleartext`, at boot rather than at the first call.
    pub fn new(tokens: Tokens, base_url: &Url, local_cleartext: bool) -> Result<Self, EgressError> {
        if base_url.scheme() != "https" && !local_cleartext {
            return Err(EgressError::InsecureUpstream(base_url.clone()));
        }

        Ok(Self {
            tokens,
            base_url: base_url.as_str().trim_end_matches('/').to_owned(),
            local_cleartext,
        })
    }
}

#[async_trait::async_trait]
impl<Tokens> ArtifactCalls for StorageArtifactCalls<Tokens>
where
    Tokens: MacroApiTokens,
{
    #[tracing::instrument(skip_all, err, fields(%user, %agent, %session, ?endpoint))]
    async fn resolve(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
        session: uuid::Uuid,
        endpoint: ArtifactEndpoint,
    ) -> Result<UpstreamCall, EgressError> {
        // Appended rather than `Url::join`ed, which would drop the gateway
        // prefix.
        let url =
            Url::parse(&format!("{}{}", self.base_url, endpoint.path())).map_err(|error| {
                EgressError::Internal(rootcause::report!(
                    "artifact endpoint is not a url: {error}"
                ))
            })?;
        let token = BearerToken::new(self.tokens.mint(user, agent, session).await?);

        if self.local_cleartext && url.scheme() != "https" {
            return Ok(UpstreamCall::bearer_over_local_cleartext(url, token));
        }
        UpstreamCall::bearer(url, token)
    }
}
