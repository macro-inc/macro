use crate::domain::ports::{Accounts, Result};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::ports::ConnectionStore;

/// Uses the Pipedream domain port rather than reaching into its storage.
pub struct ConnectedAccounts<S>(pub S);

#[async_trait]
impl<S: ConnectionStore> Accounts for ConnectedAccounts<S> {
    async fn account(&self, user: &MacroUserIdStr<'static>) -> Result<Option<String>> {
        Ok(self
            .0
            .load(user, "granola")
            .await
            .map_err(|error| rootcause::report!("Pipedream connection lookup failed: {error:?}"))?
            .filter(|connection| connection.enabled)
            .map(|connection| connection.account_id))
    }
}
