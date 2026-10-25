//! [`CompanyMetadataResolver`] adapter that never resolves.
//!
//! Used by binaries that construct a [`CrmService`] without carrying a
//! metadata provider — HTTP API servers, MCP, and agent tools. Wiring a
//! real resolver into each of them would force them to carry the reqwest
//! + scraper deps and provider credentials. Companies they create get a
//! pending `crm_domain_directory` entry, which the email pubsub workers'
//! enrichment worker resolves with the real resolver.
//!
//! [`CrmService`]: crate::domain::service::CrmService

use crate::domain::company_metadata_resolver::{CompanyMetadataResolver, DomainResolution};

/// A [`CompanyMetadataResolver`] that always returns
/// [`DomainResolution::Unavailable`].
#[derive(Debug, Default, Clone, Copy)]
pub struct NoOpCompanyMetadataResolver;

impl CompanyMetadataResolver for NoOpCompanyMetadataResolver {
    async fn resolve(&self, _domain: &str) -> DomainResolution {
        DomainResolution::Unavailable
    }
}
