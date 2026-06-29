use super::*;

#[test]
fn builds_deterministic_validation_body() {
    let body = validation_body("wh_test").expect("body should serialize");
    let value: serde_json::Value = serde_json::from_slice(&body).expect("body should be json");

    assert_eq!(value["id"], EVENT_ID);
    assert_eq!(value["event"], EVENT_NAME);
    assert_eq!(value["webhook_id"], "wh_test");
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
    let error = validate_endpoint_url("http://example.com/webhook").expect_err("http is invalid");

    assert_eq!(error, "webhook endpoint URL must use HTTPS");
}

#[test]
fn rejects_localhost_and_private_ips() {
    assert!(validate_endpoint_url("https://localhost/webhook").is_err());
    assert!(validate_endpoint_url("https://127.0.0.1/webhook").is_err());
    assert!(validate_endpoint_url("https://10.1.2.3/webhook").is_err());
    assert!(validate_endpoint_url("https://169.254.169.254/latest/meta-data").is_err());
    assert!(validate_endpoint_url("https://[::1]/webhook").is_err());
}

#[test]
fn accepts_public_https_endpoint() {
    let url = validate_endpoint_url("https://example.com/webhook").expect("public https is valid");

    assert_eq!(url.host_str(), Some("example.com"));
}

#[test]
fn detects_reserved_headers_case_insensitively() {
    assert!(is_reserved_macro_header("X-Macro-Signature"));
    assert!(is_reserved_macro_header("x-macro-event-id"));
    assert!(!is_reserved_macro_header("X-External-Trace"));
}
