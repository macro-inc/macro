//! Policy governing which redirect URIs the broker will deliver a code to.

use std::collections::BTreeSet;

/// Hosts accepted for `http` redirect URIs, per RFC 8252 section 7.3. A code
/// sent to one of these is delivered to a listener on the resource owner's own
/// machine, so it never leaves the user who authorized it.
const LOOPBACK_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// The set of destinations the broker is willing to hand an authorization code
/// to.
///
/// Dynamic client registration is open, so any caller can register a client and
/// choose its redirect URIs. Comparing a request against its own registration
/// therefore proves nothing on its own: an attacker registers a client pointing
/// at a callback they control and both sides of the comparison are theirs. This
/// policy is the check that does not depend on the requester — an `https`
/// redirect URI is only usable on a host the deployment trusts, and an `http`
/// one only on a loopback address.
#[derive(Clone, Debug)]
pub struct RedirectUriPolicy {
    allowed_https_hosts: BTreeSet<String>,
}

impl RedirectUriPolicy {
    /// Builds a policy trusting `https` redirect URIs on the given hosts.
    ///
    /// Hosts are matched exactly after lowercasing; subdomains of a trusted
    /// host are not themselves trusted.
    pub fn new<I, S>(allowed_https_hosts: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self {
            allowed_https_hosts: allowed_https_hosts
                .into_iter()
                .map(|host| host.as_ref().trim().to_ascii_lowercase())
                .filter(|host| !host.is_empty())
                .collect(),
        }
    }

    /// Returns whether the broker may redirect to `uri`.
    pub fn permits(&self, uri: &str) -> bool {
        let Ok(parsed) = url::Url::parse(uri) else {
            return false;
        };

        // RFC 6749 section 3.1.2 forbids a fragment on a redirection endpoint,
        // and credentials in the authority would change who the URI resolves
        // to without changing its host.
        if parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return false;
        }

        let Some(host) = parsed.host_str() else {
            return false;
        };

        match parsed.scheme() {
            "http" => LOOPBACK_HOSTS.contains(&host),
            "https" => self.allowed_https_hosts.contains(host),
            _ => false,
        }
    }

    /// Returns the trusted `https` hosts, for logging at startup.
    pub fn allowed_https_hosts(&self) -> impl Iterator<Item = &str> {
        self.allowed_https_hosts.iter().map(String::as_str)
    }
}

#[cfg(test)]
mod test;
