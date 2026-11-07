//! Overlaid catalog apps, answered from the native MCP stack.

use crate::selection::same_endpoint;
use macro_user_id::user_id::MacroUserIdStr;
use mcp_client::domain::models::McpServerRecord;
use mcp_client::domain::ports::McpServerStore;
use pipedream_mcp::domain::models::ConnectorOverlay;
use pipedream_mcp::domain::ports::OverlayConnections;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The user's native connection to `overlay`'s server: enabled and
/// authorized, matched by endpoint.
pub fn overlay_connection<'a>(
    native: &'a [McpServerRecord],
    overlay: &ConnectorOverlay,
) -> Option<&'a McpServerRecord> {
    native.iter().find(|record| {
        record.enabled
            && record.credentials.is_some()
            && same_endpoint(&record.url, &overlay.server_url)
    })
}

/// [`OverlayConnections`] over the native server store. `None` is a
/// deployment without the native stack, where nothing is ever connected.
pub struct NativeOverlayConnections<N> {
    native_store: Option<Arc<N>>,
}

impl<N> NativeOverlayConnections<N> {
    /// Read connections from `native_store`.
    pub fn new(native_store: Option<Arc<N>>) -> Self {
        Self { native_store }
    }
}

impl<N: McpServerStore> OverlayConnections for NativeOverlayConnections<N> {
    #[tracing::instrument(skip(self, user), err)]
    async fn connected_name(
        &self,
        user: &MacroUserIdStr<'static>,
        overlay: &ConnectorOverlay,
    ) -> anyhow::Result<Option<String>> {
        let Some(store) = &self.native_store else {
            return Ok(None);
        };
        let native = store
            .list(user)
            .await
            .map_err(|e| anyhow::anyhow!("mcp store: {e:?}"))?;
        Ok(overlay_connection(&native, overlay).map(|record| record.server_name.clone()))
    }
}
