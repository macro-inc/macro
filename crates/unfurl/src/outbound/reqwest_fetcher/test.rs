use std::str::FromStr;

use wiremock::matchers::{header, method};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

#[tokio::test]
async fn requests_name_the_fetcher_in_their_user_agent() {
    let site = MockServer::start().await;
    Mock::given(method("GET"))
        .and(header("user-agent", USER_AGENT))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&site)
        .await;

    // The fetch path refuses the mock's loopback address, so this sends
    // through the fetcher's client directly.
    let response = ReqwestUnfurlFetcher::new()
        .unwrap()
        .client
        .get(site.uri())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

#[test]
fn test_parse_document_extracts_og_title() {
    let document_content = [
        "<html>",
        "<head>",
        "<meta property=\"og:title\" content=\"hello\" />",
        "</head>",
        "</html>",
    ]
    .join("\n");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&document_content, &url).unwrap();

    assert_eq!(
        tags.get("property:og:title").map(String::as_str),
        Some("hello")
    );
}

#[test]
fn test_parse_document_extracts_title_tag() {
    let document_content = [
        "<html>",
        "<head>",
        "<title>Website Title</title>",
        "</head>",
        "</html>",
    ]
    .join("\n");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&document_content, &url).unwrap();
    assert_eq!(tags.get("title").map(String::as_str), Some("Website Title"));
}

#[test]
fn test_is_html_content_type() {
    assert!(is_html_content_type("text/html"));
    assert!(is_html_content_type("text/html; charset=utf-8"));
    assert!(is_html_content_type("application/xhtml+xml"));
    assert!(!is_html_content_type("image/png"));
    assert!(!is_html_content_type("application/json"));
}
