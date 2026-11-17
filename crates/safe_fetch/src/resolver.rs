//! The DNS resolver reqwest connects through.
//!
//! Checking addresses in a separate lookup before the request leaves a window:
//! the attacker's DNS server answers the check with a public address and the
//! connection's own lookup with an internal one (DNS rebinding). Here the
//! check happens inside the only lookup reqwest makes, so the addresses
//! validated are exactly the addresses connected to. IP-literal hosts never
//! reach a resolver; [`crate::SafeFetcher`] checks those when it validates
//! the URL.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use futures::future::BoxFuture;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use crate::address::AddressPolicy;

/// Looks a host name up. The production implementation is [`SystemLookup`];
/// tests substitute answers, including ones that change between calls.
///
/// Object-safe because reqwest stores its resolver as `Arc<dyn Resolve>`.
pub trait HostLookup: Send + Sync + 'static {
    /// Every address `host` resolves to.
    fn lookup(&self, host: &str) -> BoxFuture<'static, std::io::Result<Vec<IpAddr>>>;
}

/// The operating system's resolver (`getaddrinfo`).
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemLookup;

impl HostLookup for SystemLookup {
    fn lookup(&self, host: &str) -> BoxFuture<'static, std::io::Result<Vec<IpAddr>>> {
        let host = host.to_owned();
        Box::pin(async move {
            // The port is a placeholder; reqwest substitutes the URL's own.
            let addresses = tokio::net::lookup_host((host.as_str(), 0)).await?;
            Ok(addresses.map(|address| address.ip()).collect())
        })
    }
}

/// Why the resolver gave reqwest no addresses. Recovered from reqwest's error
/// chain by [`crate::FetchError`].
#[derive(Debug, thiserror::Error)]
pub(crate) enum RefusedResolution {
    #[error("{address} is not a public address")]
    AddressNotAllowed { address: IpAddr },
    #[error("host did not resolve")]
    Unresolved,
}

/// Resolves through a [`HostLookup`] and refuses the whole answer if any
/// address in it is not allowed. Refusing rather than filtering keeps a mixed
/// answer (one public, one internal address) from ever reaching the internal
/// one through happy-eyeballs fallback.
pub(crate) struct GuardedResolver {
    lookup: Arc<dyn HostLookup>,
    addresses: AddressPolicy,
}

impl GuardedResolver {
    pub(crate) fn new(lookup: Arc<dyn HostLookup>, addresses: AddressPolicy) -> Self {
        Self { lookup, addresses }
    }
}

impl Resolve for GuardedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let lookup = self.lookup.lookup(name.as_str());
        let addresses = self.addresses.clone();

        Box::pin(async move {
            let resolved = match lookup.await {
                Ok(resolved) => resolved,
                Err(error) => {
                    tracing::warn!(error = %error, "safe fetch host lookup failed");
                    return Err(RefusedResolution::Unresolved.into());
                }
            };

            if resolved.is_empty() {
                return Err(RefusedResolution::Unresolved.into());
            }

            if let Some(address) = resolved
                .iter()
                .copied()
                .find(|address| !addresses.allows(*address))
            {
                tracing::warn!(%address, "safe fetch refused a non-public address");
                return Err(RefusedResolution::AddressNotAllowed { address }.into());
            }

            let connectable: Addrs = Box::new(
                resolved
                    .into_iter()
                    .map(|address| SocketAddr::new(address, 0)),
            );
            Ok(connectable)
        })
    }
}
