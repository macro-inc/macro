//! What the Pipedream source reads from Pipedream and from its rows.

pub(crate) use macro_user_id::user_id::MacroUserIdStr;

/// A user's connection to an app through Pipedream. Pipedream owns the
/// OAuth grant and tokens; the row stores only which app the user connected
/// and which Pipedream account holds the grant.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PipedreamConnection {
    /// The user who connected the app.
    pub user_id: MacroUserIdStr<'static>,
    /// Pipedream app name slug, e.g. `linear` or `notion`.
    pub app_slug: String,
    /// Human-readable display name, e.g. `Linear`.
    pub server_name: String,
    /// The Pipedream connected-account id (`apn_...`).
    pub account_id: String,
    /// Whether the connector is enabled for tool use.
    pub enabled: bool,
}

/// A short-lived token for opening Pipedream's hosted Connect UI.
#[derive(Clone, Debug)]
pub(crate) struct ConnectToken {
    /// The Connect token itself.
    pub token: String,
    /// RFC 3339 expiry of the token.
    pub expires_at: String,
    /// Shareable link that opens the same connect flow in a browser tab.
    pub connect_link_url: String,
}

/// A connected account as reported by Pipedream.
#[derive(Clone, Debug)]
pub(crate) struct PipedreamAccount {
    /// Pipedream's connected-account ID (`apn_...`).
    pub id: String,
    /// The external user ID the account was connected for (our user ID).
    pub external_user_id: Option<String>,
    /// The app the account belongs to (name slug, e.g. `linear`).
    pub app_slug: String,
    /// Human-readable app name, e.g. `Linear`.
    pub app_name: String,
    /// When Pipedream created the account, if it reported it.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// One connectable app advertised in the catalog.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CatalogEntry {
    /// Pipedream app name slug, e.g. `linear` — what gets connected.
    pub app_slug: String,
    /// Human-readable name to display, e.g. `Linear`.
    pub display_name: String,
    /// One-line description of what connecting the app enables.
    pub description: Option<String>,
    /// URL of the app's icon, when the directory provides one.
    pub icon_url: Option<String>,
    /// Categories assigned by the Pipedream app directory.
    pub categories: Vec<String>,
}

/// One page of catalog results.
#[derive(Clone, Debug, Default)]
pub(crate) struct CatalogPage {
    /// The entries on this page, in display order.
    pub entries: Vec<CatalogEntry>,
    /// Opaque cursor for fetching the next page. `None` on the last page.
    pub next_cursor: Option<String>,
}
