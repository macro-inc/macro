use crate::domain::{
    models::GRANOLA_APP,
    ports::{Accounts, Result},
};
use async_trait::async_trait;
use connectors::{ApiConnectionsService, ConnectorId};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Whose Granola sync may run, as the connectors services decide it.
///
/// Sync reads Granola's REST API, so it follows only connections that give
/// API access. A Granola connection held through a source that provides
/// tools only (Macro Connect, for a user on it) gives none, so it is not
/// synced.
pub struct ConnectedAccounts<S>(pub Arc<S>);

/// Granola's catalog app.
pub(crate) fn granola() -> Result<ConnectorId> {
    Ok(ConnectorId::parse(GRANOLA_APP)?)
}

#[async_trait]
impl<S: ApiConnectionsService> Accounts for ConnectedAccounts<S> {
    async fn connected(&self, user: &MacroUserIdStr<'static>) -> Result<bool> {
        Ok(self.0.connection(user, &granola()?).await?.is_some())
    }

    async fn holders(&self) -> Result<Vec<MacroUserIdStr<'static>>> {
        Ok(self
            .0
            .holders(&granola()?)
            .await?
            .into_iter()
            .map(|handle| handle.user().clone())
            .collect())
    }
}
