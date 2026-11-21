//! The sign-in page an authorization server sends the user to.

use super::AddressPolicy;
use std::net::{Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

/// An authorization server's sign-in URL Macro refuses to open.
///
/// The server controls this URL, and the web app opens it in a window of its
/// own origin, so a `javascript:` or `data:` URL would run as Macro. Only
/// https passes, plus http on loopback where local servers are allowed.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum UnsafeAuthorizationUrl {
    /// The URL does not parse.
    #[error("the authorization server's sign-in URL does not parse")]
    Unparseable,
    /// The URL's scheme (and host) are not allowed.
    #[error(
        "the authorization server's sign-in URL must be https (or http on loopback locally), not `{0}:`"
    )]
    Scheme(String),
}

/// Check that `url` is a sign-in page the user's browser may open. Loopback
/// http passes only under [`AddressPolicy::AnyAddress`], i.e. local
/// development, the same hosts the web app accepts.
pub fn vet_authorization_url(
    url: &str,
    policy: AddressPolicy,
) -> Result<(), UnsafeAuthorizationUrl> {
    let parsed = Url::parse(url).map_err(|_| UnsafeAuthorizationUrl::Unparseable)?;
    let loopback = match parsed.host() {
        Some(Host::Domain(domain)) => domain == "localhost",
        Some(Host::Ipv4(address)) => address == Ipv4Addr::LOCALHOST,
        Some(Host::Ipv6(address)) => address == Ipv6Addr::LOCALHOST,
        None => false,
    };
    match parsed.scheme() {
        "https" => Ok(()),
        "http" if loopback && policy == AddressPolicy::AnyAddress => Ok(()),
        scheme => Err(UnsafeAuthorizationUrl::Scheme(scheme.to_owned())),
    }
}

#[cfg(test)]
mod test;
