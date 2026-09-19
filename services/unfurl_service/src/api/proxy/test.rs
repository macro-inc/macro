use super::*;
use axum::http::header::{AUTHORIZATION, COOKIE, REFERER, SET_COOKIE};

fn redirect_response(location: &str) -> reqwest::Response {
    axum::http::Response::builder()
        .status(302)
        .header("Location", location)
        .body("")
        .unwrap()
        .into()
}

#[test]
fn forwarded_headers_use_a_safe_allowlist() {
    let mut incoming = HeaderMap::new();
    incoming.insert("accept", "image/avif,image/webp,*/*".parse().unwrap());
    incoming.insert("accept-language", "en-US".parse().unwrap());
    incoming.insert("user-agent", "test-browser".parse().unwrap());
    incoming.insert(AUTHORIZATION, "Bearer secret".parse().unwrap());
    incoming.insert(COOKIE, "session=secret".parse().unwrap());
    incoming.insert(REFERER, "https://app.macro.com/private".parse().unwrap());
    incoming.insert("x-forwarded-for", "10.0.0.1".parse().unwrap());

    let forwarded = forwarded_request_headers(&incoming);

    assert_eq!(forwarded.get("accept"), incoming.get("accept"));
    assert_eq!(
        forwarded.get("accept-language"),
        incoming.get("accept-language")
    );
    assert_eq!(forwarded.get("user-agent"), incoming.get("user-agent"));
    assert!(!forwarded.contains_key(AUTHORIZATION));
    assert!(!forwarded.contains_key(COOKIE));
    assert!(!forwarded.contains_key(REFERER));
    assert!(!forwarded.contains_key("x-forwarded-for"));
}

#[test]
fn response_headers_exclude_credentials_and_hop_by_hop_metadata() {
    assert!(is_allowed_response_header(&reqwest::header::CONTENT_TYPE));
    assert!(is_allowed_response_header(&reqwest::header::CACHE_CONTROL));
    assert!(!is_allowed_response_header(&SET_COOKIE));
    assert!(!is_allowed_response_header(&reqwest::header::CONNECTION));
    assert!(!is_allowed_response_header(&reqwest::header::LOCATION));
}

#[test]
fn relative_redirects_remain_supported() {
    let current = url::Url::parse("https://example.com/assets/icon").unwrap();
    let response = redirect_response("../favicon.ico");

    let target = redirect_target(&current, &response).unwrap();

    assert_eq!(target.as_str(), "https://example.com/favicon.ico");
}

#[tokio::test]
async fn redirect_to_metadata_endpoint_is_rejected_before_following() {
    let current = url::Url::parse("https://example.com/start").unwrap();
    let response = redirect_response("http://169.254.169.254/latest/meta-data/");
    let target = redirect_target(&current, &response).unwrap();

    let result = assert_not_internal(&target).await;

    assert!(matches!(result, Err(FetchError::PrivateIp)));
}
