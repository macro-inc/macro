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
fn test_rejects_non_image_content_types() {
    assert!(!is_allowed_content_type("text/html"));
    assert!(!is_allowed_content_type("application/json"));
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
