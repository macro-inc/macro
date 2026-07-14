use super::*;

#[test]
fn uses_five_second_request_timeout() {
    assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(5));
}

#[test]
fn builds_deterministic_validation_body() {
    let body = validation_body("wh_test", "evt_test").expect("body should serialize");
    let value: serde_json::Value = serde_json::from_slice(&body).expect("body should be json");

    assert_eq!(value["id"], "evt_test");
    assert_eq!(value["event"], EVENT_NAME);
    assert_eq!(value["webhook_id"], "wh_test");
}

#[test]
fn generates_unique_validation_event_ids() {
    let first = new_validation_event_id();
    let second = new_validation_event_id();

    assert!(first.starts_with("evt_"));
    assert!(second.starts_with("evt_"));
    assert_ne!(first, second);
}

#[test]
fn signs_timestamp_and_raw_body() {
    let body = br#"{"event":"webhook.validation.test"}"#;
    let signature = signature_header("secret", "123", body).expect("signature should be created");

    assert_eq!(
        signature,
        "v1=5837022b9dec7b19dc354f820eeac2a9d4935737b6686363613a5e691095b8e5"
    );
}

#[test]
fn rejects_non_https_endpoint() {
    let error = validate_endpoint_url(
        "http://example.com/webhook",
        WebhookEndpointSchemePolicy::HttpsOnly,
    )
    .expect_err("http is invalid");

    assert_eq!(error.message(), "webhook endpoint URL must use HTTPS");
}

#[test]
fn allows_local_http_endpoints_when_policy_permits_them() {
    let policy = WebhookEndpointSchemePolicy::HttpAndHttps;

    for value in [
        "http://localhost/webhook",
        "http://127.0.0.1/webhook",
        "http://10.1.2.3/webhook",
        "http://[::1]/webhook",
        "http://[fe80::1]/webhook",
    ] {
        let url = validate_endpoint_url(value, policy).expect("local endpoint should be allowed");

        assert_eq!(url.scheme(), "http");
    }
}

#[test]
fn rejects_localhost_and_private_ips() {
    let policy = WebhookEndpointSchemePolicy::HttpsOnly;

    assert!(validate_endpoint_url("https://localhost/webhook", policy).is_err());
    assert!(validate_endpoint_url("https://127.0.0.1/webhook", policy).is_err());
    assert!(validate_endpoint_url("https://10.1.2.3/webhook", policy).is_err());
    assert!(validate_endpoint_url("https://169.254.169.254/latest/meta-data", policy).is_err());
    assert!(validate_endpoint_url("https://[::1]/webhook", policy).is_err());
    assert!(validate_endpoint_url("https://[fe80::1]/webhook", policy).is_err());
}

#[tokio::test]
async fn rejects_hosts_that_resolve_to_blocked_addresses() {
    let error = validate_resolved_endpoint_url(
        "https://localhost/webhook",
        WebhookEndpointSchemePolicy::HttpsOnly,
    )
    .await
    .expect_err("localhost is invalid");

    assert_eq!(error.message(), "webhook endpoint host is not allowed");
}

#[tokio::test]
async fn allows_localhost_resolution_when_policy_permits_it() {
    let url = validate_resolved_endpoint_url(
        "http://localhost/webhook",
        WebhookEndpointSchemePolicy::HttpAndHttps,
    )
    .await
    .expect("localhost should resolve");

    assert_eq!(url.host_str(), Some("localhost"));
}

#[test]
fn blocks_ipv6_link_local_addresses() {
    let ip = "fe80::1".parse().expect("valid ipv6");

    assert!(is_blocked_ip(ip));
}

#[test]
fn accepts_public_https_endpoint() {
    let url = validate_endpoint_url(
        "https://example.com/webhook",
        WebhookEndpointSchemePolicy::HttpsOnly,
    )
    .expect("public https is valid");

    assert_eq!(url.host_str(), Some("example.com"));
}

#[test]
fn detects_reserved_headers_case_insensitively() {
    assert!(is_reserved_macro_header("X-Macro-Signature"));
    assert!(is_reserved_macro_header("x-macro-event-id"));
    assert!(!is_reserved_macro_header("X-External-Trace"));
}
