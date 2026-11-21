//! The sign-in page an authorization server sends the user to.

use url::{Host, Url};

/// An authorization server's sign-in URL Macro refuses to open.
///
/// The server controls this URL, and the web app opens it in a window of its
/// own origin, so a `javascript:` or `data:` URL would run as Macro. Only
/// https passes, plus http on a loopback host for a local server.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
#[error(
    "the authorization server's sign-in URL must be https (or http on loopback), not `{scheme}:`"
)]
pub struct UnsafeAuthorizationUrl {
    /// The refused URL's scheme.
    pub scheme: String,
}

/// Check that `url` is a sign-in page the user's browser may open.
pub fn vet_authorization_url(url: &str) -> Result<(), UnsafeAuthorizationUrl> {
    let Ok(parsed) = Url::parse(url) else {
        return Err(UnsafeAuthorizationUrl {
            scheme: String::new(),
        });
    };
    let loopback = match parsed.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if loopback => Ok(()),
        scheme => Err(UnsafeAuthorizationUrl {
            scheme: scheme.to_owned(),
        }),
    }
}

#[cfg(test)]
mod test;
