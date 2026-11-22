use super::*;
use imap_service_client::Error;

#[tokio::test]
async fn verification_errors_preserve_closed_categories_and_accurate_statuses() {
    for (error, status, code) in [
        (
            Error::AccountBusy,
            StatusCode::TOO_MANY_REQUESTS,
            "throttled",
        ),
        // Operation-only size failures do not become an authentication rejection.
        (
            Error::MessageTooLarge,
            StatusCode::BAD_GATEWAY,
            "connection_unavailable",
        ),
        (
            Error::CredentialsRejected,
            StatusCode::UNPROCESSABLE_ENTITY,
            "credentials_rejected",
        ),
        (
            Error::DnsUnavailable,
            StatusCode::BAD_GATEWAY,
            "dns_unavailable",
        ),
        (
            Error::TcpUnavailable,
            StatusCode::BAD_GATEWAY,
            "tcp_unavailable",
        ),
        (
            Error::TlsUnavailable,
            StatusCode::BAD_GATEWAY,
            "tls_unavailable",
        ),
        (
            Error::ConnectionTimedOut,
            StatusCode::GATEWAY_TIMEOUT,
            "connection_timed_out",
        ),
    ] {
        let response = ConnectionError(ImapConnectionError::Provider(error)).into_response();
        assert_eq!(response.status(), status);
        let body = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["code"], code);
        // Only static domain messages cross this boundary, never provider replies.
        assert_eq!(
            body["message"],
            ImapConnectionError::Provider(error).to_string()
        );
    }
}

#[test]
fn public_mailbox_inputs_reject_malformed_identities_before_domain_admission() {
    for email in [
        "not-an-address",
        "bad..local@example.net",
        "owner@@example.net",
        " owner@example.net",
    ] {
        assert!(
            serde_json::from_value::<ImapDiscoverRequest>(serde_json::json!({"email": email}))
                .is_err()
        );
        let login = serde_json::json!({
            "endpoint": {"host": "mail.example.net", "port": 993, "tls": "implicit", "username": "account-id"},
            "password": "synthetic-test-secret"
        });
        assert!(
            serde_json::from_value::<ImapConnectRequest>(serde_json::json!({
                "requestId": "00000000-0000-7000-8000-000000000001", "linkId": null,
                "email": email, "imap": login, "smtp": login, "confirmedHosts": ["mail.example.net"]
            }))
            .is_err()
        );
    }
}
