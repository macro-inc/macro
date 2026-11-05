//! [`LinkPreviewFetcher`] adapter that reads a page's preview through the
//! SSRF-safe [`unfurl`] crate.

use std::sync::Arc;

use unfurl::domain::{models::GetUnfurlResponse, ports::UnfurlService};

use crate::domain::{models::LinkPreview, ports::LinkPreviewFetcher};

#[cfg(test)]
mod test;

/// Fetches link previews with an [`UnfurlService`].
pub struct UnfurlLinkPreviews<U> {
    unfurl: Arc<U>,
}

impl<U> UnfurlLinkPreviews<U> {
    /// Read previews through `unfurl`.
    pub fn new(unfurl: Arc<U>) -> Self {
        Self { unfurl }
    }
}

impl<U: UnfurlService> LinkPreviewFetcher for UnfurlLinkPreviews<U> {
    fn fetch<'a>(
        &'a self,
        url: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<LinkPreview>> + Send + 'a>> {
        Box::pin(async move {
            match self.unfurl.unfurl(url).await {
                Ok(page) => link_preview(page),
                Err(error) => {
                    tracing::info!(error = ?error, "link preview page unavailable");
                    None
                }
            }
        })
    }
}

/// The card a page gets, or `None` when it says nothing beyond its address.
///
/// The unfurl title falls back to the URL when the page has none, and an
/// optimistic `/favicon.ico` is filled in for every page, so neither alone
/// makes a card worth showing.
fn link_preview(page: GetUnfurlResponse) -> Option<LinkPreview> {
    let title = page.title.trim();
    let title = if title == page.url { "" } else { title };
    let description = page
        .description
        .map(|description| description.trim().to_string())
        .filter(|description| !description.is_empty());
    if title.is_empty() && description.is_none() && page.image_url.is_none() {
        return None;
    }

    Some(LinkPreview {
        title: title.to_string(),
        description,
        image_url: page.image_url,
        favicon_url: page.favicon_url,
        url: page.url,
    })
}
