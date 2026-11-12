use super::*;
use url::Url;

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

#[test]
fn test_is_retryable_without_ua() {
    // UA-rejection symptoms — worth a no-UA retry.
    assert!(ProxyError::UpstreamStatus(StatusCode::FORBIDDEN).is_retryable_without_ua());
    assert!(ProxyError::NotAnImage("text/html".into()).is_retryable_without_ua());
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

// These expectations come from the deployed generic proxy contract. Keep them
// usable against the original handler as well as the extracted transport.
#[tokio::test]
async fn proxy_error_contract_preserves_status_body_and_content_type() {
    use http_body_util::BodyExt;

    for (error, status, body) in [
        (
            ProxyError::InvalidScheme,
            StatusCode::BAD_REQUEST,
            "only http/https URLs are allowed",
        ),
        (
            ProxyError::PrivateIp,
            StatusCode::FORBIDDEN,
            "requests to private/internal IPs are not allowed",
        ),
        (
            ProxyError::UpstreamTimeout("deadline".into()),
            StatusCode::GATEWAY_TIMEOUT,
            "timeout fetching upstream image: deadline",
        ),
        (
            ProxyError::UpstreamStatus(StatusCode::FORBIDDEN),
            StatusCode::NOT_FOUND,
            "upstream returned status 403 Forbidden",
        ),
        (
            ProxyError::UpstreamStatus(StatusCode::INTERNAL_SERVER_ERROR),
            StatusCode::BAD_GATEWAY,
            "upstream returned status 500 Internal Server Error",
        ),
        (
            ProxyError::NotAnImage("text/html".into()),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "upstream content-type is not an image: text/html",
        ),
        (
            ProxyError::ImageTooLarge {
                content_length: 10_485_761,
            },
            StatusCode::UNPROCESSABLE_ENTITY,
            "image exceeds max size of 10485760 bytes (Content-Length: 10485761)",
        ),
    ] {
        let response = error.into_response();
        assert_eq!(response.status(), status);
        assert_eq!(
            response.headers()["content-type"],
            "text/plain; charset=utf-8"
        );
        assert!(!response.headers().contains_key("cache-control"));
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            body
        );
    }
}

#[test]
fn generic_proxy_preserves_signed_query_and_url_credentials() {
    let url = validate_url(
        "https://user:password@example.com/a%2Fb.png?signature=a%2Bb%3D&part=2#ignored",
    )
    .unwrap();
    assert_eq!(
        url.as_str(),
        "https://user:password@example.com/a%2Fb.png?signature=a%2Bb%3D&part=2"
    );
}

#[test]
fn generic_proxy_content_length_accepts_limit_and_absent_length() {
    for length in [None, Some("10485760"), Some("10485761")] {
        let mut response = axum::http::Response::builder();
        // Reqwest exposes the response body's size hint as content_length(),
        // so synthetic responses need the same hint as their declared length.
        let body = if let Some(length) = length {
            response = response.header("content-length", length);
            reqwest::Body::from(vec![0; length.parse::<usize>().unwrap()])
        } else {
            reqwest::Body::wrap_stream(
                futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>(),
            )
        };
        let response = reqwest::Response::from(response.body(body).unwrap());
        assert_eq!(
            response.content_length(),
            length.map(|value| value.parse::<u64>().unwrap())
        );
        let result = check_content_length(&response, "https://example.com/image");
        if length == Some("10485761") {
            assert!(matches!(
                result,
                Err(ProxyError::ImageTooLarge {
                    content_length: 10_485_761
                })
            ));
        } else {
            assert!(result.is_ok());
        }
    }
}

#[tokio::test]
async fn generic_proxy_stream_preserves_bytes_at_limit_and_rejects_overflow_chunk() {
    use futures::StreamExt;

    let first = bytes::Bytes::from(vec![7; 10_485_759]);
    let stream = futures::stream::iter([
        Ok::<_, reqwest::Error>(first.clone()),
        Ok(bytes::Bytes::from_static(b"x")),
        Ok(bytes::Bytes::from_static(b"y")),
    ]);
    let mut stream = apply_size_limit(stream, "https://example.com/image".into());
    assert_eq!(stream.next().await.unwrap().unwrap(), first);
    assert_eq!(stream.next().await.unwrap().unwrap(), &b"x"[..]);
    assert_eq!(
        stream.next().await.unwrap().unwrap_err().to_string(),
        "image exceeded max size of 10485760 bytes during streaming"
    );
    assert!(stream.next().await.is_none());
}

#[test]
fn generic_proxy_redirect_preserves_query_and_allows_http_downgrade() {
    let current = Url::parse("https://example.com/a/image.png?old=1").unwrap();
    for (location, expected) in [
        (
            "../next.png?signature=a%2Bb#ignored",
            "https://example.com/next.png?signature=a%2Bb",
        ),
        (
            "http://cdn.example.com/image.svg",
            "http://cdn.example.com/image.svg",
        ),
    ] {
        let response = response_with_status_and_location(302, Some(location));
        assert_eq!(
            redirect_target(&current, &response).unwrap().as_str(),
            expected
        );
    }
    assert!(is_allowed_content_type("image/svg+xml"));
    assert!(is_allowed_content_type(" IMAGE/PNG ; charset=binary"));
}

#[test]
fn generic_proxy_retains_legacy_address_policy_separately_from_logos() {
    // These are policy fixtures, never outbound request destinations. The
    // generic proxy must retain its deployed predicate independently of logos.
    for address in ["100.64.0.1", "192.0.2.1", "198.18.0.1", "2001:db8::1"] {
        assert!(!is_private_ip(&address.parse().unwrap()), "{address}");
    }
}

#[test]
fn generic_proxy_preserves_upstream_mime_header_and_missing_type_fallback() {
    for (content_type, expected) in [
        (None, "application/octet-stream"),
        (
            Some("IMAGE/PNG; charset=binary"),
            "IMAGE/PNG; charset=binary",
        ),
        (Some("image/svg+xml"), "image/svg+xml"),
    ] {
        let mut response = axum::http::Response::builder();
        if let Some(content_type) = content_type {
            response = response.header("content-type", content_type);
        }
        let response = reqwest::Response::from(response.body("").unwrap());
        assert_eq!(extract_content_type(&response).unwrap(), expected);
    }
    let response = reqwest::Response::from(
        axum::http::Response::builder()
            .header("content-type", "text/html")
            .body("")
            .unwrap(),
    );
    assert!(
        matches!(extract_content_type(&response), Err(ProxyError::NotAnImage(content_type)) if content_type == "text/html")
    );
}
