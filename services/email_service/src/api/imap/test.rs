use super::*;
use imap_service_client::Error;

#[tokio::test]
async fn verification_errors_preserve_closed_categories_and_accurate_statuses() {
    for (error, status, code) in [
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
