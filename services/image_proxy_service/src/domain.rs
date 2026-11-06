//! Cached domain logos, independent of the HTTP transport.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bytes::Bytes;

const CACHE_CAPACITY: usize = 256;
const CACHE_LIFETIME: Duration = Duration::from_secs(86_400);

/// A normalized DNS name, never a URL or IP literal.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct LogoDomain(String);

impl LogoDomain {
    /// Reject paths, ports, credentials, IP literals, and single-label hosts.
    pub fn parse(value: &str) -> Option<Self> {
        let domain = value.to_ascii_lowercase();
        if domain.len() > 253
            || !lazy_regex::regex!(
                r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$"
            )
            .is_match(&domain)
            || domain.parse::<std::net::IpAddr>().is_ok()
        {
            return None;
        }
        Some(Self(domain))
    }

    /// The canonical hostname.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A size-limited raster logo.
#[derive(Clone)]
pub struct Logo {
    pub bytes: Bytes,
    pub content_type: String,
}

/// An upstream capable of fetching a logo without exposing browser traffic.
pub trait LogoProvider: Clone + Send + Sync {
    type Error: std::error::Error + Send + Sync + 'static;

    fn fetch(&self, domain: &LogoDomain) -> impl Future<Output = Result<Logo, Self::Error>> + Send;
}

/// A bounded cache of public images; credentials and item data never enter it.
#[derive(Clone)]
pub struct LogoService<P> {
    provider: P,
    cache: Arc<Mutex<HashMap<LogoDomain, (Instant, Logo)>>>,
}

impl<P: LogoProvider> LogoService<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider,
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[tracing::instrument(skip_all, err)]
    pub async fn get(&self, domain: LogoDomain) -> Result<Logo, P::Error> {
        if let Ok(cache) = self.cache.lock()
            && let Some((created_at, logo)) = cache.get(&domain)
            && created_at.elapsed() < CACHE_LIFETIME
        {
            return Ok(logo.clone());
        }

        let logo = self.provider.fetch(&domain).await?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|_, (created_at, _)| created_at.elapsed() < CACHE_LIFETIME);
            if cache.len() >= CACHE_CAPACITY
                && let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
            cache.insert(domain, (Instant::now(), logo.clone()));
        }
        Ok(logo)
    }
}

#[cfg(test)]
mod test;
