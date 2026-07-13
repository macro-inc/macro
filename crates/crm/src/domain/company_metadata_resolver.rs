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

/// Resolves company metadata for a single email domain.
///
/// Implementations are expected to be best-effort: a missing page,
/// network timeout, or malformed metadata should be surfaced as a
/// [`DomainMetadata`] with all-NULL fields rather than an error, since
/// the caller writes the result into `crm_domain_directory` as a
/// negative cache so the domain isn't re-resolved on the next populate.
pub trait CompanyMetadataResolver: Clone + Send + Sync + 'static {
    /// Resolve metadata for the given lower-cased `domain`. Returns
    /// [`DomainMetadata::default`] (all fields `None`) on any failure;
    /// implementations are expected to log internally.
    fn resolve(&self, domain: &str) -> impl Future<Output = DomainMetadata> + Send;
}
