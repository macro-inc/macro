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

#[test]
fn parse_document_reads_the_first_paragraph_of_the_main_content() {
    let document_content = [
        "<html><body>",
        "<p>A notice outside the main content, long enough to pass for a paragraph of body text.</p>",
        "<main>",
        "<p class=\"empty\"></p>",
        "<p>By a staff writer</p>",
        "<p><b>Whales</b> are a widely distributed and diverse group of fully aquatic",
        "placental marine mammals.<sup>[1]</sup><style>.ref { color: red }</style> They",
        "live in every ocean.</p>",
        "<p>A second paragraph of body text that is also long enough to be picked up as one.</p>",
        "</main>",
        "</body></html>",
    ]
    .join("\n");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&document_content, &url).unwrap();

    assert_eq!(
        tags.get("paragraph").map(String::as_str),
        Some(
            "Whales are a widely distributed and diverse group of fully aquatic placental marine mammals. They live in every ocean."
        )
    );
}

#[test]
fn parse_document_finds_no_paragraph_outside_main_content() {
    let document_content = [
        "<html><body>",
        "<p>A page without a main element gives no hint which paragraph is its body text.</p>",
        "</body></html>",
    ]
    .join("\n");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&document_content, &url).unwrap();

    assert_eq!(tags.get("paragraph"), None);
}

#[tokio::test]
async fn a_page_longer_than_the_limit_is_read_from_its_start() {
    let head = "<html><head><meta property=\"og:title\" content=\"Long page\"></head><body>";
    let page = format!("{head}{}", "é".repeat(MAX_HTML_SIZE));
    let site = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_string(page))
        .mount(&site)
        .await;

    // The fetch path refuses the mock's loopback address, so this reads a
    // response fetched through the fetcher's client directly.
    let response = ReqwestUnfurlFetcher::new()
        .unwrap()
        .client
        .get(site.uri())
        .send()
        .await
        .unwrap();
    let text = read_body_start(response, MAX_HTML_SIZE).await.unwrap();

    // The limit falls inside a two-byte character, which is dropped.
    assert_eq!(text.len(), MAX_HTML_SIZE - 1);
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&text, &url).unwrap();
    assert_eq!(
        tags.get("property:og:title").map(String::as_str),
        Some("Long page")
    );
}

#[test]
fn a_whole_body_that_is_not_utf8_is_refused() {
    assert!(text_from_utf8(vec![b'a', 0xC3], false).is_err());
    assert!(text_from_utf8(vec![b'a', 0xFF, b'b'], true).is_err());
}

#[test]
fn parse_document_reads_the_page_title_not_an_inline_images() {
    let document_content = [
        "<html>",
        "<head><title>Tom &amp; Jerry | Example</title></head>",
        "<body><svg><title>Example logo</title></svg></body>",
        "</html>",
    ]
    .join("\n");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&document_content, &url).unwrap();

    assert_eq!(
        tags.get("title").map(String::as_str),
        Some("Tom & Jerry | Example")
    );
}

#[tokio::test]
async fn a_full_prefix_is_read_without_waiting_for_the_rest() {
    // A server that sends exactly the prefix, promises more, and stalls.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (finished, wait) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 1024];
        let _ = std::io::Read::read(&mut socket, &mut request);
        std::io::Write::write_all(
            &mut socket,
            b"HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ncontent-length: 1000\r\n\r\nabcd",
        )
        .unwrap();
        let _ = wait.recv();
    });

    let response = ReqwestUnfurlFetcher::new()
        .unwrap()
        .client
        .get(format!("http://{address}"))
        .send()
        .await
        .unwrap();
    let text = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        read_body_start(response, 4),
    )
    .await
    .expect("the reader stopped once it had the prefix")
    .unwrap();

    assert_eq!(text, "abcd");
    drop(finished);
}

#[test]
fn a_deeply_nested_paragraph_is_read_in_order() {
    let depth = 20_000;
    let body = format!(
        "{}A paragraph nested deep inside its page, still long enough to count as body text.<sup>[1]</sup>{}",
        "<span>".repeat(depth),
        "</span>".repeat(depth),
    );
    let page = format!("<html><body><main><p>{body} The end.</p></main></body></html>");
    let url = Url::from_str("http://example.com").unwrap();
    let tags = parse_document(&page, &url).unwrap();

    assert_eq!(
        tags.get("paragraph").map(String::as_str),
        Some(
            "A paragraph nested deep inside its page, still long enough to count as body text. The end."
        )
    );
}
