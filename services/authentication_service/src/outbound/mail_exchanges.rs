//! Mail servers for an email domain, from its public MX records.

use std::time::Duration;

use hickory_resolver::{TokioResolver, proto::rr::RData};

/// How long one lookup may take before the domain counts as unknown.
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(2);

/// Looks up MX records with the system's DNS configuration.
#[derive(Clone)]
pub struct DnsMailExchanges {
    /// `None` when the system resolver could not be configured; every lookup
    /// then finds nothing.
    resolver: Option<TokioResolver>,
}

impl Default for DnsMailExchanges {
    fn default() -> Self {
        let resolver = TokioResolver::builder_tokio()
            .and_then(|mut builder| {
                builder.options_mut().timeout = LOOKUP_TIMEOUT;
                builder.options_mut().attempts = 1;
                builder.build()
            })
            .inspect_err(|error| {
                tracing::warn!(?error, "failed to configure DNS for mail server lookups");
            })
            .ok();
        Self { resolver }
    }
}

impl DnsMailExchanges {
    /// Mail server host names for `domain`; empty when none are found.
    #[tracing::instrument(name = "support_follow_up.mail_exchanges", skip(self))]
    pub async fn exchanges(&self, domain: &str) -> Vec<String> {
        let Some(resolver) = &self.resolver else {
            return Vec::new();
        };
        // A trailing dot makes the name fully qualified, so the system's search
        // domains are never tried.
        match resolver.mx_lookup(format!("{domain}.")).await {
            Ok(lookup) => lookup
                .answers()
                .iter()
                .filter_map(|record| match &record.data {
                    RData::MX(mx) => Some(mx.exchange.to_ascii()),
                    _ => None,
                })
                .collect(),
            Err(error) => {
                tracing::debug!(?error, "no mail servers found");
                Vec::new()
            }
        }
    }
}
