//! Password-free provider catalog and discovery policy for mail setup.
use super::models::{Discovery, DiscoverySteer, Endpoint, Error, TlsMode};
use async_trait::async_trait;
use macro_user_id::{
    cowlike::ArcCowStr,
    email::{Email, ReadEmailParts},
};
use regex::Regex;
use serde::Deserialize;
use std::{collections::BTreeSet, net::IpAddr, sync::LazyLock};

/// Resolve settings for an address without seeing its mailbox password.
#[async_trait]
pub trait DiscoveryProvider: Send + Sync {
    /// Return a catalog suggestion, live advertisement or manual fallback.
    async fn discover(&self, email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error>;
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    provider: Vec<Provider>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Provider {
    name: String,
    #[serde(default)]
    domains: Vec<String>,
    mx: Option<String>,
    imap: Option<String>,
    smtp: Option<String>,
    smtp_port: Option<u16>,
    #[serde(default)]
    imap_local_part: bool,
    #[serde(default)]
    smtp_local_part: bool,
    steer: Option<DiscoverySteer>,
    help_url: Option<String>,
}

type Entries = Vec<(Provider, Option<Regex>)>;
static CATALOG: LazyLock<Result<Entries, Error>> = LazyLock::new(|| {
    let catalog: Catalog =
        toml::from_str(include_str!("../../catalog/providers.toml")).map_err(|_| Error::Invalid)?;
    let mut domains = BTreeSet::new();
    catalog
        .provider
        .into_iter()
        .map(|p| {
            if !p
                .domains
                .iter()
                .all(|d| valid_host(d) && domains.insert(d.clone()))
                || !p.imap.as_deref().is_none_or(valid_host)
                || !p.smtp.as_deref().is_none_or(valid_host)
                || !p.smtp_port.is_none_or(|v| matches!(v, 465 | 587))
                || p.smtp.is_some() != p.smtp_port.is_some()
            {
                return Err(Error::Invalid);
            }
            let pattern =
                p.mx.as_deref()
                    .map(Regex::new)
                    .transpose()
                    .map_err(|_| Error::Invalid)?;
            Ok((p, pattern))
        })
        .collect()
});

/// A canonical public DNS name is required before constructing any discovery request.
pub fn valid_host(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && !host.to_ascii_lowercase().ends_with(".local")
        && !egress_guard::is_blocked_host(host)
        && host.parse::<IpAddr>().is_err()
        && host.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && !l.starts_with('-')
                && !l.ends_with('-')
                && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// Reserved example and test domains never trigger external discovery.
pub fn is_reserved_domain(domain: &str) -> bool {
    [
        "example.com",
        "example.net",
        "example.org",
        "test",
        "invalid",
        "example",
    ]
    .iter()
    .any(|reserved| domain == *reserved || domain.ends_with(&format!(".{reserved}")))
}

/// Validate the submitted address before extracting its domain for anonymous lookup.
pub fn address_domain(email: &Email<ArcCowStr<'_>>) -> Result<String, Error> {
    let domain = email.domain_part().to_ascii_lowercase();
    if email.email_str().len() > 254 || !valid_host(&domain) {
        return Err(Error::Invalid);
    }
    Ok(domain)
}

/// A missing or unrecognized configuration leaves both manual fields empty.
pub fn manual() -> Discovery {
    Discovery {
        provider: None,
        imap: None,
        smtp: None,
        steer: None,
        host_confirmation_required: true,
        help_url: None,
    }
}

impl Provider {
    fn suggestion(&self, email: &Email<ArcCowStr<'_>>) -> Discovery {
        let login = |local_part| {
            if local_part {
                email.local_part()
            } else {
                email.email_str()
            }
        };
        let endpoint = |host: &str, port, local_part| Endpoint {
            host: host.into(),
            port,
            tls: if matches!(port, 993 | 465) {
                TlsMode::Implicit
            } else {
                TlsMode::StartTls
            },
            username: login(local_part).into(),
        };
        Discovery {
            provider: Some(self.name.clone()),
            imap: self
                .imap
                .as_deref()
                .map(|h| endpoint(h, 993, self.imap_local_part)),
            smtp: self
                .smtp
                .as_deref()
                .zip(self.smtp_port)
                .map(|(h, p)| endpoint(h, p, self.smtp_local_part)),
            steer: self.steer,
            help_url: self.help_url.clone(),
            host_confirmation_required: false,
        }
    }
}

/// Catalog matches for an address's own domain avoid all network access.
pub fn discover(email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
    let domain = address_domain(email)?;
    Ok(CATALOG
        .as_ref()
        .map_err(|_| Error::Invalid)?
        .iter()
        .find(|(p, _)| p.domains.contains(&domain))
        .map_or_else(manual, |(p, _)| p.suggestion(email)))
}

/// Match the lowest-preference MX exchange to a known provider. Only a tightly
/// matched AWS WorkMail exchange contributes a region to a server hostname.
pub fn from_mx(email: &Email<ArcCowStr<'_>>, exchange: &str) -> Result<Option<Discovery>, Error> {
    address_domain(email)?;
    let exchange = exchange.trim_end_matches('.').to_ascii_lowercase();
    if !valid_host(&exchange) {
        return Ok(None);
    }
    if let Some((p, _)) = CATALOG
        .as_ref()
        .map_err(|_| Error::Invalid)?
        .iter()
        .find(|(_, r)| r.as_ref().is_some_and(|r| r.is_match(&exchange)))
    {
        return Ok(Some(p.suggestion(email)));
    }
    if let Some(region) = exchange
        .strip_prefix("inbound-smtp.")
        .and_then(|v| v.strip_suffix(".amazonaws.com"))
        && !region.contains('.')
    {
        let endpoint = |service, port| Endpoint {
            host: format!("{service}.mail.{region}.awsapps.com"),
            port,
            tls: TlsMode::Implicit,
            username: email.email_str().into(),
        };
        return Ok(Some(Discovery {
            provider: Some("AWS WorkMail".into()),
            imap: Some(endpoint("imap", 993)),
            smtp: Some(endpoint("smtp", 465)),
            host_confirmation_required: false,
            ..manual()
        }));
    }
    Ok(None)
}

#[cfg(test)]
mod test;
