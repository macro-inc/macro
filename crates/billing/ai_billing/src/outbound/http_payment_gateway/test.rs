use super::*;
use crate::inbound::axum_router::SubscriptionPeriodResponse;
use chrono::{DateTime, TimeZone, Utc};
use wiremock::matchers::{header, method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

const CUSTOMER_ID: &str = "cus_123";
const TEAM_ID: Uuid = Uuid::from_u128(7);
const PERIOD_PATH: &str = "/internal/ai-billing/subscription-period";

#[tokio::test]
async fn reads_the_period_for_a_team_scope() {
    let start = Utc.with_ymd_and_hms(2026, 3, 18, 8, 0, 0).unwrap();
    let end = Utc.with_ymd_and_hms(2026, 4, 18, 8, 0, 0).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(PERIOD_PATH))
        .and(query_param("customerId", CUSTOMER_ID))
        .and(query_param(
            "teamId",
            "00000000-0000-0000-0000-000000000007",
        ))
        .and(header("x-internal-auth-key", "key"))
        .respond_with(period_response(start, end))
        .expect(1)
        .mount(&server)
        .await;

    let period = gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Team { team_id: TEAM_ID })
        .await
        .unwrap();

    assert_eq!(period, Some(BillingPeriod { start, end }));
}

#[tokio::test]
async fn reads_the_period_for_the_personal_scope() {
    let start = Utc.with_ymd_and_hms(2026, 4, 10, 0, 0, 0).unwrap();
    let end = Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap();
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(PERIOD_PATH))
        .and(query_param("customerId", CUSTOMER_ID))
        .and(query_param_is_missing("teamId"))
        .and(header("x-internal-auth-key", "key"))
        .respond_with(period_response(start, end))
        .expect(1)
        .mount(&server)
        .await;

    let period = gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
        .unwrap();

    assert_eq!(period, Some(BillingPeriod { start, end }));
}

#[tokio::test]
async fn missing_subscription_is_none() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(PERIOD_PATH))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let period = gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
        .unwrap();

    assert_eq!(period, None);
}

#[tokio::test]
async fn provider_errors_are_payment_errors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(PERIOD_PATH))
        .respond_with(ResponseTemplate::new(500).set_body_string("stripe is down"))
        .expect(1)
        .mount(&server)
        .await;

    match gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
    {
        Err(BillingError::Payment(error)) => assert_eq!(
            format!("{error:#}"),
            "reading the subscription period from the authentication service: internal server error: stripe is down"
        ),
        other => panic!("expected a payment error, got {other:?}"),
    }
}

#[tokio::test]
async fn other_failures_carry_the_response_body() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(PERIOD_PATH))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_string("Failed to deserialize query string: missing field `customerId`"),
        )
        .expect(1)
        .mount(&server)
        .await;

    match gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
    {
        Err(BillingError::Payment(error)) => assert_eq!(
            format!("{error:#}"),
            "reading the subscription period from the authentication service: Failed to deserialize query string: missing field `customerId`"
        ),
        other => panic!("expected a payment error, got {other:?}"),
    }
}

fn gateway(server: &MockServer) -> HttpPaymentGateway {
    HttpPaymentGateway::new(Arc::new(AuthServiceClient::new(
        "key".to_string(),
        server.uri(),
    )))
}

fn period_response(start: DateTime<Utc>, end: DateTime<Utc>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(SubscriptionPeriodResponse { start, end })
}
