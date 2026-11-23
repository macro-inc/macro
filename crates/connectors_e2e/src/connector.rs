//! What `/connectors` answers, read the way the web reads it.

use serde::Deserialize;

/// One app or server added by URL, with its status as the server's rules
/// decide it. It never says which source holds the connection.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Connector {
    /// `app/{slug}` or `server/{encoded url}`: the path under `/connectors/`.
    pub key: String,
    /// What the connector is.
    pub target: Target,
    /// Its display name.
    pub name: String,
    /// Whether it can be used.
    pub status: Status,
    /// Whether the user can connect it.
    pub connectable: bool,
    /// Whether its connection provides MCP tools.
    pub mcp: bool,
    /// Whether its connection provides the app's API.
    pub api: bool,
    /// Whether an import from it is available.
    pub import_available: bool,
}

/// An app of the catalog or a server added by URL.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Target {
    /// A catalog app, by its canonical slug.
    App {
        /// The slug, aliases folded (`slack_v2` is `slack`).
        slug: String,
    },
    /// A server added by URL.
    Server {
        /// Its normalized URL.
        url: String,
    },
}

/// Whether a connector can be used.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Usable.
    Connected,
    /// Held but turned off.
    Disabled,
    /// Held, but its credential no longer works.
    NeedsReauth,
    /// Not held, or held through a source that does not count.
    NotConnected,
}

/// What to open to connect an app.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectStep {
    /// Open this page.
    OpenUrl {
        /// The page.
        url: String,
    },
    /// Open the embedded connect dialog with this token.
    #[serde(rename_all = "camelCase")]
    EmbeddedDialog {
        /// The dialog's token.
        token: String,
        /// When the token expires, RFC 3339.
        expires_at: String,
        /// The dialog's page.
        link: String,
    },
}

/// The key of the catalog app `slug`.
pub fn app_key(slug: &str) -> String {
    format!("app/{slug}")
}
