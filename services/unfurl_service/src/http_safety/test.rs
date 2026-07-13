use super::*;

#[test]
fn test_validate_url_accepts_https() {
    let result = validate_url("https://example.com/page");
    assert!(result.is_ok());
    assert_eq!(result.unwrap().as_str(), "https://example.com/page");
}

#[test]
fn test_validate_url_accepts_http() {
    let result = validate_url("http://example.com/page");
    assert!(result.is_ok());
}

#[test]
fn test_validate_url_rejects_ftp() {
    let result = validate_url("ftp://example.com/file");
    assert!(matches!(result, Err(FetchError::InvalidScheme)));
}

#[test]
fn test_validate_url_rejects_data_uri() {
    let result = validate_url("data:text/html;base64,abc");
    assert!(result.is_err());
}

#[test]
fn test_validate_url_rejects_invalid() {
    let result = validate_url("not a url");
    assert!(matches!(result, Err(FetchError::InvalidUrl(_))));
}

#[test]
fn test_validate_url_strips_fragment() {
    let result = validate_url("https://example.com/page#section");
    assert!(result.is_ok());
    assert_eq!(result.unwrap().as_str(), "https://example.com/page");
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
fn test_is_private_ip_mapped_v4() {
    assert!(is_private_ip(&"::ffff:127.0.0.1".parse().unwrap()));
    assert!(is_private_ip(&"::ffff:169.254.169.254".parse().unwrap()));
    assert!(is_private_ip(&"::ffff:10.0.0.1".parse().unwrap()));
    assert!(is_private_ip(&"::ffff:192.168.1.1".parse().unwrap()));
    assert!(!is_private_ip(&"::ffff:8.8.8.8".parse().unwrap()));
}

#[test]
fn test_is_private_ip_public() {
    assert!(!is_private_ip(&"8.8.8.8".parse().unwrap()));
    assert!(!is_private_ip(&"1.1.1.1".parse().unwrap()));
    assert!(!is_private_ip(&"2607:f8b0:4004:800::200e".parse().unwrap()));
}

#[tokio::test]
async fn test_assert_not_internal_blocks_loopback() {
    let url = Url::parse("http://127.0.0.1/secret").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(matches!(result, Err(FetchError::PrivateIp)));
}

#[tokio::test]
async fn test_assert_not_internal_blocks_metadata_endpoint() {
    let url = Url::parse("http://169.254.169.254/latest/meta-data/").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(matches!(result, Err(FetchError::PrivateIp)));
}

#[tokio::test]
async fn test_assert_not_internal_allows_public() {
    let url = Url::parse("https://example.com/page").unwrap();
    let result = assert_not_internal(&url).await;
    assert!(result.is_ok());
}
