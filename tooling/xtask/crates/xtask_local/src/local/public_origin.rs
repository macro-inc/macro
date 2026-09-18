//! Validated browser origin for a trusted HTTPS reverse proxy. Internal endpoints
//! never use this value; the proxy terminates TLS outside the local stack.

use std::str::FromStr;

use anyhow::{Result, bail};

/// An HTTPS origin with no credentials, path, query, or fragment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicOrigin(String);

impl PublicOrigin {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for PublicOrigin {
    type Err = anyhow::Error;

    fn from_str(raw: &str) -> Result<Self> {
        let parsed = url::Url::parse(raw)?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || parsed.port() == Some(0)
            || raw.trim() != raw
            || raw.contains(['\\', '\n', '\r', '\t'])
        {
            bail!(
                "--public-origin must be an HTTPS origin: https://host[:port] (no credentials, path, query, or fragment)"
            );
        }
        if let Some(url::Host::Domain(host)) = parsed.host()
            && !host.split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
        {
            bail!("--public-origin requires an exact DNS hostname or IP address");
        }
        let origin = parsed.origin().ascii_serialization();
        // Reject paths normalized away by URL parsing (e.g. /a/..), and empty
        // userinfo. Accept a single optional trailing slash and canonicalize.
        let authority = raw.strip_prefix("https://").unwrap_or_default();
        if authority.trim_end_matches('/').contains(['/', '@', '%']) || authority.ends_with("//") {
            bail!("--public-origin must contain only an HTTPS authority");
        }
        Ok(Self(origin))
    }
}

#[cfg(test)]
mod test;
