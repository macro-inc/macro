//! DNS resolver that rejects private and internal connection targets.

use std::net::SocketAddr;

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use super::is_private_ip;

pub(super) struct PrivateIpFilteringResolver;

impl Resolve for PrivateIpFilteringResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let hostname = name.as_str().to_owned();
            let lookup = tokio::net::lookup_host(format!("{hostname}:0"))
                .await
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

            let filtered: Vec<SocketAddr> = lookup
                .filter(|address| {
                    let allowed = !is_private_ip(&address.ip());
                    if !allowed {
                        tracing::warn!(
                            host = %hostname,
                            ip = %address.ip(),
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

            let addresses: Addrs = Box::new(filtered.into_iter());
            Ok(addresses)
        })
    }
}
