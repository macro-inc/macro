//! Passive provider classification uses catalog entries and domain-only DNS.

use crate::domain::{
    discovery,
    models::{Discovery, Error},
};
use hickory_resolver::{TokioResolver, proto::rr::RData};
use macro_user_id::{cowlike::ArcCowStr, email::Email};
use std::{sync::OnceLock, time::Duration};
use tokio::{sync::Semaphore, time::timeout};

const MX_LIMIT: usize = 32;
const DNS_BUDGET: Duration = Duration::from_secs(3);

/// Bounded passive lookup, deliberately without an HTTP/autoconfig client.
pub struct ProviderHints {
    resolver: OnceLock<TokioResolver>,
    slots: Semaphore,
}

impl Default for ProviderHints {
    fn default() -> Self {
        Self {
            resolver: OnceLock::new(),
            slots: Semaphore::new(32),
        }
    }
}

impl ProviderHints {
    /// Disclose only the validated domain in DNS, never an address or credentials.
    #[tracing::instrument(skip_all)]
    pub async fn lookup(&self, email: &Email<ArcCowStr<'_>>) -> Result<Discovery, Error> {
        let direct = discovery::discover(email)?;
        if direct.provider.is_some() {
            return Ok(direct);
        }
        let domain = discovery::address_domain(email)?;
        if discovery::is_reserved_domain(&domain) {
            return Ok(direct);
        }
        let Ok(_slot) = self.slots.try_acquire() else {
            return Ok(direct);
        };
        if self.resolver.get().is_none() {
            let Some(resolver) = TokioResolver::builder_tokio()
                .ok()
                .and_then(|b| b.build().ok())
            else {
                return Ok(direct);
            };
            let _ = self.resolver.set(resolver);
        }
        let Some(resolver) = self.resolver.get() else {
            return Ok(direct);
        };
        let Ok(Ok(answer)) = timeout(DNS_BUDGET, resolver.mx_lookup(format!("{domain}."))).await
        else {
            return Ok(direct);
        };
        let records = answer
            .answers()
            .iter()
            .filter_map(|record| {
                if let RData::MX(mx) = &record.data {
                    Some((mx.preference, mx.exchange.to_ascii()))
                } else {
                    None
                }
            })
            .take(MX_LIMIT + 1)
            .collect::<Vec<_>>();
        Ok(classify_mx(email, &records))
    }
}

fn classify_mx(email: &Email<ArcCowStr<'_>>, records: &[(u16, String)]) -> Discovery {
    if records.len() > MX_LIMIT {
        return discovery::manual();
    }
    let Some(priority) = records.iter().map(|(priority, _)| *priority).min() else {
        return discovery::manual();
    };
    let mut hint: Option<Discovery> = None;
    for (_, exchange) in records.iter().filter(|(p, _)| *p == priority) {
        let Some(found) = discovery::from_mx(email, exchange).ok().flatten() else {
            return discovery::manual();
        };
        if hint
            .as_ref()
            .is_some_and(|previous| previous.provider != found.provider)
        {
            return discovery::manual();
        }
        hint = Some(found);
    }
    hint.unwrap_or_else(discovery::manual)
}

#[cfg(test)]
mod test;
