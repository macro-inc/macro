use super::*;

#[tokio::test]
async fn rejects_non_https() {
    let err = DnsEndpointValidator
        .validate("http://example.com/hook")
        .await
        .unwrap_err();
    assert!(matches!(err, EndpointValidationError::NotHttps));
}

#[tokio::test]
async fn rejects_localhost_and_internal_suffixes() {
    for url in [
        "https://localhost/hook",
        "https://api.internal/hook",
        "https://foo.local/hook",
    ] {
        let err = DnsEndpointValidator.validate(url).await.unwrap_err();
        assert!(
            matches!(err, EndpointValidationError::HostNotAllowed),
            "{url} should be host-not-allowed, got {err:?}"
        );
    }
}

#[tokio::test]
async fn rejects_literal_private_and_metadata_ips() {
    for url in [
        "https://127.0.0.1/hook",
        "https://10.0.0.5/hook",
        "https://192.168.1.10/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://100.64.1.1/hook",
    ] {
        let err = DnsEndpointValidator.validate(url).await.unwrap_err();
        assert!(
            matches!(err, EndpointValidationError::PrivateAddress),
            "{url} should be private-address, got {err:?}"
        );
    }
}

#[tokio::test]
async fn rejects_malformed_url() {
    let err = DnsEndpointValidator
        .validate("not a url")
        .await
        .unwrap_err();
    assert!(matches!(err, EndpointValidationError::Malformed(_)));
}

#[test]
fn ip_classification() {
    assert!(is_internal_ip(&"127.0.0.1".parse().unwrap()));
    assert!(is_internal_ip(&"169.254.169.254".parse().unwrap()));
    assert!(is_internal_ip(&"::1".parse().unwrap()));
    assert!(is_internal_ip(&"fd00::1".parse().unwrap()));
    assert!(is_internal_ip(&"::ffff:10.0.0.1".parse().unwrap()));
    // Deprecated IPv4-compatible IPv6 form must not bypass the IPv4 checks.
    assert!(is_internal_ip(&"::192.168.1.1".parse().unwrap()));
    assert!(is_internal_ip(&"::ffff:169.254.169.254".parse().unwrap()));
    assert!(!is_internal_ip(&"93.184.216.34".parse().unwrap()));
    assert!(!is_internal_ip(
        &"2606:2800:220:1:248:1893:25c8:1946".parse().unwrap()
    ));
}
