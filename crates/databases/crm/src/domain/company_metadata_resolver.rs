//! Outbound port for resolving [`DomainMetadata`] (display name,
//! description, icon URL) from a contact's email domain.
//!
//! The default adapter (`crm::outbound::unfurl_resolver`) fetches
//! `https://{domain}` via the unfurl service and maps its
//! [`unfurl::domain::models::GetUnfurlResponse`] onto [`DomainMetadata`].
//! Keeping the port abstract here lets the crm domain stay free of HTTP
//! / scraping concerns and lets the resolver be swapped for a different
//! provider (e.g. Clearbit) or mocked in tests without touching the
//! crm core.

use crate::domain::model::DomainMetadata;

/// Outcome of resolving one domain.
#[derive(Debug, Clone, PartialEq)]
pub enum DomainResolution {
    /// The provider answered. Stored in `crm_domain_directory` as the
    /// domain's permanent entry, even when every field is empty (the
    /// provider knows nothing about the domain — the negative cache).
    Resolved(Box<DomainMetadata>),
    /// No answer this time: the binary has no resolver, the provider is
    /// not configured, or the call failed. The directory entry stays
    /// pending so the enrichment worker retries it.
    Unavailable,
}

/// Resolves company metadata for a single email domain.
///
/// Implementations are best-effort and never error: a failed call is
/// [`DomainResolution::Unavailable`], logged by the implementation.
pub trait CompanyMetadataResolver: Clone + Send + Sync + 'static {
    /// Resolve metadata for the given lower-cased `domain`.
    fn resolve(&self, domain: &str) -> impl Future<Output = DomainResolution> + Send;
}
