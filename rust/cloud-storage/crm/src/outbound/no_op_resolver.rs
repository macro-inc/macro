//! [`CompanyMetadataResolver`] adapter that always returns
//! [`DomainMetadata::default`].
//!
//! Used by binaries that need to construct a [`CrmService`] but never
//! call [`populate_contact`] — typically HTTP API servers that only
//! read existing CRM rows via [`get_company_by_domain`]. Wiring in a
//! real unfurl-backed resolver in those binaries would force them to
//! carry the reqwest + scraper deps for code paths they never hit.
//!
//! If a binary using this resolver ever *does* call `populate_contact`,
//! the resulting `crm_domain_directory` entries will all have NULL
//! `name`/`description`/`icon_url` fields — i.e. the directory's
//! negative cache fires for every domain. That's a silent loss of
//! company metadata, not a crash, so callers should prefer wiring in
//! the real [`UnfurlCompanyMetadataResolver`] when they participate in
//! the populate path.
//!
//! [`CrmService`]: crate::domain::service::CrmService
//! [`populate_contact`]: crate::domain::service::CrmService::populate_contact
//! [`get_company_by_domain`]: crate::domain::service::CrmService::get_company_by_domain
//! [`UnfurlCompanyMetadataResolver`]: crate::outbound::unfurl_resolver::UnfurlCompanyMetadataResolver

use crate::domain::{company_metadata_resolver::CompanyMetadataResolver, model::DomainMetadata};

/// A [`CompanyMetadataResolver`] that always resolves to
/// [`DomainMetadata::default`] (all fields `None`).
#[derive(Debug, Default, Clone, Copy)]
pub struct NoOpCompanyMetadataResolver;

impl CompanyMetadataResolver for NoOpCompanyMetadataResolver {
    async fn resolve(&self, _domain: &str) -> DomainMetadata {
        DomainMetadata::default()
    }
}
