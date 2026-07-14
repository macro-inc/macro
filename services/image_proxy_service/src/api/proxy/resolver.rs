//! Custom reqwest DNS resolver that filters private / internal IP addresses
//! at connect time.
//!
//! This closes a DNS-rebinding TOCTOU window: [`assert_not_internal`] runs
//! once at preflight, but reqwest performs its own DNS lookup when it
//! actually opens the connection. An attacker controlling the authoritative
//! DNS server could return a public IP at preflight and an internal IP at
//! connect time. By plugging this resolver into [`reqwest::Client`] via
//! [`reqwest::ClientBuilder::dns_resolver`], the same private-IP filter is
//! enforced at the exact moment reqwest is about to connect — no window for
//! the answer to change between check and use.
//!
//! [`assert_not_internal`]: super::assert_not_internal

use std::net::SocketAddr;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use super::is_private_ip;

/// reqwest DNS resolver that drops private / internal IPs from the answer
/// set and errors out if nothing public remains.
pub(super) struct PrivateIpFilteringResolver;

impl Resolve for PrivateIpFilteringResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let hostname = name.as_str().to_owned();
            // Port is irrelevant for resolution; reqwest overrides it with
            // the URL's port before connecting. Use 0 as a placeholder.
            let lookup = match tokio::net::lookup_host(format!("{hostname}:0")).await {
                Ok(iter) => iter,
                Err(e) => {
                    return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
                }
            };

            let filtered: Vec<SocketAddr> = lookup
                .filter(|sa| {
                    let allowed = !is_private_ip(&sa.ip());
                    if !allowed {
                        tracing::warn!(
                            host = %hostname,
                            ip = %sa.ip(),
                            "dropped resolved private/internal IP from connection candidates"
                        );
                    }
                    allowed
                })
                .collect();

            if filtered.is_empty() {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!(
                        "all resolved IPs for {hostname} are private/internal; refusing to connect"
                    ),
                ))
                    as Box<dyn std::error::Error + Send + Sync>);
            }

            let iter: Addrs = Box::new(filtered.into_iter());
            Ok(iter)
        })
    }
}
