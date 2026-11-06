//! A live credential for a stored MCP server, for a caller that stamps
//! headers itself rather than dialing through rmcp's client.
//!
//! [`crate::domain::models::McpServerRecord::connect`] hands rmcp a credential
//! store and lets its transport refresh lazily on the way through. A proxy
//! that only forwards bytes cannot do that - it needs the bearer *now*, as a
//! value - so this is the same refresh-and-persist story, inverted: read the
//! stored grant, hand back its token if it is still good, and otherwise run
//! rmcp's refresh through the same write-through store so the rotated grant
//! lands in the database for whoever reads it next.

use std::sync::Arc;

use oauth2::TokenResponse as _;
use rmcp::transport::auth::{AuthError, AuthorizationManager};

use crate::domain::models::{McpServerRecord, StoredCredentials};
use crate::domain::ports::McpServerStore;
use crate::domain::service::PersistingCredentialStore;

#[cfg(test)]
mod test;

/// How long before expiry a stored access token stops being handed out.
///
/// The same margin rmcp's own `get_access_token` applies, so a token this
/// returns is one rmcp would also have used as-is.
const REFRESH_BUFFER_SECS: u64 = 30;

/// What a stored server grant yields right now.
#[derive(Clone, PartialEq, Eq)]
pub enum ServerAccess {
    /// The server was added without connecting an account: it is dialed
    /// bare, exactly as the in-process client dials it.
    Anonymous,
    /// A bearer good for at least [`REFRESH_BUFFER_SECS`] more seconds.
    Bearer(String),
    /// The stored grant no longer yields a token - expired with no refresh
    /// token, refused on refresh, or an authorization that never finished -
    /// and only the owner re-authorizing can mend it.
    AuthorizationRequired,
}

impl std::fmt::Debug for ServerAccess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Anonymous => f.write_str("Anonymous"),
            Self::Bearer(_) => f.write_str("Bearer([REDACTED])"),
            Self::AuthorizationRequired => f.write_str("AuthorizationRequired"),
        }
    }
}

/// Whether `credentials` carry an access token good for at least
/// [`REFRESH_BUFFER_SECS`] more seconds, and that token if so.
///
/// `None` when the token is missing, expired, or about to be. A token whose
/// expiry is unknown - stored before `token_received_at` was tracked, or
/// issued without `expires_in` - counts as good, as it does in rmcp: there is
/// nothing to compare against, and the upstream will say if it is wrong.
pub fn unexpired_access_token(
    credentials: &StoredCredentials,
    now_epoch_secs: u64,
) -> Option<String> {
    let token = credentials.token_response.as_ref()?;
    if let (Some(expires_in), Some(received_at)) =
        (token.expires_in(), credentials.token_received_at)
    {
        let elapsed = now_epoch_secs.saturating_sub(received_at);
        let remaining = expires_in.as_secs().saturating_sub(elapsed);
        if remaining < REFRESH_BUFFER_SECS {
            return None;
        }
    }
    Some(token.access_token().secret().to_owned())
}

/// The credential `record` yields right now, refreshing and persisting the
/// grant through `store` if that is what it takes.
///
/// Only the refresh touches the network, and only when the stored token is
/// expired or about to be: rmcp's manager discovers the server's OAuth
/// metadata before it can refresh, and paying that on every call would turn
/// a header lookup into three round trips.
#[tracing::instrument(skip_all, err, fields(server = %record.server_name))]
pub async fn server_access<S: McpServerStore>(
    record: &McpServerRecord,
    store: Arc<S>,
) -> Result<ServerAccess, AuthError> {
    let Some(credentials) = &record.credentials else {
        return Ok(ServerAccess::Anonymous);
    };
    if credentials.token_response.is_none() {
        // An authorization that started and never finished: the client is
        // registered but no token was ever exchanged.
        return Ok(ServerAccess::AuthorizationRequired);
    }
    if let Some(token) = unexpired_access_token(credentials, now_epoch_secs()) {
        return Ok(ServerAccess::Bearer(token));
    }

    tracing::info!("stored access token has expired or is about to; refreshing");
    let mut manager = AuthorizationManager::new(&*record.url).await?;
    let credential_store = PersistingCredentialStore::new(record.clone(), store);
    credential_store.seed(credentials.clone()).await?;
    manager.set_credential_store(credential_store);
    manager.initialize_from_store().await?;

    match manager.get_access_token().await {
        Ok(token) => Ok(ServerAccess::Bearer(token)),
        Err(AuthError::AuthorizationRequired) => Ok(ServerAccess::AuthorizationRequired),
        Err(error) => Err(error),
    }
}

fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}
