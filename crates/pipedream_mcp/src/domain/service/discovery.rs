//! Read-only discovery of apps and their actual MCP capabilities.

use crate::domain::{
    models::MacroUserIdStr,
    ports::{ConnectionStore, ConnectorCapabilities, ConnectorDirectory},
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[cfg(test)]
mod test;

const MAX_TOOLS: usize = 100;

/// Search by app name, then inspect a returned slug before recommending auth.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DiscoveryRequest {
    /// Find connectable apps by name.
    Search {
        /// App name, e.g. "LinkedIn" or "Linear", not a task description.
        query: String,
    },
    /// Verify capabilities and connection status for one catalog app.
    Inspect {
        /// Exact app slug from search results.
        app_slug: String,
    },
}

/// An advertised action, not a tool loaded into the current turn.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ConnectorTool {
    /// Upstream tool name.
    pub name: String,
    /// What the action supports.
    pub description: String,
}

/// A verified app identity from the directory.
#[derive(Debug, Serialize, JsonSchema)]
pub struct DiscoveredApp {
    /// Exact identity to inspect or connect.
    pub app_slug: String,
    /// Human-readable app name.
    pub name: String,
    /// Directory description; inspect tools to verify specific capabilities.
    pub description: Option<String>,
}

/// Discovery results never execute tools or change connections.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DiscoveryResult {
    /// Candidate apps; none has had its capabilities verified yet.
    Search {
        /// Matching apps.
        apps: Vec<DiscoveredApp>,
        /// Narrow the app name if this is true.
        more_results: bool,
    },
    /// Verified identity, capabilities and this caller's connection status.
    Inspect {
        /// App from the directory.
        app: DiscoveredApp,
        /// Whether this caller has an enabled connection.
        connected: bool,
        /// Advertised tools. Use SearchTools after connecting to load them.
        tools: Vec<ConnectorTool>,
        /// True when some advertised tools were omitted.
        tools_truncated: bool,
    },
}

/// Orchestrates discovery through directory, capability, and connection ports.
pub struct ConnectorDiscovery<D, S> {
    directory: Option<Arc<D>>,
    connections: Arc<S>,
}

impl<D: ConnectorDirectory + ConnectorCapabilities, S: ConnectionStore> ConnectorDiscovery<D, S> {
    /// An absent directory makes unconfigured deployments fail explicitly.
    pub fn new(directory: Option<Arc<D>>, connections: Arc<S>) -> Self {
        Self {
            directory,
            connections,
        }
    }

    /// Scope connection status to the authenticated caller. Inspection only
    /// lists metadata; it neither grants access nor invokes an app action.
    #[tracing::instrument(skip_all, err)]
    pub async fn discover(
        &self,
        user_id: &MacroUserIdStr<'static>,
        request: &DiscoveryRequest,
    ) -> anyhow::Result<DiscoveryResult> {
        let Some(directory) = &self.directory else {
            anyhow::bail!("Connector discovery is not configured on this deployment");
        };
        match request {
            DiscoveryRequest::Search { query } => {
                if query.trim().is_empty() {
                    anyhow::bail!("Search for an app name, such as Linear");
                }
                let page =
                    super::catalog::browse_catalog(directory.as_ref(), Some(query), None, Some(10))
                        .await?;
                Ok(DiscoveryResult::Search {
                    apps: page.entries.into_iter().map(DiscoveredApp::from).collect(),
                    more_results: page.next_cursor.is_some(),
                })
            }
            DiscoveryRequest::Inspect { app_slug } => {
                let Some(app) = directory.retrieve(app_slug).await? else {
                    anyhow::bail!("No connectable app has that slug; search the catalog first");
                };
                let connected = self
                    .connections
                    .load(user_id, &app.app_slug)
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("Could not check connector status: {error:?}")
                    })?
                    .is_some_and(|connection| connection.enabled);
                let mut tools = directory.tools(user_id, &app.app_slug).await?;
                let tools_truncated = tools.len() > MAX_TOOLS;
                tools.truncate(MAX_TOOLS);
                Ok(DiscoveryResult::Inspect {
                    app: app.into(),
                    connected,
                    tools,
                    tools_truncated,
                })
            }
        }
    }
}

impl From<crate::domain::models::CatalogEntry> for DiscoveredApp {
    fn from(app: crate::domain::models::CatalogEntry) -> Self {
        Self {
            app_slug: app.app_slug,
            name: app.display_name,
            description: app.description,
        }
    }
}
