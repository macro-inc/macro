//! Connect-time resolver that enforces the domain's blocked-address rules.
//!
//! The preflight check in `http_validator` gives users a clear message, but
//! the resolver is what the HTTP client connects through, so a DNS answer that
//! changes between preflight and connect is still filtered.

#[cfg(test)]
#[path = "address_guard_test.rs"]
mod address_guard_test;

use crate::domain::blocked_address::is_blocked_ip;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::{io, net::SocketAddr, sync::Arc};

/// Resolves names through the operating system resolver.
pub(super) struct SystemResolver;

impl Resolve for SystemResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            // reqwest replaces the port with the URL's port before connecting.
            let addresses = tokio::net::lookup_host((name.as_str(), 0)).await?;
            let addresses: Addrs = Box::new(addresses.collect::<Vec<_>>().into_iter());
            Ok(addresses)
        })
    }
}

/// Drops blocked addresses from every answer and fails when none remain.
pub(super) struct BlockedAddressFilteringResolver {
    pub(super) inner: Arc<dyn Resolve>,
}

impl Resolve for BlockedAddressFilteringResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        let resolving = self.inner.resolve(name);
        Box::pin(async move {
            let allowed: Vec<SocketAddr> = resolving
                .await?
                .filter(|address| !is_blocked_ip(address.ip()))
                .collect();
            if allowed.is_empty() {
                tracing::warn!(
                    host = %host,
                    "webhook endpoint resolved only to blocked addresses at connect time"
                );
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "webhook endpoint resolved only to blocked addresses",
                )
                .into());
            }
            let allowed: Addrs = Box::new(allowed.into_iter());
            Ok(allowed)
        })
    }
}
