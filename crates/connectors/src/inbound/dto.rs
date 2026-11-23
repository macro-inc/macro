//! What the `/connectors` API sends and receives.
//!
//! # The connector key
//!
//! Every app and server has one stable, URL-safe key string, `{kind}/{id}`,
//! which is also its path under `/connectors/`:
//!
//! - an app: `app/{slug}`, the app's canonical slug (`app/linear`; an alias
//!   such as `slack_v2` folds to `app/slack`);
//! - a server added by URL: `server/{id}`, where `id` is the server's
//!   normalized URL in unpadded base64url (RFC 4648 §5), so it never needs
//!   escaping (`https://mcp.example.com/mcp` is
//!   `server/aHR0cHM6Ly9tY3AuZXhhbXBsZS5jb20vbWNw`).
//!
//! Clients use the key as given and never build one, except
//! `app/{slug}` from a catalog entry's slug.

use crate::domain::discovery::{CatalogApp, OrgSetup};
use crate::domain::models::{
    ConnectStep, Connector, ConnectorId, ConnectorKey, InvalidConnectorId, InvalidServerUrl,
    ServerUrl, Status,
};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use utoipa::{IntoParams, ToSchema};

#[cfg(test)]
mod test;

/// Which kind of connector a key names.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectorKind {
    /// A catalog app.
    App,
    /// A server added by URL.
    Server,
}

impl fmt::Display for ConnectorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::App => "app",
            Self::Server => "server",
        })
    }
}

/// A connector key as it appears in a path: `/connectors/{kind}/{id}`.
#[derive(Clone, Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Path)]
pub struct ConnectorPath {
    /// `app` or `server`.
    kind: ConnectorKind,
    /// The app's slug, or the server's URL in unpadded base64url.
    id: String,
}

/// A key string that names no app or server.
#[derive(Debug, thiserror::Error)]
pub enum InvalidKey {
    /// The app part is not a slug.
    #[error(transparent)]
    App(#[from] InvalidConnectorId),
    /// The server part is not base64url.
    #[error("the server id is not unpadded base64url")]
    Encoding,
    /// The server part is not an http(s) URL.
    #[error(transparent)]
    Server(#[from] InvalidServerUrl),
}

impl ConnectorPath {
    /// The app or server this path names.
    pub(crate) fn key(&self) -> Result<ConnectorKey, InvalidKey> {
        match self.kind {
            ConnectorKind::App => Ok(ConnectorKey::App(ConnectorId::parse(&self.id)?)),
            ConnectorKind::Server => {
                let bytes = URL_SAFE_NO_PAD
                    .decode(&self.id)
                    .map_err(|_| InvalidKey::Encoding)?;
                let url = String::from_utf8(bytes).map_err(|_| InvalidKey::Encoding)?;
                Ok(ConnectorKey::Server(ServerUrl::parse(&url)?))
            }
        }
    }
}

/// The key string of an app or server; see the [module docs](self).
pub fn key_string(key: &ConnectorKey) -> String {
    match key {
        ConnectorKey::App(app) => format!("{}/{}", ConnectorKind::App, app.as_str()),
        ConnectorKey::Server(url) => format!(
            "{}/{}",
            ConnectorKind::Server,
            URL_SAFE_NO_PAD.encode(url.as_str())
        ),
    }
}

/// Where a user stands with an app or server.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, ToSchema, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConnectorStatus {
    /// Usable.
    Connected,
    /// The user turned it off.
    Disabled,
    /// Held, but its grant no longer works: connect it again.
    NeedsReauth,
    /// Not usable: never connected, or connected in a way that no longer
    /// counts. Connect it.
    NotConnected,
}

impl From<Status> for ConnectorStatus {
    fn from(status: Status) -> Self {
        match status {
            Status::Connected => Self::Connected,
            Status::Disabled => Self::Disabled,
            Status::NeedsReauth => Self::NeedsReauth,
            Status::NotConnected => Self::NotConnected,
        }
    }
}

/// What a key names, for display.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ConnectorTarget {
    /// A catalog app.
    App {
        /// Its canonical slug.
        slug: String,
    },
    /// A server added by URL.
    Server {
        /// Its normalized URL.
        url: String,
    },
}

impl From<&ConnectorKey> for ConnectorTarget {
    fn from(key: &ConnectorKey) -> Self {
        match key {
            ConnectorKey::App(app) => Self::App {
                slug: app.as_str().to_owned(),
            },
            ConnectorKey::Server(url) => Self::Server {
                url: url.as_str().to_owned(),
            },
        }
    }
}

/// What an app's import reads through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportSurface {
    /// The app's MCP tools.
    Mcp,
    /// The app's REST API.
    Api,
}

/// The apps Macro can import from, as the host declares them.
#[derive(Clone, Debug, Default)]
pub struct Importable(HashMap<ConnectorId, ImportSurface>);

impl Importable {
    /// No app can be imported from.
    pub fn new() -> Self {
        Self::default()
    }

    /// `app` can be imported from through `surface`.
    pub fn with(mut self, app: ConnectorId, surface: ImportSurface) -> Self {
        self.0.insert(app, surface);
        self
    }

    /// Whether the connector's connection provides what its import reads.
    fn available(&self, connector: &Connector) -> bool {
        let ConnectorKey::App(app) = connector.key() else {
            return false;
        };
        match self.0.get(app) {
            Some(ImportSurface::Mcp) => connector.surfaces().mcp(),
            Some(ImportSurface::Api) => connector.surfaces().api(),
            None => false,
        }
    }
}

