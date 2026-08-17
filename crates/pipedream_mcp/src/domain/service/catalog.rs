//! Browsing the catalog of connectable MCP apps.
//!
//! The catalog merges two sources: a curated list of priority connectors we
//! actively promote, and Pipedream's app directory. Priority connectors rank
//! above organic directory results (clients may also render them as their
//! own section, via [`CatalogEntry::priority`]).

use crate::domain::models::{CatalogEntry, CatalogPage};
use crate::domain::ports::ConnectorDirectory;

#[cfg(test)]
mod test;

/// A curated connector we promote above organic directory results.
struct PriorityConnector {
    /// Pipedream app name slug (see the app's page at pipedream.com/apps).
    app_slug: &'static str,
    display_name: &'static str,
    /// Product-voice tagline shown instead of the directory's description.
    tagline: &'static str,
}

/// The promoted connectors, in the order they should rank.
///
/// This is the place to "advertise" a connector: entries here are pinned to
/// the top of the catalog (or shown in a dedicated featured section).
const PRIORITY_CONNECTORS: &[PriorityConnector] = &[
    PriorityConnector {
        app_slug: "linear",
        display_name: "Linear",
        tagline: "Create and update issues without leaving Macro.",
    },
    PriorityConnector {
        app_slug: "slack",
        display_name: "Slack",
        tagline: "Search conversations and post updates to channels.",
    },
    PriorityConnector {
        app_slug: "notion",
        display_name: "Notion",
        tagline: "Search your pages, databases, and wikis.",
    },
    PriorityConnector {
        app_slug: "posthog",
        display_name: "PostHog",
        tagline: "Query product analytics and user insights.",
    },
    PriorityConnector {
        app_slug: "github",
        display_name: "GitHub",
        tagline: "Give the agent access to your repos, PRs, and issues.",
    },
    PriorityConnector {
        app_slug: "datadog",
        display_name: "Datadog",
        tagline: "Query metrics, logs, and monitors.",
    },
    PriorityConnector {
        app_slug: "grafana",
        display_name: "Grafana",
        tagline: "Search dashboards and query your data sources.",
    },
];

/// Bounds for the page size, applied to whatever the client asks for.
const MAX_PAGE_SIZE: u32 = 50;
const DEFAULT_PAGE_SIZE: u32 = 20;

fn matches_priority(entry: &CatalogEntry) -> bool {
    PRIORITY_CONNECTORS
        .iter()
        .any(|p| p.app_slug == entry.app_slug)
}

fn priority_entry(connector: &PriorityConnector) -> CatalogEntry {
    CatalogEntry {
        app_slug: connector.app_slug.to_owned(),
        display_name: connector.display_name.to_owned(),
        description: Some(connector.tagline.to_owned()),
        icon_url: None,
        priority: true,
    }
}

/// Browse the connector catalog: curated priority connectors first, then
/// organic directory results, deduplicated.
///
/// Priority connectors matching `search` (or all of them, when browsing) are
/// pinned to the front of the first page; directory entries duplicating a
/// priority connector are dropped on every page so they never show up twice.
#[tracing::instrument(skip(directory), err)]
pub async fn browse_catalog<D: ConnectorDirectory>(
    directory: &D,
    search: Option<&str>,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> anyhow::Result<CatalogPage> {
    let search = search.map(str::trim).filter(|s| !s.is_empty());
    let limit = limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);

    let mut page = directory.search(search, cursor, limit).await?;
    page.entries.retain(|entry| !matches_priority(entry));

    // Priority connectors lead the first page only; on later pages they'd be
    // repeats of what the client already has.
    if cursor.is_none() {
        let needle = search.map(str::to_lowercase);
        let pinned = PRIORITY_CONNECTORS
            .iter()
            .filter(|p| match &needle {
                Some(needle) => {
                    p.display_name.to_lowercase().contains(needle)
                        || p.app_slug.to_lowercase().contains(needle)
                }
                None => true,
            })
            .map(priority_entry);
        page.entries.splice(0..0, pinned);
    }

    Ok(page)
}
