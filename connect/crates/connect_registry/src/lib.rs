#![deny(missing_docs)]

//! Macro Connect's embedded, validated app catalog.

use std::{collections::HashSet, fmt, str::FromStr, sync::LazyLock};

use chrono::NaiveDate;
use serde::Deserialize;
use url::Url;

mod embedded;

#[cfg(test)]
mod test;

/// A stable catalog app identifier.
#[derive(Clone, Debug, Eq, Hash, PartialEq, Deserialize)]
#[serde(try_from = "String")]
pub struct AppId(String);

impl AppId {
    /// Parse a lowercase ASCII identifier, with internal digits, hyphens, or underscores.
    pub fn parse(value: &str) -> Result<Self, AppIdError> {
        let valid = value
            .bytes()
            .next()
            .is_some_and(|first| first.is_ascii_lowercase())
            && value.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
            });
        if valid {
            Ok(Self(value.to_owned()))
        } else {
            Err(AppIdError {
                value: value.to_owned(),
            })
        }
    }

    /// Return the stable identifier as text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for AppId {
    type Error = AppIdError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

impl FromStr for AppId {
    type Err = AppIdError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse(value)
    }
}

impl fmt::Display for AppId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// The supplied app identifier has an invalid shape.
#[derive(Debug, thiserror::Error)]
#[error("invalid app id: {value}")]
pub struct AppIdError {
    value: String,
}

/// A way to use a vendor connection.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    /// Connect through the vendor's MCP server.
    Mcp,
    /// Connect through the vendor's API.
    Api,
}

/// How Connect obtains an OAuth client for the vendor.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClientRegistration {
    /// Client ID metadata document.
    Cimd,
    /// Dynamic client registration.
    Dcr,
    /// A pre-registered Connect OAuth app.
    OwnApp,
    /// An API key when the vendor offers no OAuth.
    ApiKey,
}

/// Whether an app can be shown in the catalog.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// The app is available to connect.
    Live,
    /// The app is awaiting approval or conformance.
    Pending,
}

/// A vendor app in the Macro Connect catalog.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct App {
    /// Stable id, matching the app's directory name.
    pub id: AppId,
    /// Display name.
    pub name: String,
    /// One-line account capabilities, based on the vendor's tools.
    pub description: String,
    /// Supported ways to use this connection.
    pub access: Vec<Access>,
    /// Vendor-owned remote MCP URL.
    pub mcp_url: String,
    /// How Connect obtains an OAuth client.
    pub client_registration: ClientRegistration,
    /// Explicit OAuth scopes, if required by the vendor.
    pub scopes: Vec<String>,
    /// Pipedream app slugs replaced by this app.
    pub pipedream_app_slugs: Vec<String>,
    /// Catalog availability.
    pub status: Status,
    /// Date of the last OAuth metadata probe.
    #[serde(deserialize_with = "deserialize_date")]
    pub probed: NaiveDate,
    /// The vendor's embedded SVG icon, when available.
    #[serde(skip)]
    pub icon_svg: Option<&'static str>,
}

/// A malformed or inconsistent embedded catalog.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    /// An app TOML file could not be parsed.
    #[error("invalid app.toml for {directory}: {source}")]
    Parse {
        /// The containing app directory.
        directory: &'static str,
        /// TOML parse error.
        #[source]
        source: toml::de::Error,
    },
    /// An id differs from its directory name.
    #[error("app id {id} differs from directory {directory}")]
    IdMismatch {
        /// Parsed app id.
        id: AppId,
        /// Containing app directory.
        directory: &'static str,
    },
    /// Two app entries use one id.
    #[error("duplicate app id: {0}")]
    DuplicateId(AppId),
    /// A Pipedream slug maps to multiple apps.
    #[error("duplicate Pipedream app slug: {0}")]
    DuplicatePipedreamSlug(String),
    /// An MCP URL is not HTTPS or has a trailing slash.
    #[error("invalid MCP URL for {0}")]
    InvalidMcpUrl(AppId),
    /// The access list is not one of the catalog's supported combinations.
    #[error("invalid access for {0}")]
    InvalidAccess(AppId),
    /// A live app has no icon and is absent from the known exception list.
    #[error("live app has no icon: {0}")]
    MissingIcon(AppId),
}

struct EmbeddedApp {
    directory: &'static str,
    toml: &'static str,
    icon_svg: Option<&'static str>,
}

// Apps without a qualifying official SVG mark.
const NO_OFFICIAL_SVG_ICON: &[&str] = &["apollo", "klaviyo", "monday", "pipedrive"];

static APPS: LazyLock<Result<Vec<App>, RegistryError>> = LazyLock::new(load_apps);

fn deserialize_date<'de, D>(deserializer: D) -> Result<NaiveDate, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = toml::value::Datetime::deserialize(deserializer)?;
    NaiveDate::parse_from_str(&value.to_string(), "%Y-%m-%d").map_err(serde::de::Error::custom)
}

/// Return every embedded app, after parsing and validating the full catalog.
///
/// An error indicates a broken build artifact and should fail service startup.
pub fn all_apps() -> Result<&'static [App], &'static RegistryError> {
    APPS.as_ref().map(Vec::as_slice)
}

fn load_apps() -> Result<Vec<App>, RegistryError> {
    let mut apps = Vec::with_capacity(embedded::EMBEDDED.len());
    let mut ids = HashSet::new();
    let mut slugs = HashSet::new();

    for embedded in embedded::EMBEDDED {
        let mut app: App =
            toml::from_str(embedded.toml).map_err(|source| RegistryError::Parse {
                directory: embedded.directory,
                source,
            })?;
        app.icon_svg = embedded.icon_svg;

        if app.id.as_str() != embedded.directory {
            return Err(RegistryError::IdMismatch {
                id: app.id,
                directory: embedded.directory,
            });
        }
        if !ids.insert(app.id.clone()) {
            return Err(RegistryError::DuplicateId(app.id));
        }
        for slug in &app.pipedream_app_slugs {
            if !slugs.insert(slug.clone()) {
                return Err(RegistryError::DuplicatePipedreamSlug(slug.clone()));
            }
        }
        if app.mcp_url.ends_with('/')
            || !Url::parse(&app.mcp_url).is_ok_and(|url| url.scheme() == "https")
        {
            return Err(RegistryError::InvalidMcpUrl(app.id));
        }
        if !matches!(
            app.access.as_slice(),
            [Access::Mcp] | [Access::Mcp, Access::Api]
        ) {
            return Err(RegistryError::InvalidAccess(app.id));
        }
        if app.status == Status::Live
            && app.icon_svg.is_none()
            && !NO_OFFICIAL_SVG_ICON.contains(&app.id.as_str())
        {
            return Err(RegistryError::MissingIcon(app.id));
        }
        apps.push(app);
    }

    Ok(apps)
}
