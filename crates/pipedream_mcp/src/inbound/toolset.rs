//! Connector discovery's response shape and context, which code mode's
//! `macro.connectedApps.discover` returns.

use crate::domain::service::discovery::{ConnectorDiscovery, DiscoveryResult};
use schemars::JsonSchema;
use serde::Serialize;
use std::sync::Arc;

/// Dependencies for connector discovery.
pub struct ConnectorToolContext<D, S, N> {
    /// Domain service, constructed by the host.
    pub service: Arc<ConnectorDiscovery<D, S, N>>,
}

impl<D, S, N> Clone for ConnectorToolContext<D, S, N> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Discovery metadata and optional markup for a user-controlled auth flow.
#[derive(Debug, Clone, Serialize, JsonSchema, utoipa::ToSchema)]
pub struct DiscoverConnectorsResponse {
    /// Catalog or capability results.
    pub result: DiscoveryResult,
    /// Include verbatim only if an advertised tool supports the requested task.
    pub connect_markup: Option<String>,
}

impl From<DiscoveryResult> for DiscoverConnectorsResponse {
    /// Offer connect markup only for an unconnected app whose inspected tools
    /// could do something.
    fn from(result: DiscoveryResult) -> Self {
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
        Self {
            result,
            connect_markup,
        }
    }
}
