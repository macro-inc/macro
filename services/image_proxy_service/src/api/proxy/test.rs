use tower::ServiceExt;

use super::*;

#[test]
fn test_proxy_params_deserialization() {
    let params: ProxyParams =
        serde_json::from_str(r#"{"url":"https://example.com/image.png"}"#).unwrap();
    assert_eq!(params.url, "https://example.com/image.png");
}

#[test]
fn test_validate_url_accepts_https() {
    let result = validate_url("https://example.com/image.png");
    assert!(result.is_ok());
    assert_eq!(result.unwrap().as_str(), "https://example.com/image.png");
}

#[test]
fn test_validate_url_accepts_http() {
    let result = validate_url("http://example.com/image.png");
    assert!(result.is_ok());
}

#[test]
fn test_validate_url_rejects_ftp() {
    let result = validate_url("ftp://example.com/image.png");
    assert!(matches!(result, Err(ProxyError::InvalidScheme)));
}

#[test]
fn test_validate_url_rejects_data_uri() {
    let result = validate_url("data:image/png;base64,abc");
    assert!(result.is_err());
}

#[test]
fn test_validate_url_rejects_invalid() {
    let result = validate_url("not a url");
    assert!(matches!(result, Err(ProxyError::InvalidUrl(_))));
}

#[test]
fn test_validate_url_strips_fragment() {
    let result = validate_url("https://example.com/image.png#section");
    assert!(result.is_ok());
    assert_eq!(result.unwrap().as_str(), "https://example.com/image.png");
}

#[test]
fn test_allows_image_content_types() {
    assert!(is_allowed_content_type("image/png"));
    assert!(is_allowed_content_type("image/jpeg; charset=utf-8"));
}

#[test]
fn test_allows_octet_stream_content_type() {
    assert!(is_allowed_content_type("application/octet-stream"));
    assert!(is_allowed_content_type(
        "application/octet-stream; charset=binary"
    ));
    assert!(is_allowed_content_type("APPLICATION/OCTET-STREAM"));
}

#[test]
fn test_allows_image_content_types_and_aliases() {
    for content_type in [
        "image/x-png",
        "image/x-ms-bmp",
        "image/jpg",
        "image/pjpeg",
        "image/apng",
        "image/gif",
        "image/webp",
        "image/avif",
        "image/bmp",
        "image/tiff",
        "image/heic",
        "image/heif",
        "image/jxl",
        "image/x-icon",
        "image/vnd.microsoft.icon",
        "image/svg+xml",
        "image/svg+xml; charset=utf-8",
        "IMAGE/PNG",
    ] {
        assert!(is_allowed_content_type(content_type), "{content_type}");
    }
}

#[test]
fn test_rejects_non_image_content_types() {
    for content_type in [
        "text/html",
        "text/html; charset=utf-8",
        "application/json",
        "application/xhtml+xml",
        "text/xml",
        "image/x-xbitmap",
        "image/",
    ] {
        assert!(!is_allowed_content_type(content_type), "{content_type}");
    }
}

#[test]
fn test_unsupported_media_type_is_415() {
    let response = ProxyError::UnsupportedMediaType("text/html".into()).into_response();
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
}

const SVG_WITH_SCRIPT: &str =
    r#"<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>"#;

async fn send_through_sandbox(response: fn() -> Response) -> Response {
    let router: Router =
        with_sandbox_headers(Router::new().route("/", get(move || async move { response() })));
    router
        .oneshot(axum::http::Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap()
}

fn assert_sandboxed(response: &Response) {
    let headers = response.headers();
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(
        headers["content-security-policy"],
        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
}

#[tokio::test]
async fn test_svg_with_script_is_sandboxed_attachment() {
    let response = send_through_sandbox(|| {
        image_response("image/svg+xml", Body::from(SVG_WITH_SCRIPT)).unwrap()
    })
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_sandboxed(&response);
    let headers = response.headers();
    assert_eq!(headers["content-type"], "image/svg+xml");
    assert_eq!(headers["content-disposition"], "attachment");
    assert!(
        headers["content-security-policy"]
            .to_str()
            .unwrap()
            .split(';')
            .any(|directive| directive.trim() == "sandbox")
    );
}

#[tokio::test]
async fn test_raster_response_is_sandboxed_inline() {
    let response =
        send_through_sandbox(|| image_response("image/png", Body::empty()).unwrap()).await;

    assert_sandboxed(&response);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert!(response.headers().get("content-disposition").is_none());
}

#[tokio::test]
async fn test_error_response_is_sandboxed() {
    let response = send_through_sandbox(|| {
        ProxyError::UnsupportedMediaType("text/html".into()).into_response()
    })
    .await;

    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_sandboxed(&response);
}

#[test]
fn test_is_private_ip_loopback() {
    assert!(is_private_ip(&"127.0.0.1".parse().unwrap()));
    assert!(is_private_ip(&"::1".parse().unwrap()));
}

#[test]
fn test_is_private_ip_private_ranges() {
    assert!(is_private_ip(&"10.0.0.1".parse().unwrap()));
    assert!(is_private_ip(&"172.16.0.1".parse().unwrap()));
    assert!(is_private_ip(&"192.168.1.1".parse().unwrap()));
}

#[test]
fn test_is_private_ip_link_local() {
    assert!(is_private_ip(&"169.254.169.254".parse().unwrap()));
}

#[test]
fn test_is_private_ip_unspecified() {
    assert!(is_private_ip(&"0.0.0.0".parse().unwrap()));
    assert!(is_private_ip(&"::".parse().unwrap()));
}

#[test]
fn test_is_private_ip_v6_unique_local() {
    // fc00::/7 — IPv6 equivalent of RFC1918.
    assert!(is_private_ip(&"fc00::1".parse().unwrap()));
    assert!(is_private_ip(&"fd12:3456:789a::1".parse().unwrap()));
}

#[test]
fn test_is_private_ip_v6_link_local() {
    // fe80::/10 — only reachable on the local link.
    assert!(is_private_ip(&"fe80::1".parse().unwrap()));
    assert!(is_private_ip(
        &"febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff".parse().unwrap()
    ));
}

#[test]
fn test_is_private_ip_mapped_v4() {
    // ::ffff:127.0.0.1 — IPv4-mapped loopback
    assert!(is_private_ip(&"::ffff:127.0.0.1".parse().unwrap()));
    // ::ffff:169.254.169.254 — IPv4-mapped AWS metadata
    assert!(is_private_ip(&"::ffff:169.254.169.254".parse().unwrap()));
    // ::ffff:10.0.0.1 — IPv4-mapped private
    assert!(is_private_ip(&"::ffff:10.0.0.1".parse().unwrap()));
    // ::ffff:192.168.1.1 — IPv4-mapped private
    assert!(is_private_ip(&"::ffff:192.168.1.1".parse().unwrap()));
    // ::ffff:8.8.8.8 — IPv4-mapped public should be allowed
    assert!(!is_private_ip(&"::ffff:8.8.8.8".parse().unwrap()));
}

#[test]
fn test_is_private_ip_public() {
    assert!(!is_private_ip(&"8.8.8.8".parse().unwrap()));
    assert!(!is_private_ip(&"1.1.1.1".parse().unwrap()));
    assert!(!is_private_ip(&"2607:f8b0:4004:800::200e".parse().unwrap()));
}

#[test]
fn test_is_retryable_without_ua() {
    // UA-rejection symptoms — worth a no-UA retry.
    assert!(ProxyError::UpstreamStatus(StatusCode::FORBIDDEN).is_retryable_without_ua());
    assert!(ProxyError::UnsupportedMediaType("text/html".into()).is_retryable_without_ua());
    // Not UA-related — retrying without a UA wouldn't help.
    assert!(!ProxyError::UpstreamTimeout("timed out".into()).is_retryable_without_ua());
    assert!(!ProxyError::UpstreamConnect("refused".into()).is_retryable_without_ua());
    assert!(!ProxyError::PrivateIp.is_retryable_without_ua());
    assert!(!ProxyError::InvalidScheme.is_retryable_without_ua());
}

#[test]
fn test_upstream_refusals_are_not_found() {
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::NOT_FOUND,
        StatusCode::TOO_MANY_REQUESTS,
    ] {
        let response = ProxyError::UpstreamStatus(status).into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{status}");
    }
}

#[test]
fn test_upstream_server_errors_are_bad_gateway() {
    let response = ProxyError::UpstreamStatus(StatusCode::INTERNAL_SERVER_ERROR).into_response();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
}

fn response_with_status_and_location(status: u16, location: Option<&str>) -> reqwest::Response {
    let mut builder = axum::http::Response::builder().status(status);
    if let Some(location) = location {
        builder = builder.header("Location", location);
    }
    builder.body("").unwrap().into()
}

#[test]
fn test_redirect_target_absolute_location() {
    let current = Url::parse("https://example.com/image.png").unwrap();
    let response = response_with_status_and_location(302, Some("https://cdn.example.com/img.png"));
    let next = redirect_target(&current, &response).unwrap();
    assert_eq!(next.as_str(), "https://cdn.example.com/img.png");
}

#[test]
fn test_redirect_target_relative_location() {
    let current = Url::parse("https://example.com/a/image.png").unwrap();
    let response = response_with_status_and_location(302, Some("/b/image.png"));
    let next = redirect_target(&current, &response).unwrap();
    assert_eq!(next.as_str(), "https://example.com/b/image.png");
}

#[test]
fn test_redirect_target_strips_fragment() {
    let current = Url::parse("https://example.com/image.png").unwrap();
    let response = response_with_status_and_location(302, Some("https://example.com/img.png#frag"));
    let next = redirect_target(&current, &response).unwrap();
    assert_eq!(next.as_str(), "https://example.com/img.png");
}

#[test]
fn test_redirect_target_rejects_non_http_scheme() {
    let current = Url::parse("https://example.com/image.png").unwrap();
    let response = response_with_status_and_location(302, Some("ftp://example.com/img.png"));
    let result = redirect_target(&current, &response);
    assert!(matches!(result, Err(ProxyError::InvalidScheme)));
}

#[test]
fn test_redirect_target_missing_location() {
    let current = Url::parse("https://example.com/image.png").unwrap();
    let response = response_with_status_and_location(302, None);
    let result = redirect_target(&current, &response);
    assert!(matches!(result, Err(ProxyError::UpstreamRedirect(_))));
}

#[tokio::test]
async fn test_assert_not_internal_blocks_loopback() {
    let url = Url::parse("http://127.0.0.1/secret").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(matches!(result, Err(ProxyError::PrivateIp)));
}

#[tokio::test]
async fn test_assert_not_internal_blocks_metadata_endpoint() {
    let url = Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(matches!(result, Err(ProxyError::PrivateIp)));
}

#[tokio::test]
async fn test_assert_not_internal_allows_public() {
    let url = Url::parse("https://example.com/image.png").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(result.is_ok());
}
