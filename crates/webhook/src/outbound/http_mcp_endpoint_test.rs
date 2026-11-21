use super::*;
use crate::domain::models::WebhookEndpointSchemePolicy;
use wiremock::matchers::{header, header_exists, method};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

fn secret() -> SigningSecret {
    SigningSecret::parse(SECRET).expect("valid secret")
}

fn subscription_id() -> McpSubscriptionId {
    McpSubscriptionId::from_stored("sub_0123456789abcdef0123456789abcdef".to_owned())
}

fn client() -> ReqwestWebhookValidationClient {
    ReqwestWebhookValidationClient::new_with_endpoint_scheme_policy(
        WebhookEndpointSchemePolicy::HttpAndHttps,
    )
    .expect("client builds")
}

fn header_value<'a>(request: &'a Request, name: &str) -> &'a str {
    request
        .headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
}

/// Whether the request carries a valid Standard Webhooks signature.
fn signed(request: &Request) -> bool {
    let timestamp = header_value(request, TIMESTAMP_HEADER)
        .parse::<i64>()
        .unwrap_or_default();
    secret().verify(
        header_value(request, ID_HEADER),
        timestamp,
        &request.body,
        header_value(request, SIGNATURE_HEADER),
    )
}

/// A receiver that checks the signature and echoes the challenge, as the
/// spec asks of a callback endpoint.
struct EchoChallenge;

impl Respond for EchoChallenge {
    fn respond(&self, request: &Request) -> ResponseTemplate {
        if !signed(request) {
            return ResponseTemplate::new(401);
        }
        let Ok(body) = serde_json::from_slice::<serde_json::Value>(&request.body) else {
            return ResponseTemplate::new(400);
        };
        if body["type"] != "verification" {
            return ResponseTemplate::new(400);
        }
        ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({ "challenge": body["challenge"] }))
    }
}

async fn server_answering(response: impl Respond + 'static) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header(SUBSCRIPTION_ID_HEADER, subscription_id().as_str()))
        .and(header("content-type", "application/json"))
        .respond_with(response)
        .mount(&server)
        .await;
    server
}

#[tokio::test]
async fn verification_passes_when_the_signed_challenge_is_echoed() {
    let server = server_answering(EchoChallenge).await;
    client()
        .verify(&server.uri(), &secret(), &subscription_id())
        .await
        .expect("verified");

    let requests = server.received_requests().await.expect("recorded");
    let id = header_value(&requests[0], ID_HEADER);
    assert!(id.starts_with("msg_verification_"), "{id}");
}

#[tokio::test]
async fn verification_fails_on_a_wrong_or_missing_echo() {
    let wrong = server_answering(
        ResponseTemplate::new(200).set_body_json(serde_json::json!({ "challenge": "guess" })),
    )
    .await;
    let empty = server_answering(ResponseTemplate::new(204)).await;
    let huge =
        server_answering(ResponseTemplate::new(200).set_body_string("x".repeat(10_000))).await;
    for server in [wrong, empty, huge] {
        assert_eq!(
            client()
                .verify(&server.uri(), &secret(), &subscription_id())
                .await,
            Err(McpEndpointVerifyError::Failed(
                McpEndpointFailure::ChallengeFailed
            ))
        );
    }
}

#[tokio::test]
async fn verification_failures_are_categorised() {
    let not_found = server_answering(ResponseTemplate::new(404)).await;
    let broken = server_answering(ResponseTemplate::new(503)).await;
    assert_eq!(
        client()
            .verify(&not_found.uri(), &secret(), &subscription_id())
            .await,
        Err(McpEndpointVerifyError::Failed(McpEndpointFailure::Http4xx))
    );
    assert_eq!(
        client()
            .verify(&broken.uri(), &secret(), &subscription_id())
            .await,
        Err(McpEndpointVerifyError::Failed(McpEndpointFailure::Http5xx))
    );

    // A port nothing listens on.
    let closed = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("address")
    };
    assert_eq!(
        client()
            .verify(
                &format!("http://{closed}/hook"),
                &secret(),
                &subscription_id()
            )
            .await,
        Err(McpEndpointVerifyError::Failed(
            McpEndpointFailure::ConnectionRefused
        ))
    );
}

#[tokio::test]
async fn verification_refuses_urls_the_policy_forbids() {
    let https_only = ReqwestWebhookValidationClient::new().expect("client builds");
    assert!(matches!(
        https_only
            .verify("http://example.com/hook", &secret(), &subscription_id())
            .await,
        Err(McpEndpointVerifyError::InvalidUrl(_))
    ));
    assert!(matches!(
        https_only
            .verify("https://127.0.0.1/hook", &secret(), &subscription_id())
            .await,
        Err(McpEndpointVerifyError::InvalidUrl(_))
    ));
}

#[tokio::test]
async fn deliveries_are_signed_with_the_message_id() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(header(ID_HEADER, "msg_fixed"))
        .and(header(SUBSCRIPTION_ID_HEADER, subscription_id().as_str()))
        .and(header_exists(TIMESTAMP_HEADER))
        .respond_with(|request: &Request| {
            ResponseTemplate::new(if signed(request) { 202 } else { 401 })
        })
        .mount(&server)
        .await;
    let outcome = client()
        .deliver(
            &server.uri(),
            &secret(),
            &subscription_id(),
            "msg_fixed",
            br#"{"eventId":"e"}"#.to_vec(),
        )
        .await;
    assert_eq!(outcome, McpDeliveryOutcome::Delivered);
    let requests = server.received_requests().await.expect("recorded");
    assert_eq!(requests[0].body, br#"{"eventId":"e"}"#);
}

#[tokio::test]
async fn delivery_outcomes_follow_the_status() {
    for (status, expected) in [
        (410, McpDeliveryOutcome::Permanent),
        (413, McpDeliveryOutcome::Permanent),
        (
            429,
            McpDeliveryOutcome::Retryable(McpEndpointFailure::Http4xx),
        ),
        (
            500,
            McpDeliveryOutcome::Retryable(McpEndpointFailure::Http5xx),
        ),
    ] {
        let server = server_answering(ResponseTemplate::new(status)).await;
        let outcome = client()
            .deliver(
                &server.uri(),
                &secret(),
                &subscription_id(),
                "msg_1",
                Vec::new(),
            )
            .await;
        assert_eq!(outcome, expected, "status {status}");
    }

    let https_only = ReqwestWebhookValidationClient::new().expect("client builds");
    assert_eq!(
        https_only
            .deliver(
                "http://example.com/hook",
                &secret(),
                &subscription_id(),
                "msg_1",
                Vec::new()
            )
            .await,
        McpDeliveryOutcome::Permanent
    );
}
