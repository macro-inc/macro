use chrono::NaiveDate;
use serde_json::json;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::{TavilyApiKey, TavilyClient};
use crate::domain::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebSearchResult, WebSearchTopic,
};
use crate::domain::ports::SearchProvider;

const SEARCH: &str = include_str!("fixtures/search.json");
const EXTRACT: &str = include_str!("fixtures/extract.json");
const EXTRACT_FAILED: &str = include_str!("fixtures/extract_failed.json");

fn fixture(body: &str) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body.to_owned(), "application/json")
}

#[tokio::test]
async fn search_sends_typed_filters_and_maps_results() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/search"))
        .and(header("authorization", "Bearer tvly-test"))
        .and(body_json(json!({
            "query": "rust async runtime comparison",
            "topic": "news",
            "search_depth": "basic",
            "max_results": 2,
            "include_domains": ["tokio.rs", "example.com"],
            "exclude_domains": ["reddit.com"],
            "start_date": "2025-10-01",
            "include_published_date": true,
            "include_raw_content": "markdown",
            "include_answer": false,
            "include_images": false,
            "include_usage": true
        })))
        .respond_with(fixture(SEARCH))
        .expect(1)
        .mount(&server)
        .await;
    let client =
        TavilyClient::with_base_url(&TavilyApiKey::new_testing("tvly-test"), &server.uri());

    let billed = client
        .search(&SearchQuery {
            query: "rust async runtime comparison".into(),
            domains: vec!["tokio.rs".into(), "example.com".into()],
            exclude_domains: vec!["reddit.com".into()],
            since: Some(NaiveDate::from_ymd_opt(2025, 10, 1).unwrap()),
            topic: WebSearchTopic::News,
            max_results: 2,
            include_content: true,
        })
        .await
        .unwrap();

    assert_eq!(
        billed,
        Billed {
            credits: Some(1),
            value: vec![
                WebSearchResult {
                    title: "Announcing Tokio 1.48".into(),
                    url: "https://tokio.rs/blog/2025-10-tokio-1-48".into(),
                    snippet: "Tokio 1.48 ships a faster multi-threaded scheduler and stabilises task dumps.".into(),
                    published_at: Some("Tue, 14 Oct 2025 09:00:00 GMT".into()),
                    content: Some(
                        "# Announcing Tokio 1.48\n\nTokio 1.48 ships a faster scheduler.".into()
                    ),
                },
                WebSearchResult {
                    title: "Comparing Rust async runtimes".into(),
                    url: "https://example.com/async-runtimes".into(),
                    snippet: "Tokio, smol and glommio take different approaches to scheduling."
                        .into(),
                    published_at: None,
                    content: None,
                },
            ],
        }
    );
}

#[tokio::test]
async fn search_omits_unset_filters() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/search"))
        .and(body_json(json!({
            "query": "macro",
            "topic": "general",
            "search_depth": "basic",
            "max_results": 5,
            "include_published_date": true,
            "include_answer": false,
            "include_images": false,
            "include_usage": true
        })))
        .respond_with(fixture(SEARCH))
        .expect(1)
        .mount(&server)
        .await;
    let client =
        TavilyClient::with_base_url(&TavilyApiKey::new_testing("tvly-test"), &server.uri());

    client
        .search(&SearchQuery {
            query: "macro".into(),
            domains: vec![],
            exclude_domains: vec![],
            since: None,
            topic: WebSearchTopic::General,
            max_results: 5,
            include_content: false,
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn fetch_extracts_markdown() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/extract"))
        .and(header("authorization", "Bearer tvly-test"))
        .and(body_json(json!({
            "urls": ["https://tokio.rs/blog/2025-10-tokio-1-48"],
            "extract_depth": "basic",
            "format": "markdown",
            "include_usage": true
        })))
        .respond_with(fixture(EXTRACT))
        .expect(1)
        .mount(&server)
        .await;
    let client =
        TavilyClient::with_base_url(&TavilyApiKey::new_testing("tvly-test"), &server.uri());

    let billed = client
        .fetch(&PageRequest {
            url: "https://tokio.rs/blog/2025-10-tokio-1-48".parse().unwrap(),
        })
        .await
        .unwrap();

    assert_eq!(
        billed,
        Billed {
            credits: Some(1),
            value: FetchedPage {
                url: "https://tokio.rs/blog/2025-10-tokio-1-48".into(),
                title: None,
                content:
                    "# Announcing Tokio 1.48\n\nTokio 1.48 ships a faster multi-threaded scheduler."
                        .into(),
            },
        }
    );
}

#[tokio::test]
async fn fetch_reports_the_providers_failure_reason() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/extract"))
        .respond_with(fixture(EXTRACT_FAILED))
        .mount(&server)
        .await;
    let client =
        TavilyClient::with_base_url(&TavilyApiKey::new_testing("tvly-test"), &server.uri());

    let error = client
        .fetch(&PageRequest {
            url: "https://example.com/members-only".parse().unwrap(),
        })
        .await
        .unwrap_err();

    assert!(
        matches!(&error, ProviderError::PageUnavailable(reason) if reason == "Failed to retrieve content"),
        "{error:?}"
    );
}

#[tokio::test]
async fn plan_limits_and_rate_limits_are_throttling() {
    for status in [429, 432, 433] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
        let client =
            TavilyClient::with_base_url(&TavilyApiKey::new_testing("tvly-test"), &server.uri());

        let error = client
            .fetch(&PageRequest {
                url: "https://example.com/".parse().unwrap(),
            })
            .await
            .unwrap_err();

        assert!(
            matches!(error, ProviderError::Throttled(code) if code == status),
            "{status}: {error:?}"
        );
    }
}

#[tokio::test]
async fn a_missing_key_fails_without_calling_tavily() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(fixture(SEARCH))
        .expect(0)
        .mount(&server)
        .await;
    let client = TavilyClient::with_base_url(&TavilyApiKey::new_testing("  "), &server.uri());

    let error = client
        .fetch(&PageRequest {
            url: "https://example.com/".parse().unwrap(),
        })
        .await
        .unwrap_err();

    assert_eq!(
        error.to_string(),
        "web search is not configured: TAVILY_API_KEY is not set"
    );
}
