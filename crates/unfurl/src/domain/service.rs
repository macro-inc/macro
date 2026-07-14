//! Service implementation that drives the [`UnfurlFetcher`] port and turns
//! its raw meta-tag output into a [`GetUnfurlResponse`].

use crate::domain::{
    favicon::append_optimistic_favico,
    models::{GetUnfurlResponse, UnfurlErr},
    ports::{UnfurlFetcher, UnfurlService},
};

/// Default [`UnfurlService`] implementation, parameterized over an
/// [`UnfurlFetcher`] adapter.
pub struct UnfurlServiceImpl<F> {
    fetcher: F,
}

impl<F> UnfurlServiceImpl<F>
where
    F: UnfurlFetcher,
{
    /// Construct a new service over the given fetcher.
    pub fn new(fetcher: F) -> Self {
        Self { fetcher }
    }
}

impl<F> UnfurlService for UnfurlServiceImpl<F>
where
    F: UnfurlFetcher,
    anyhow::Error: From<F::Err>,
{
    #[tracing::instrument(err, skip(self))]
    async fn unfurl(&self, url: &str) -> Result<GetUnfurlResponse, UnfurlErr> {
        let tags = self
            .fetcher
            .fetch_meta_tags(url)
            .await
            .map_err(|e| UnfurlErr::Fetch(e.into()))?;
        let tags = append_optimistic_favico(tags, url);
        Ok(GetUnfurlResponse::new(url, &tags))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::domain::ports::MockUnfurlFetcher;

    #[tokio::test]
    async fn unfurl_returns_response_built_from_fetcher_tags() {
        let mut fetcher = MockUnfurlFetcher::new();
        fetcher.expect_fetch_meta_tags().returning(|_| {
            Box::pin(async move {
                let mut tags = HashMap::new();
                tags.insert("property:og:title".to_string(), "Title".to_string());
                tags.insert("property:og:description".to_string(), "Desc".to_string());
                Ok(tags)
            })
        });
        let service = UnfurlServiceImpl::new(fetcher);

        let res = service.unfurl("https://example.com/page").await.unwrap();
        assert_eq!(res.url, "https://example.com/page");
        assert_eq!(res.title, "Title");
        assert_eq!(res.description.as_deref(), Some("Desc"));
        // optimistic favicon is filled in when the page didn't provide one
        assert_eq!(
            res.favicon_url.as_deref(),
            Some("https://example.com/favicon.ico")
        );
    }

    #[tokio::test]
    async fn unfurl_surfaces_fetcher_errors() {
        let mut fetcher = MockUnfurlFetcher::new();
        fetcher
            .expect_fetch_meta_tags()
            .returning(|_| Box::pin(async move { Err(anyhow::anyhow!("boom")) }));
        let service = UnfurlServiceImpl::new(fetcher);

        let err = service.unfurl("https://example.com").await.unwrap_err();
        assert!(matches!(err, UnfurlErr::Fetch(_)));
    }
}
