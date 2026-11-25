use super::*;
use imap_service_client::Error;
use macro_authorization::CODE_EXECUTION_HEADER;
use utoipa::OpenApi;

#[test]
fn linking_requires_a_person_in_a_session() {
    use CredentialAttribution::{Agent, Person, Routine};
    let session = CredentialOrigin::Session;
    let mut headers = HeaderMap::new();
    assert!(authorize_connection_principal(&session, Person, &headers).is_ok());

    headers.insert(CODE_EXECUTION_HEADER, "1".parse().unwrap());
    let refusal = authorize_connection_principal(&session, Person, &headers).unwrap_err();
    assert!(matches!(refusal.0, ImapConnectionError::PersonRequired));
    assert_eq!(refusal.into_response().status(), StatusCode::FORBIDDEN);
    headers.clear();
    for attribution in [Agent, Routine] {
        assert!(authorize_connection_principal(&session, attribution, &headers).is_err());
    }

    for origin in [
        CredentialOrigin::UserApiKey,
        CredentialOrigin::MacroApiJwt,
        CredentialOrigin::Internal,
    ] {
        assert!(authorize_connection_principal(&origin, Person, &headers).is_err());
    }
}

#[test]
fn public_spec_omits_internal_imap_notifications() {
    assert!(
        !crate::ApiDoc::openapi()
            .paths
            .paths
            .contains_key("/internal/imap/notifications")
    );
}

#[test]
fn public_connection_refusals_expose_a_closed_code_schema() {
    let spec = serde_json::to_value(crate::ApiDoc::openapi()).unwrap();
    let schemas = &spec["components"]["schemas"];
    assert_eq!(
        schemas["ImapConnectionErrorResponse"]["properties"]["code"]["$ref"],
        "#/components/schemas/ImapConnectionErrorCode"
    );
    let codes = schemas["ImapConnectionErrorCode"]["enum"]
        .as_array()
        .unwrap();
    assert!(codes.iter().any(|code| code == "credentials_unreadable"));
    assert!(codes.iter().any(|code| code == "not_found"));

    let responses = &spec["paths"]["/email/links/imap"]["post"]["responses"];
    for status in ["402", "404"] {
        assert_eq!(
            responses[status]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/ImapConnectionErrorResponse"
        );
    }
}

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
            Error::CredentialsUnreadable,
            StatusCode::SERVICE_UNAVAILABLE,
            "credentials_unreadable",
        ),
        (Error::NotFound, StatusCode::NOT_FOUND, "not_found"),
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
fn verification_rate_limits_include_the_provider_retry_delay() {
    use axum::http::header::RETRY_AFTER;

    for (error, delay) in [
        (Error::AccountBusy, "5"),
        (
            Error::RateLimited {
                retry_after_seconds: 17,
            },
            "17",
        ),
    ] {
        let response = ConnectionError(ImapConnectionError::Provider(error)).into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[RETRY_AFTER], delay);
    }
}

#[test]
fn public_connection_contract_uses_the_actor_and_declares_typed_refusals() {
    let spec = serde_json::to_value(crate::ApiDoc::openapi()).unwrap();
    let connect = &spec["components"]["schemas"]["ImapConnectRequest"]["properties"];
    assert!(connect.get("email").is_none());
    let discovery = &spec["paths"]["/email/links/imap/discover"]["post"];
    assert!(discovery.get("requestBody").is_none());
    let suggestion = &spec["paths"]["/email/links/suggestion"]["get"];
    for operation in [discovery, &spec["paths"]["/email/links/imap"]["post"]] {
        assert_eq!(
            operation["responses"]["429"]["headers"]["Retry-After"]["schema"]["type"],
            "integer"
        );
    }
    for response in ["403", "429", "502", "503", "504"]
        .into_iter()
        .map(|status| &discovery["responses"][status])
        .chain([&suggestion["responses"]["503"]])
    {
        assert_eq!(
            response["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/ImapConnectionErrorResponse",
        );
    }
}
