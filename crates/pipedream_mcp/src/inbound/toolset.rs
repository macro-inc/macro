//! Thin AI adapter for connector discovery.

use crate::domain::{
    ports::{ConnectionStore, ConnectorCapabilities, ConnectorDirectory},
    service::discovery::{ConnectorDiscovery, DiscoveryRequest, DiscoveryResult},
};
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Dependencies for the discovery tool.
pub struct ConnectorToolContext<D, S> {
    /// Domain service, constructed by the host.
    pub service: Arc<ConnectorDiscovery<D, S>>,
}

impl<D, S> Clone for ConnectorToolContext<D, S> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Discover apps when the current tools cannot perform the user's task.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "DiscoverConnectors",
    description = "Find an integration when SearchTools cannot find the capability needed for the user's task. Search by app name, then inspect a returned app_slug to see its actual tools and connection status. Only recommend connecting if an advertised tool supports the task; an app's name alone is not evidence. Inspection does not load or execute tools. If suitable and unconnected, include the returned connect_markup in your reply and explain what connecting enables. After connection, use SearchTools again in the same chat to load and call the new tools."
)]
pub struct DiscoverConnectors {
    /// Search for an app, or inspect a catalog result's actual capabilities.
    pub request: DiscoveryRequest,
}

/// Discovery metadata and optional markup for a user-controlled auth flow.
#[derive(Debug, Serialize, JsonSchema)]
pub struct DiscoverConnectorsResponse {
    /// Catalog or capability results.
    pub result: DiscoveryResult,
    /// Include verbatim only if an advertised tool supports the requested task.
    pub connect_markup: Option<String>,
}

impl ToolAnnotated for DiscoverConnectors {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Discover connectors");
}

#[async_trait]
impl<D: ConnectorDirectory + ConnectorCapabilities, S: ConnectionStore>
    AsyncTool<ConnectorToolContext<D, S>> for DiscoverConnectors
{
    type Output = DiscoverConnectorsResponse;

    #[tracing::instrument(skip_all, err)]
    async fn call(
        &self,
        context: ServiceContext<ConnectorToolContext<D, S>>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let result = context
            .service
            .discover(&request.user_id, &self.request)
            .await
            .map_err(|error| ToolCallError {
                description: error.to_string(),
                internal_error: error,
            })?;
        let connect_markup = match &result {
            DiscoveryResult::Inspect {
                app,
                connected: false,
                tools,
                ..
            } if !tools.is_empty() => {
                let payload = serde_json::json!({"appSlug": app.app_slug, "name": app.name});
                Some(format!("<m-connect-app>{payload}</m-connect-app>"))
            }
            _ => None,
        };
        Ok(DiscoverConnectorsResponse {
            result,
            connect_markup,
        })
    }
}
