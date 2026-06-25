//! DNS-resolving implementation of [`EndpointValidator`].
//!
//! Implements the V1 endpoint checks from `webhooks_plan.md`: require `https`,
//! reject `localhost`/known-internal hostnames, restrict ports, and — at DNS
//! resolution time — reject hosts that resolve to private, link-local,
//! loopback, or cloud-metadata addresses.
//!
//! V1 SSRF posture is an **accepted risk**: this validates at resolution time
//! but does not pin the resolved IP for the eventual connection, nor
//! re-validate redirect targets. See the plan's "Accepted risks" section.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use url::Url;

use crate::domain::ports::{EndpointValidationError, EndpointValidator};

/// Hostnames (exact match, case-insensitive) that are always rejected.
const BLOCKED_HOSTS: &[&str] = &["localhost"];
/// Hostname suffixes that are always rejected (internal service domains).
const BLOCKED_HOST_SUFFIXES: &[&str] = &[".local", ".internal", ".localhost"];

/// Validates outbound webhook endpoints by parsing, host-listing, and resolving.
#[derive(Clone, Default)]
pub struct DnsEndpointValidator;

impl DnsEndpointValidator {
    /// Construct a validator.
    pub fn new() -> Self {
        Self
    }
}

impl EndpointValidator for DnsEndpointValidator {
    async fn validate(&self, raw_url: &str) -> Result<(), EndpointValidationError> {
        let url =
            Url::parse(raw_url).map_err(|e| EndpointValidationError::Malformed(e.to_string()))?;

        if url.scheme() != "https" {
            return Err(EndpointValidationError::NotHttps);
        }

        let host = url
            .host_str()
            .ok_or(EndpointValidationError::HostNotAllowed)?
            .to_ascii_lowercase();

        if host.is_empty()
            || BLOCKED_HOSTS.contains(&host.as_str())
            || BLOCKED_HOST_SUFFIXES
                .iter()
                .any(|suffix| host.ends_with(suffix))
        {
            return Err(EndpointValidationError::HostNotAllowed);
        }

        // If the host is itself a literal IP, validate it directly.
        if let Ok(ip) = host.parse::<IpAddr>() {
            if is_internal_ip(&ip) {
                return Err(EndpointValidationError::PrivateAddress);
            }
        }

        let port = url.port_or_known_default().unwrap_or(443);
        if !is_allowed_port(port) {
            return Err(EndpointValidationError::PortNotAllowed);
        }

        // Resolve and reject any internal address. (Resolution-time check only;
        // see the SSRF accepted-risk note above.)
        let mut resolved = tokio::net::lookup_host((host.as_str(), port))
            .await
            .map_err(|_| EndpointValidationError::Unresolvable)?
            .peekable();

        if resolved.peek().is_none() {
            return Err(EndpointValidationError::Unresolvable);
        }
        for addr in resolved {
            if is_internal_ip(&addr.ip()) {
                return Err(EndpointValidationError::PrivateAddress);
            }
        }

        Ok(())
    }
}

/// Webhooks deliver over TLS; allow the standard https port and high ports,
/// rejecting other privileged ports.
fn is_allowed_port(port: u16) -> bool {
    port == 443 || port >= 1024
}

/// Whether an IP address is private, loopback, link-local, multicast,
/// cloud-metadata, or otherwise not a safe public destination.
fn is_internal_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_internal_ipv4(v4),
        IpAddr::V6(v6) => is_internal_ipv6(v6),
    }
}

fn is_internal_ipv4(ip: &Ipv4Addr) -> bool {
    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
    {
        return true;
    }
    let octets = ip.octets();
    // Carrier-grade NAT (100.64.0.0/10).
    if octets[0] == 100 && (64..=127).contains(&octets[1]) {
        return true;
    }
    // "This host on this network" (0.0.0.0/8).
    if octets[0] == 0 {
        return true;
    }
    // Benchmarking range (198.18.0.0/15).
    if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
        return true;
    }
    false
}

fn is_internal_ipv6(ip: &Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() {
        return true;
    }
    // Both IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible
    // (::a.b.c.d) forms embed an IPv4 address that must be validated; otherwise a
    // host resolving to e.g. ::192.168.1.1 would slip past the IPv4 checks.
    // `to_ipv4` covers both ranges (loopback/unspecified are handled above).
    if let Some(v4) = ip.to_ipv4() {
        return is_internal_ipv4(&v4);
    }
    let segments = ip.segments();
    // Unique local addresses (fc00::/7).
    if (segments[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    // Link-local unicast (fe80::/10).
    if (segments[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    false
}

#[cfg(test)]
mod test;
