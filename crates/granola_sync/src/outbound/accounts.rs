use crate::domain::ports::{Accounts, Result};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::{AppConnections, ConnectionStore};

const APP: &str = "granola";

/// Uses the Pipedream domain ports rather than reaching into its storage.
pub struct ConnectedAccounts<S>(pub S);

#[async_trait]
impl<S: ConnectionStore + AppConnections> Accounts for ConnectedAccounts<S> {
    async fn account(&self, user: &MacroUserIdStr<'static>) -> Result<Option<String>> {
        Ok(self
            .0
            .load(user, APP)
            .await
            .map_err(|error| rootcause::report!("Pipedream connection lookup failed: {error:?}"))?
            .filter(|connection| connection.enabled)
            .map(|connection| connection.account_id))
    }
    async fn connected(&self) -> Result<Vec<(MacroUserIdStr<'static>, String)>> {
        Ok(self
            .0
            .list_enabled_for_app(APP)
            .await
            .map_err(|error| rootcause::report!("Pipedream connection listing failed: {error:?}"))?
            .into_iter()
            .map(|connection| (connection.user_id, connection.account_id))
            .collect())
    }
}
