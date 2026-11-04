use crate::domain::{
    models::GRANOLA_APP,
    ports::{Accounts, Result},
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::{
    models::{ConnectionProvider, PipedreamConnection},
    ports::{AppConnections, ConnectionStore},
};

/// Uses the Pipedream domain ports rather than reaching into its storage.
pub struct ConnectedAccounts<S>(pub S);

/// Sync reads Granola's REST API, which takes Pipedream's API-key account.
/// A Granola connection held by Macro Connect is an MCP grant, which that API
/// does not accept, so it is not synced.
fn syncable(connection: &PipedreamConnection) -> bool {
    connection.enabled && connection.provider == ConnectionProvider::Pipedream
}

#[async_trait]
impl<S: ConnectionStore + AppConnections> Accounts for ConnectedAccounts<S> {
    async fn account(&self, user: &MacroUserIdStr<'static>) -> Result<Option<String>> {
        Ok(self
            .0
            .load(user, GRANOLA_APP)
            .await
            .map_err(|error| rootcause::report!("Pipedream connection lookup failed: {error:?}"))?
            .filter(syncable)
            .map(|connection| connection.account_id))
    }
    async fn connected(&self) -> Result<Vec<(MacroUserIdStr<'static>, String)>> {
        Ok(self
            .0
            .list_enabled_for_app(GRANOLA_APP)
            .await
            .map_err(|error| rootcause::report!("Pipedream connection listing failed: {error:?}"))?
            .into_iter()
            .filter(syncable)
            .map(|connection| (connection.user_id, connection.account_id))
            .collect())
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn connection(provider: ConnectionProvider, enabled: bool) -> PipedreamConnection {
        PipedreamConnection {
            user_id: MacroUserIdStr::try_from_email("caller@example.com").unwrap(),
            app_slug: GRANOLA_APP.into(),
            server_name: "Granola".into(),
            account_id: "apn_1".into(),
            enabled,
            provider,
        }
    }

    #[test]
    fn only_enabled_pipedream_accounts_sync() {
        assert!(syncable(&connection(ConnectionProvider::Pipedream, true)));
        assert!(!syncable(&connection(ConnectionProvider::Pipedream, false)));
        assert!(!syncable(&connection(ConnectionProvider::Connect, true)));
    }
}
