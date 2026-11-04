use super::*;
use unfurl::domain::models::{GetUnfurlResponse, UnfurlErr};

struct WebsiteMetadata(GetUnfurlResponse);

impl UnfurlService for WebsiteMetadata {
    async fn unfurl(&self, url: &str) -> Result<GetUnfurlResponse, UnfurlErr> {
        assert_eq!(url, "https://example.com");
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn homepage_metadata_supplies_company_name_description_and_icon() {
    let resolver =
        UnfurlCompanyMetadataResolver::new(Arc::new(WebsiteMetadata(GetUnfurlResponse {
            title: "  Example  ".into(),
            description: Some("Example description".into()),
            favicon_url: Some("https://example.com/icon.png".into()),
            ..Default::default()
        })));

    let DomainResolution::Resolved(metadata) = resolver.resolve("example.com").await else {
        panic!("website metadata should resolve the company");
    };
    assert_eq!(
        *metadata,
        DomainMetadata {
            name: Some("Example".into()),
            description: Some("Example description".into()),
            icon_url: Some("https://example.com/icon.png".into()),
            ..Default::default()
        }
    );
}

#[tokio::test]
async fn successful_empty_pages_do_not_turn_fallback_urls_into_company_names() {
    for title in ["https://example.com", "  https://example.com  ", "  "] {
        let resolver =
            UnfurlCompanyMetadataResolver::new(Arc::new(WebsiteMetadata(GetUnfurlResponse {
                title: title.into(),
                ..Default::default()
            })));
        let DomainResolution::Resolved(metadata) = resolver.resolve("example.com").await else {
            panic!("a successful page without metadata is a resolved negative-cache entry");
        };
        assert_eq!(*metadata, DomainMetadata::default());
    }
}

struct UnavailableWebsite;

impl UnfurlService for UnavailableWebsite {
    async fn unfurl(&self, _url: &str) -> Result<GetUnfurlResponse, UnfurlErr> {
        Err(UnfurlErr::Fetch(anyhow::anyhow!("website unavailable")))
    }
}

#[tokio::test]
async fn failed_fetch_stays_retryable_instead_of_resolving_an_empty_company() {
    let resolver = UnfurlCompanyMetadataResolver::new(Arc::new(UnavailableWebsite));
    assert!(matches!(
        resolver.resolve("example.com").await,
        DomainResolution::Unavailable
    ));
}
