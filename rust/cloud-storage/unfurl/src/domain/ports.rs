//! Inbound and outbound ports for the unfurl domain.

use std::collections::HashMap;

use crate::domain::models::{GetUnfurlResponse, UnfurlErr};

/// Outbound port: fetches and parses meta tags from a given URL.
///
/// Implementations live in `outbound/` (e.g. the reqwest + scraper adapter).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait UnfurlFetcher: Send + Sync + 'static {
    /// Adapter-specific error type. The service converts these into
    /// [`UnfurlErr::Fetch`] via [`anyhow::Error`].
    type Err: Send;

    /// Fetch the given URL and extract its `<meta>` / `<title>` /
    /// favicon entries into a flat key/value map.
    ///
    /// Keys follow the conventions used downstream by
    /// [`GetUnfurlResponse::get_title`] — `property:og:title`,
    /// `property:og:description`, `property:og:image`, `title`, `favicon`.
    fn fetch_meta_tags(
        &self,
        url: &str,
    ) -> impl Future<Output = Result<HashMap<String, String>, Self::Err>> + Send;
}

/// Inbound port: the unfurl feature exposed to adapters (HTTP, tools, …).
pub trait UnfurlService: Send + Sync + 'static {
    /// Unfurl a single URL, returning a [`GetUnfurlResponse`] with title,
    /// description, image, and favicon as available.
    fn unfurl(
        &self,
        url: &str,
    ) -> impl Future<Output = Result<GetUnfurlResponse, UnfurlErr>> + Send;
}
