use super::*;
use wiremock::{Mock, MockServer, ResponseTemplate, matchers::path};

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00];

#[tokio::test]
async fn a_png_response_becomes_a_prompt_image() {
    let server = MockServer::start().await;
    Mock::given(path("/pic"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(PNG, "image/png"))
        .expect(1)
        .mount(&server)
        .await;
    let url = format!("{}/pic", server.uri());
    let image = HttpPromptImageFetcher::allowing_loopback()
        .fetch(&url)
        .await
        .expect("png");
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.source_url.as_deref(), Some(url.as_str()));
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(image.data)
            .expect("base64"),
        PNG
    );
}

#[tokio::test]
async fn an_html_page_is_not_an_image() {
    let server = MockServer::start().await;
    Mock::given(path("/page"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(b"<html>not a picture</html>", "text/html"),
        )
        .mount(&server)
        .await;
    assert!(
        HttpPromptImageFetcher::allowing_loopback()
            .fetch(&format!("{}/page", server.uri()))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_redirect_cannot_reach_a_private_address() {
    let server = MockServer::start().await;
    Mock::given(path("/redirect"))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("location", "http://169.254.169.254/latest/meta-data"),
        )
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        HttpPromptImageFetcher::allowing_loopback()
            .fetch(&format!("{}/redirect", server.uri()))
            .await
            .is_none()
    );
}

#[tokio::test]
async fn relative_redirects_preserve_the_original_source_url() {
    let server = MockServer::start().await;
    Mock::given(path("/redirect"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/pic"))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/pic"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(PNG, "image/png"))
        .expect(1)
        .mount(&server)
        .await;
    let url = format!("{}/redirect", server.uri());
    let image = HttpPromptImageFetcher::allowing_loopback()
        .fetch(&url)
        .await
        .expect("png");
    assert_eq!(image.source_url.as_deref(), Some(url.as_str()));
}

#[test]
fn non_public_urls_are_rejected_before_connecting() {
    let fetcher = HttpPromptImageFetcher::new();
    for url in [
        "http://127.0.0.1/pic",
        "http://10.0.0.1/pic",
        "http://169.254.169.254/pic",
        "http://100.100.100.200/pic",
        "http://0.0.0.0/pic",
        "http://224.0.0.1/pic",
        "http://[::1]/pic",
        "http://[::ffff:127.0.0.1]/pic",
        "http://[fc00::1]/pic",
        "http://[fe80::1]/pic",
        "http://localhost/pic",
        "http://service.internal/pic",
        "file:///pic",
        "https://user:password@example.com/pic",
    ] {
        assert!(!fetcher.is_public(url), "{url}");
    }
}

#[tokio::test]
async fn connection_dns_refuses_loopback() {
    let resolver = PublicResolver {
        allow_loopback: false,
    };
    assert!(
        resolver
            .resolve("localhost".parse().expect("DNS name"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn oversized_content_length_is_rejected() {
    let server = MockServer::start().await;
    Mock::given(path("/pic"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(vec![0u8; prompt_image::MAX_IMAGE_BYTES + 1], "image/png"),
        )
        .mount(&server)
        .await;
    assert!(
        HttpPromptImageFetcher::allowing_loopback()
            .fetch(&format!("{}/pic", server.uri()))
            .await
            .is_none()
    );
}