/// One app or server and where the user stands with it. It never says
/// which provider holds the connection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = Connector)]
pub struct ConnectorResponse {
    /// The stable key, also its path under `/connectors/`.
    pub key: String,
    /// What the key names.
    pub target: ConnectorTarget,
    /// The display name.
    pub name: String,
    /// Where the user stands with it.
    pub status: ConnectorStatus,
    /// Whether the user can connect it from here.
    pub connectable: bool,
    /// Whether its connection provides MCP tools.
    pub mcp: bool,
    /// Whether its connection provides the app's REST API.
    pub api: bool,
    /// Whether Macro can import from it through its connection.
    pub import_available: bool,
}

impl ConnectorResponse {
    /// The connector as the web receives it.
    pub(crate) fn new(connector: &Connector, importable: &Importable) -> Self {
        Self {
            key: key_string(connector.key()),
            target: connector.key().into(),
            name: connector.name().to_owned(),
            status: connector.status().into(),
            connectable: connector.connectable(),
            mcp: connector.surfaces().mcp(),
            api: connector.surfaces().api(),
            import_available: importable.available(connector),
        }
    }
}

/// What the user must do next to connect. It never says whose flow it is.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[schema(as = ConnectStep)]
pub enum ConnectStepResponse {
    /// Open this page in a popup or browser tab. When it closes, call
    /// `POST /connectors/{kind}/{id}/complete`; it answers 404 until the
    /// connection exists, so it can be polled while the page is open.
    OpenUrl {
        /// The page.
        url: String,
    },
    /// Open the embedded connect dialog with this short-lived token. When it
    /// reports success, call `POST /connectors/{kind}/{id}/complete`.
    EmbeddedDialog {
        /// The token the dialog opens with.
        token: String,
        /// RFC 3339 expiry of the token.
        #[serde(rename = "expiresAt")]
        expires_at: String,
        /// A page that opens the same flow in a browser tab.
        link: String,
    },
}

impl From<ConnectStep> for ConnectStepResponse {
    fn from(step: ConnectStep) -> Self {
        match step {
            ConnectStep::OpenUrl(url) => Self::OpenUrl { url: url.into() },
            ConnectStep::EmbeddedDialog {
                token,
                expires_at,
                link,
            } => Self::EmbeddedDialog {
                token,
                expires_at,
                link: link.into(),
            },
        }
    }
}

/// Adding a server by URL.
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddServerRequest {
    /// The server's streamable HTTP URL.
    pub url: String,
    /// Its display name; its tools are listed under it.
    pub name: String,
}

/// Changing a connection. Each field present is applied.
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConnectorRequest {
    /// Turn it on or off.
    #[serde(default)]
    pub enabled: Option<bool>,
    /// A new display name.
    #[serde(default)]
    pub name: Option<String>,
}

/// Browsing the catalog.
#[derive(Clone, Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CatalogParams {
    /// Filter apps by name; omit to browse.
    #[serde(default)]
    pub search: Option<String>,
    /// The cursor from the previous page.
    #[serde(default)]
    pub cursor: Option<String>,
    /// Page size, 1 to 50 (default 20).
    #[serde(default)]
    pub limit: Option<u32>,
}

/// One connectable app.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = CatalogApp)]
pub struct CatalogAppResponse {
    /// Its connector key, `app/{slug}`.
    pub key: String,
    /// Its canonical slug.
    pub slug: String,
    /// The display name.
    pub name: String,
    /// One line on what connecting it enables.
    pub description: Option<String>,
    /// Its icon.
    pub icon_url: Option<String>,
    /// The directory's categories for it.
    pub categories: Vec<String>,
    /// Setup an admin of the user's organization must do at the vendor
    /// before the user connects it; absent when there is none.
    pub org_setup: Option<OrgSetupResponse>,
}

/// Setup an admin of the user's organization must do at the vendor.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = CatalogOrgSetup)]
pub struct OrgSetupResponse {
    /// One sentence on what the admin does and what happens without it.
    pub summary: String,
    /// The steps, in order.
    pub steps: Vec<String>,
    /// Where the admin does it.
    pub settings_url: String,
    /// Connecting fails until this is done. Otherwise it works with less
    /// access.
    pub required: bool,
    /// The URL the admin adds, when a step adds one.
    pub allowlist_url: Option<String>,
}

impl From<OrgSetup> for OrgSetupResponse {
    fn from(setup: OrgSetup) -> Self {
        Self {
            summary: setup.summary,
            steps: setup.steps,
            settings_url: setup.settings_url,
            required: setup.required,
            allowlist_url: setup.allowlist_url,
        }
    }
}

impl From<CatalogApp> for CatalogAppResponse {
    fn from(app: CatalogApp) -> Self {
        Self {
            key: key_string(&ConnectorKey::App(app.id.clone())),
            slug: app.id.as_str().to_owned(),
            name: app.name,
            description: app.description,
            icon_url: app.icon_url,
            categories: app.categories,
            org_setup: app.org_setup.map(OrgSetupResponse::from),
        }
    }
}

/// A page of the catalog, most popular first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
#[schema(as = CatalogPage)]
pub struct CatalogPageResponse {
    /// The apps, in display order.
    pub apps: Vec<CatalogAppResponse>,
    /// The cursor for the next page; absent on the last.
    pub next_cursor: Option<String>,
}
