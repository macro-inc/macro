use crate::domain::models::{ConnectProxyError, MacroUserIdStr, ProxyRequest, ProxyResponse};
use crate::domain::ports::{ConnectProxy, ConnectProxyTransport, ConnectionStore};
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Resolves a user's Pipedream connection for an app and relays requests
/// through the Connect API proxy as that connected account.
pub struct PipedreamConnectProxy<S, T> {
    store: Arc<S>,
    transport: Arc<T>,
}

impl<S, T> PipedreamConnectProxy<S, T> {
    /// Build the proxy over the connection store and the transport.
    pub fn new(store: Arc<S>, transport: Arc<T>) -> Self {
        Self { store, transport }
    }
}

impl<S: ConnectionStore, T: ConnectProxyTransport> ConnectProxy for PipedreamConnectProxy<S, T> {
    #[tracing::instrument(skip(self, user, request), fields(method = ?request.method))]
    async fn send(
        &self,
        user: &MacroUserIdStr<'static>,
        app_slug: &str,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        let connection = self
            .store
            .load(user, app_slug)
            .await
            .map_err(|e| anyhow::anyhow!("loading the {app_slug} connection: {e:?}"))?
            .ok_or_else(|| ConnectProxyError::NotConnected {
                app_slug: app_slug.to_string(),
            })?;
        self.transport.send(&connection, request).await
    }
}
