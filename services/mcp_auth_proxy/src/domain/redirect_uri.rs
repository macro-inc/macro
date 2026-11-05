//! Policy governing which redirect URIs the broker will deliver a code to.

use std::collections::BTreeSet;

/// Hosts accepted for `http` redirect URIs, per RFC 8252 section 7.3. A code
/// sent to one of these is delivered to a listener on the resource owner's own
/// machine, so it never leaves the user who authorized it.
const LOOPBACK_HOSTS: [&str; 3] = ["localhost", "127.0.0.1", "[::1]"];

/// How far the broker trusts a redirect URI it is willing to deliver a code to.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RedirectTrust {
    /// A loopback listener or a host the deployment trusts. The code reaches
    /// the user who authorized it or a client Macro has vetted, so it is
    /// delivered without asking the user first.
    Trusted,
    /// Any other `https` host. Whoever registered the client chose it, so the
    /// user must approve that host on the consent screen before sign-in starts.
    RequiresConsent,
}

/// The policy deciding which destinations the broker will hand an
/// authorization code to, and which of those need the user's consent.
///
/// Dynamic client registration is open, so any caller can register a client and
/// choose its redirect URIs. Comparing a request against its own registration
/// therefore proves nothing on its own: an attacker registers a client pointing
/// at a callback they control and both sides of the comparison are theirs. This
/// policy is the check that does not depend on the requester: a loopback `http`
/// redirect or an `https` one on a host the deployment trusts is delivered
/// directly, any other `https` host only after the user approves it, and
/// everything else is refused.
#[derive(Clone, Debug)]
pub struct RedirectUriPolicy {
    allowed_https_hosts: BTreeSet<String>,
}

impl RedirectUriPolicy {
    /// Builds a policy trusting `https` redirect URIs on the given hosts
    /// without asking for consent.
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

    /// Returns how far the broker trusts `uri`, or `None` when it may never
    /// redirect there.
    pub fn trust(&self, uri: &str) -> Option<RedirectTrust> {
        let parsed = url::Url::parse(uri).ok()?;

        // RFC 6749 section 3.1.2 forbids a fragment on a redirection endpoint,
        // and credentials in the authority would change who the URI resolves
        // to without changing its host.
        if parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return None;
        }

        let host = parsed.host_str()?;

        match parsed.scheme() {
            "http" if LOOPBACK_HOSTS.contains(&host) => Some(RedirectTrust::Trusted),
            "https" if self.allowed_https_hosts.contains(host) => Some(RedirectTrust::Trusted),
            "https" => Some(RedirectTrust::RequiresConsent),
            _ => None,
        }
    }

    /// Returns the trusted `https` hosts, for logging at startup.
    pub fn allowed_https_hosts(&self) -> impl Iterator<Item = &str> {
        self.allowed_https_hosts.iter().map(String::as_str)
    }
}

#[cfg(test)]
mod test;
