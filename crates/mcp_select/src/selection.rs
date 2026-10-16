//! Provider identity and selection policy. Display names are editable and never identities.
use super::ConnectorRef;
use mcp_client::domain::models::McpServerRecord;
use pipedream_mcp::domain::models::PipedreamConnection;
use std::collections::HashSet;

// Keep provider endpoints aligned with the web native connection presets.
const PROVIDERS: &[ConnectorRef<'static>] = &[
    ConnectorRef {
        pipedream_app_slugs: &["github"],
        native_server_url: "https://api.githubcopilot.com/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["linear"],
        native_server_url: "https://mcp.linear.app/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["notion"],
        native_server_url: "https://mcp.notion.com/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["slack", "slack_v2"],
        native_server_url: "https://mcp.slack.com/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["posthog"],
        native_server_url: "https://mcp.posthog.com/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["datadog"],
        native_server_url: "https://mcp.datadoghq.com/mcp",
    },
    ConnectorRef {
        pipedream_app_slugs: &["grafana"],
        native_server_url: "https://mcp.grafana.com/mcp",
    },
];

fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

pub(super) fn native_matches(record: &McpServerRecord, connector: ConnectorRef<'_>) -> bool {
    record.enabled
        && record.credentials.is_some()
        && same_endpoint(&record.url, connector.native_server_url)
}

/// Choose enabled connections once per provider, preferring native credentials.
/// Custom native endpoints with no known hosted equivalent remain available.
pub fn select_connections(
    native: Vec<McpServerRecord>,
    mut pipedream: Vec<PipedreamConnection>,
) -> (Vec<McpServerRecord>, Vec<PipedreamConnection>) {
    let mut endpoints = HashSet::new();
    let native: Vec<_> = native
        .into_iter()
        .filter(|r| {
            r.enabled
                && (!PROVIDERS
                    .iter()
                    .any(|p| same_endpoint(&r.url, p.native_server_url))
                    || r.credentials.is_some())
                && endpoints.insert(r.url.trim_end_matches('/').to_owned())
        })
        .collect();
    // Prefer canonical aliases independently of database row order.
    pipedream.sort_by_key(|r| {
        PROVIDERS
            .iter()
            .find_map(|p| p.pipedream_app_slugs.iter().position(|s| *s == r.app_slug))
            .unwrap_or(0)
    });
    let mut providers = HashSet::new();
    pipedream.retain(|r| {
        if !r.enabled {
            return false;
        }
        let provider = PROVIDERS
            .iter()
            .find(|p| p.matches_pipedream_slug(&r.app_slug));
        if provider.is_some_and(|p| native.iter().any(|n| native_matches(n, *p))) {
            return false;
        }
        providers.insert(
            provider
                .map_or(r.app_slug.as_str(), |p| p.pipedream_app_slugs[0])
                .to_owned(),
        )
    });
    (native, pipedream)
}

#[cfg(test)]
mod test;
