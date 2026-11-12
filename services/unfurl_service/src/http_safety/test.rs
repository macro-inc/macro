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
fn test_is_private_ip_v6_unique_and_link_local() {
    assert!(is_private_ip(&"fc00::1".parse().unwrap()));
    assert!(is_private_ip(&"fd12:3456:789a::1".parse().unwrap()));
    assert!(is_private_ip(&"fe80::1".parse().unwrap()));
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

fn redirect_response(location: Option<&str>) -> reqwest::Response {
    let mut builder = axum::http::Response::builder().status(302);
    if let Some(location) = location {
        builder = builder.header("Location", location);
    }
    builder.body("").unwrap().into()
}

#[test]
fn test_redirect_target_supports_absolute_and_relative_locations() {
    let current = Url::parse("https://example.com/a/page").unwrap();

    let relative = redirect_target(&current, &redirect_response(Some("../next"))).unwrap();
    assert_eq!(relative.as_str(), "https://example.com/next");

    let absolute = redirect_target(
        &current,
        &redirect_response(Some("https://cdn.example.com/final#fragment")),
    )
    .unwrap();
    assert_eq!(absolute.as_str(), "https://cdn.example.com/final");
}

#[test]
fn test_redirect_target_rejects_unsafe_or_missing_locations() {
    let current = Url::parse("https://example.com/start").unwrap();

    let unsafe_scheme = redirect_target(&current, &redirect_response(Some("file:///etc/passwd")));
    assert!(matches!(unsafe_scheme, Err(FetchError::InvalidScheme)));

    let missing = redirect_target(&current, &redirect_response(None));
    assert!(matches!(missing, Err(FetchError::UpstreamRedirect(_))));
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

#[test]
fn blocks_every_non_public_range() {
    let blocked = [
        // 0.0.0.0/8, not just 0.0.0.0.
        "0.1.2.3",
        // 100.64.0.0/10: carrier-grade NAT and Tailscale.
        "100.64.0.1",
        "100.127.255.254",
        "192.0.0.1",
        "198.18.0.1",
        "198.19.255.255",
        "192.0.2.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "ff02::1",
        "fec0::1",
        "2001:db8::1",
        "64:ff9b:1::1",
        "100::1",
        // fd00:ec2::254: the EC2 metadata service over IPv6.
        "fd00:ec2::254",
        // NAT64 wrapping 127.0.0.1 and 169.254.169.254.
        "64:ff9b::7f00:1",
        "64:ff9b::a9fe:a9fe",
        // IPv4-compatible ::127.0.0.1 and ::10.0.0.1.
        "::7f00:1",
        "::a00:1",
        // 6to4 wrapping 127.0.0.1 and 100.64.0.1.
        "2002:7f00:1::",
        "2002:6440:1::",
        // Teredo.
        "2001::1",
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",
        // IPv4-mapped CGNAT.
        "::ffff:100.64.0.1",
    ];
    for ip in blocked {
        assert!(
            is_private_ip(&ip.parse().unwrap()),
            "{ip} should be blocked"
        );
    }
}

#[test]
fn allows_public_addresses_including_wrapped_public_v4() {
    let allowed = [
        "8.8.8.8",
        "100.63.255.255",
        "100.128.0.1",
        "198.20.0.1",
        "2606:4700:4700::1111",
        "64:ff9b::808:808",
        "2002:808:808::",
        "::ffff:1.1.1.1",
    ];
    for ip in allowed {
        assert!(
            !is_private_ip(&ip.parse().unwrap()),
            "{ip} should be allowed"
        );
    }
}

#[tokio::test]
async fn assert_not_internal_blocks_wrapped_and_cgnat_literals() {
    for raw in [
        "http://100.64.0.1/",
        "http://0.1.2.3/",
        "http://[64:ff9b::7f00:1]/",
        "http://[::127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/",
        "http://[2002:7f00:1::]/",
        "http://[fd00:ec2::254]/",
    ] {
        let url = Url::parse(raw).unwrap();
        assert!(
            matches!(assert_not_internal(&url).await, Err(FetchError::PrivateIp)),
            "{raw} should be refused"
        );
    }
}
