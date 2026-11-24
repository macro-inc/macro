//! What the native API source knows about each app it serves: its OAuth
//! endpoints, the scope Macro asks for, and the one origin its API calls may
//! go to.

use crate::domain::catalog::AUTODESK_SLUG;
use crate::domain::discovery::CatalogApp;
use crate::domain::models::ConnectorId;
use rootcause::Report;
use url::Url;

#[cfg(test)]
mod test;

/// Autodesk Platform Services' API origin, where its OAuth endpoints and
/// every Data Management API live. There is no test double for it, so the
/// host is fixed here rather than in `macro_service_urls`, and nothing
/// overrides it outside tests: a configurable origin would let a credential
/// be sent elsewhere.
const AUTODESK_API_ORIGIN: &str = "https://developer.api.autodesk.com";
/// The scope Macro asks Autodesk for: read hubs, projects, items and
/// versions.
const AUTODESK_SCOPE: &str = "data:read";
/// The name Autodesk goes by until the user renames it.
const AUTODESK_NAME: &str = "Autodesk";
/// Autodesk's logo, as Pipedream's directory serves it for its `autodesk`
/// app, so the catalog shows Autodesk the way it shows other apps.
const AUTODESK_ICON_URL: &str = "https://assets.pipedream.net/s.v0/app_9zh0we/logo/orig";

/// One app the native API source serves.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ApiApp {
    /// The app.
    pub(crate) id: ConnectorId,
    /// Its display name.
    pub(crate) name: String,
    /// Its logo, for the catalog.
    pub(crate) icon_url: Option<String>,
    /// One line on what connecting it enables, for the catalog.
    pub(crate) description: String,
    /// The OAuth authorization endpoint the browser is sent to.
    pub(crate) authorize_url: Url,
    /// The OAuth token endpoint.
    pub(crate) token_url: Url,
    /// The OAuth token revocation endpoint (RFC 7009).
    pub(crate) revoke_url: Url,
    /// The scope asked for.
    pub(crate) scope: String,
    /// The only origin a call through a connection to it may go to.
    pub(crate) api_origin: Url,
}

impl ApiApp {
    /// Autodesk Platform Services.
    pub(crate) fn autodesk() -> Result<Self, Report> {
        Self::autodesk_at(Url::parse(AUTODESK_API_ORIGIN)?)
    }

    /// Autodesk with its OAuth endpoints and API at `origin`: production's
    /// origin, or a test double's.
    pub(crate) fn autodesk_at(origin: Url) -> Result<Self, Report> {
        Ok(Self {
            id: ConnectorId::parse(AUTODESK_SLUG).map_err(Report::new)?,
            name: AUTODESK_NAME.to_owned(),
            icon_url: Some(AUTODESK_ICON_URL.to_owned()),
            description: "Fusion designs and files in Autodesk hubs and projects".to_owned(),
            authorize_url: origin.join("/authentication/v2/authorize")?,
            token_url: origin.join("/authentication/v2/token")?,
            revoke_url: origin.join("/authentication/v2/revoke")?,
            scope: AUTODESK_SCOPE.to_owned(),
            api_origin: origin,
        })
    }

    /// `url` when it is on this app's API origin (same scheme, host and
    /// port, no credentials in it), so the connection's bearer never leaves
    /// for another host. Anything else is refused.
    pub(crate) fn api_url(&self, url: &str) -> Result<Url, Report> {
        let parsed = Url::parse(url)
            .map_err(|_| rootcause::report!("an API call to {} needs an absolute URL", self.id))?;
        let same_origin = parsed.scheme() == self.api_origin.scheme()
            && parsed.host_str() == self.api_origin.host_str()
            && parsed.port_or_known_default() == self.api_origin.port_or_known_default()
            && parsed.username().is_empty()
            && parsed.password().is_none();
        if !same_origin {
            return Err(rootcause::report!(
                "refused to send {}'s credentials outside {}",
                self.id,
                self.api_origin.origin().ascii_serialization()
            ));
        }

        Ok(parsed)
    }

    /// The app as the catalog lists it.
    pub(crate) fn catalog_entry(&self) -> CatalogApp {
        CatalogApp {
            id: self.id.clone(),
            name: self.name.clone(),
            description: Some(self.description.clone()),
            icon_url: self.icon_url.clone(),
            categories: Vec::new(),
        }
    }
}
