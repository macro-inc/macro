//! The seam a web search vendor plugs into.

use async_trait::async_trait;

use super::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebSearchResult,
};

/// A web search vendor: search the web and read pages. One adapter per vendor.
#[async_trait]
pub trait SearchProvider: Send + Sync {
    /// The pricing id usage is recorded under (`ai_pricing.model`).
    fn pricing_model(&self) -> &'static str;

    /// Search the web, best match first.
    async fn search(
        &self,
        query: &SearchQuery,
    ) -> Result<Billed<Vec<WebSearchResult>>, ProviderError>;

    /// Read one page as Markdown.
    async fn fetch(&self, request: &PageRequest) -> Result<Billed<FetchedPage>, ProviderError>;
}
