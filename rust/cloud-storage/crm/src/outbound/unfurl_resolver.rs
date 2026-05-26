//! [`CompanyMetadataResolver`] adapter that fetches metadata via the
//! [`unfurl`] crate.
//!
//! Resolves `https://{domain}` through an [`UnfurlService`] and maps the
//! response onto a [`DomainMetadata`]:
//!
//! | unfurl field           | DomainMetadata field |
//! |------------------------|----------------------|
//! | `title`                | `name`               |
//! | `description`          | `description`        |
//! | `favicon_url`          | `icon_url`           |
//!
//! `title` is dropped when it equals the input URL itself —
//! [`unfurl::domain::models::GetUnfurlResponse::get_title`] falls back
//! to the URL when no usable meta-tag exists, and persisting that as a
//! company name would be worse than persisting `None`.
//!
//! Failures (network errors, SSRF-blocked redirects, parse errors,
//! non-HTML responses) are logged and surfaced as
//! [`DomainMetadata::default`] so the caller can persist a
//! negative-cache entry and never re-resolve the domain.

use std::sync::Arc;

use crate::domain::{company_metadata_resolver::CompanyMetadataResolver, model::DomainMetadata};
use unfurl::domain::ports::UnfurlService;

/// Adapter that resolves [`DomainMetadata`] by unfurling
/// `https://{domain}`. Holds the underlying [`UnfurlService`] behind an
/// [`Arc`] so the resolver itself is cheap to [`Clone`].
pub struct UnfurlCompanyMetadataResolver<U> {
    unfurl_service: Arc<U>,
}

// Manual Clone impl — `#[derive(Clone)]` would require `U: Clone` even
// though we only hold `Arc<U>`. The Arc clone is always cheap regardless
// of whether the inner type is Clone.
impl<U> Clone for UnfurlCompanyMetadataResolver<U> {
    fn clone(&self) -> Self {
        Self {
            unfurl_service: Arc::clone(&self.unfurl_service),
        }
    }
}

impl<U> UnfurlCompanyMetadataResolver<U>
where
    U: UnfurlService,
{
    /// Build a resolver around an existing unfurl service.
    pub fn new(unfurl_service: Arc<U>) -> Self {
        Self { unfurl_service }
    }
}

impl<U> CompanyMetadataResolver for UnfurlCompanyMetadataResolver<U>
where
    U: UnfurlService,
{
    #[tracing::instrument(skip(self))]
    async fn resolve(&self, domain: &str) -> DomainMetadata {
        let url = format!("https://{domain}");
        match self.unfurl_service.unfurl(&url).await {
            Ok(response) => {
                // `get_title` returns the URL string itself when no
                // usable title was found — drop that case. Trim
                // surrounding whitespace so accidental padding (or a
                // whitespace-only title) collapses to `None` rather
                // than getting persisted as the company name.
                let title = response.title.trim();
                let name = if title.is_empty() || title == url {
                    None
                } else {
                    Some(title.to_string())
                };
                DomainMetadata {
                    name,
                    description: response.description,
                    icon_url: response.favicon_url,
                }
            }
            Err(e) => {
                tracing::warn!(
                    error=?e,
                    domain,
                    "unfurl failed; returning empty DomainMetadata for negative cache"
                );
                DomainMetadata::default()
            }
        }
    }
}
