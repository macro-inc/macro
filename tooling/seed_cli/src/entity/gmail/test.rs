use super::*;

#[test]
fn default_forward_target_is_local_https() {
    assert!(is_local_https("https://localhost:8090/email/gmail/webhook"));
    assert!(is_local_https("https://127.0.0.1:8090/email/gmail/webhook"));
    assert!(!is_local_https("http://email-service:8080/gmail/webhook"));
    assert!(!is_local_https("https://pubsub.googleapis.com/v1/x"));
}

#[test]
fn local_proxy_ca_loads_the_checked_in_pem() {
    let pem = local_proxy_ca_pem().expect("infra/local/certs/ca.pem must be readable");
    assert!(
        std::str::from_utf8(&pem)
            .unwrap_or_default()
            .contains("BEGIN CERTIFICATE"),
        "checked-in CA is not a PEM"
    );
    assert!(
        local_proxy_ca().is_some(),
        "reqwest must parse the local CA"
    );
}

#[test]
fn webhook_client_builds_for_the_default_https_target() {
    webhook_client("https://localhost:8090/email/gmail/webhook")
        .expect("webhook client should trust the checked-in CA");
}

#[tokio::test]
async fn webhook_client_verifies_local_https_when_the_proxy_is_up() {
    let client = webhook_client("https://localhost:8090/auth/health")
        .expect("webhook client should trust the checked-in CA");
    match client
        .get("https://localhost:8090/auth/health")
        .send()
        .await
    {
        Ok(resp) => assert!(
            resp.status().is_success(),
            "proxy health should be 2xx, got {}",
            resp.status()
        ),
        Err(error) if error.is_connect() => {}
        Err(error) => panic!("local HTTPS webhook client failed TLS: {error:#}"),
    }
}

#[test]
fn plan_is_deterministic_and_never_future_dated() {
    let now = Utc::now();
    let a = generate_plan("bigbox-10k@macro-test.com", 500, 42);
    let b = generate_plan("bigbox-10k@macro-test.com", 500, 42);
    assert_eq!(a.len(), 500);
    for (x, y) in a.iter().zip(&b) {
        assert_eq!(
            x.message_id, y.message_id,
            "same seed must give the same plan"
        );
        assert_eq!(x.subject, y.subject);
    }
    assert!(
        a.iter()
            .all(|m| m.date <= now + chrono::Duration::seconds(5)),
        "no message may be dated in the future"
    );
    let sent = a.iter().filter(|m| m.labels.contains(&"SENT")).count();
    assert!(sent > 0, "threads must include outgoing replies");
}
