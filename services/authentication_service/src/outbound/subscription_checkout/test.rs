use super::*;
use axum::{
    Json, Router,
    extract::{Request, State},
};
use std::collections::HashMap;
use std::{collections::VecDeque, sync::Mutex};
use teams::domain::model::SeatPlan;

fn request() -> CheckoutRequest<'static> {
    CheckoutRequest {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        plan: SeatPlan::Premium,
        onboarding_trial: true,
        success_url: "https://macro.com/app/onboarding?subscriptionSuccess=true".into(),
        cancel_url: "https://macro.com/app/onboarding?subscriptionCancel=true".into(),
        discount: None,
        metadata: HashMap::new(),
    }
}

#[test]
fn trial_payload_requires_no_coupon_and_works_without_metadata() {
    let input = request();
    let params = checkout_params(
        "cus_test".parse().unwrap(),
        &input,
        "price_premium",
        CheckoutTerms::Trial,
        None,
    );
    let json = serde_json::to_value(params).unwrap();
    assert_eq!(json["customer"], "cus_test");
    assert_eq!(json["subscription_data"]["trial_period_days"], 30);
    assert_eq!(json["payment_method_collection"], "always");
    assert_eq!(json["metadata"][TRIAL_SESSION_MARKER], "30");
    assert!(
        json.get("allow_promotion_codes")
            .is_none_or(serde_json::Value::is_null)
    );
    assert!(json.get("discounts").is_none_or(serde_json::Value::is_null));
    assert_eq!(json["line_items"][0]["price"], "price_premium");
    assert_eq!(json["line_items"][0]["quantity"], 1);
    assert_eq!(json["success_url"], input.success_url);
    assert_eq!(json["cancel_url"], input.cancel_url);
}

#[test]
fn an_open_trial_is_reused_only_for_the_same_team_and_return_destinations() {
    let mut input = request();
    input.metadata.insert("team_id".into(), "team-first".into());
    let session = stripe::CheckoutSession {
        success_url: Some(input.success_url.clone()),
        cancel_url: Some(input.cancel_url.clone()),
        metadata: Some(input.metadata.clone()),
        ..Default::default()
    };
    assert!(trial_session_matches(&session, &input));
    input
        .metadata
        .insert("team_id".into(), "team-second".into());
    assert!(!trial_session_matches(&session, &input));
    input.metadata.insert("team_id".into(), "team-first".into());
    input.success_url = "https://dev.macro.com/app/onboarding?subscriptionSuccess=true".into();
    assert!(!trial_session_matches(&session, &input));
}

#[test]
fn trial_keeps_team_and_conversion_metadata() {
    let mut input = request();
    input.metadata.insert("team_id".into(), "team-test".into());
    input
        .metadata
        .insert("owner_id".into(), "macro|test@example.com".into());
    input
        .metadata
        .insert("ga_client_id".into(), "test-client".into());
    let params = checkout_params(
        "cus_test".parse().unwrap(),
        &input,
        "price_premium",
        CheckoutTerms::Trial,
        None,
    );
    let json = serde_json::to_value(params).unwrap();
    assert_eq!(json["subscription_data"]["trial_period_days"], 30);
    assert_eq!(
        json["subscription_data"]["metadata"]["team_id"],
        "team-test"
    );
    assert_eq!(
        json["subscription_data"]["metadata"]["ga_client_id"],
        "test-client"
    );
}

#[test]
fn ordinary_paid_checkout_does_not_acquire_a_trial() {
    let input = request();
    let params = checkout_params(
        "cus_test".parse().unwrap(),
        &input,
        "price_premium",
        CheckoutTerms::Paid,
        None,
    );
    let json = serde_json::to_value(params).unwrap();
    assert!(
        json["subscription_data"]
            .get("trial_period_days")
            .is_none_or(serde_json::Value::is_null)
    );
    assert_eq!(json["allow_promotion_codes"], true);
}

#[derive(Clone)]
struct StripeStub {
    responses: Arc<Mutex<VecDeque<serde_json::Value>>>,
    requests: Arc<Mutex<Vec<String>>>,
}

async fn respond(State(stub): State<StripeStub>, request: Request) -> Json<serde_json::Value> {
    stub.requests
        .lock()
        .unwrap()
        .push(format!("{} {}", request.method(), request.uri()));
    Json(
        stub.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected Stripe request"),
    )
}

async fn stub_gateway(
    responses: Vec<serde_json::Value>,
) -> (
    StripeCheckoutGateway<()>,
    StripeStub,
    tokio::task::JoinHandle<()>,
) {
    let stub = StripeStub {
        responses: Arc::new(Mutex::new(responses.into())),
        requests: Arc::new(Mutex::new(Vec::new())),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let app = Router::new().fallback(respond).with_state(stub.clone());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let gateway = StripeCheckoutGateway::new(
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://unused:unused@localhost/unused")
            .unwrap(),
        Arc::new(stripe::Client::from_url(url.as_str(), "sk_test_fixture")),
        Arc::new(()),
        SeatPrices {
            premium: "price_test".into(),
            max: None,
        },
    );
    (gateway, stub, task)
}

fn existing_session(status: stripe::CheckoutSessionStatus) -> stripe::CheckoutSession {
    let input = request();
    stripe::CheckoutSession {
        id: "cs_test_existing".parse().unwrap(),
        status: Some(status),
        url: Some("https://checkout.stripe.com/existing".into()),
        success_url: Some(input.success_url),
        cancel_url: Some(input.cancel_url),
        metadata: Some([(TRIAL_SESSION_MARKER.into(), "30".into())].into()),
        ..Default::default()
    }
}

fn page(sessions: Vec<stripe::CheckoutSession>, more: bool) -> serde_json::Value {
    serde_json::json!({"object": "list", "url": "/v1/checkout/sessions", "data": sessions, "has_more": more})
}

#[tokio::test]
async fn reopening_checkout_reuses_the_existing_trial_link() {
    let (gateway, stub, task) = stub_gateway(vec![page(
        vec![existing_session(stripe::CheckoutSessionStatus::Open)],
        false,
    )])
    .await;
    let attempt = gateway
        .trial_attempt(&"cus_test".parse().unwrap(), &request())
        .await
        .unwrap();
    task.abort();
    assert!(
        matches!(attempt, TrialSessionAttempt::Reuse(url) if url == "https://checkout.stripe.com/existing")
    );
    assert_eq!(stub.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn expired_checkout_has_a_stable_new_idempotency_key() {
    let (gateway, _, task) = stub_gateway(vec![page(
        vec![existing_session(stripe::CheckoutSessionStatus::Expired)],
        false,
    )])
    .await;
    let attempt = gateway
        .trial_attempt(&"cus_test".parse().unwrap(), &request())
        .await
        .unwrap();
    task.abort();
    assert!(
        matches!(attempt, TrialSessionAttempt::Create(key) if key == "onboarding-trial-cus_test-after-cs_test_existing")
    );
}

#[tokio::test]
async fn checkout_completed_during_history_lookup_cannot_be_created_again() {
    let (gateway, _, task) = stub_gateway(vec![page(
        vec![existing_session(stripe::CheckoutSessionStatus::Complete)],
        false,
    )])
    .await;
    let attempt = gateway
        .trial_attempt(&"cus_test".parse().unwrap(), &request())
        .await;
    task.abort();
    assert!(matches!(
        attempt,
        Err(StripeCheckoutError::UnexpectedResponse)
    ));
}

#[tokio::test]
async fn changed_team_expires_the_old_trial_before_creating_another() {
    let session = existing_session(stripe::CheckoutSessionStatus::Open);
    let expired = existing_session(stripe::CheckoutSessionStatus::Expired);
    let (gateway, stub, task) = stub_gateway(vec![
        page(vec![session], false),
        serde_json::to_value(expired).unwrap(),
    ])
    .await;
    let mut input = request();
    input.metadata.insert("team_id".into(), "new-team".into());
    let attempt = gateway
        .trial_attempt(&"cus_test".parse().unwrap(), &input)
        .await
        .unwrap();
    task.abort();
    assert!(matches!(attempt, TrialSessionAttempt::Create(_)));
    assert_eq!(
        stub.requests.lock().unwrap()[1],
        "POST /v1/checkout/sessions/cs_test_existing/expire"
    );
}

#[tokio::test]
async fn trial_lookup_reads_past_a_page_of_unrelated_checkouts() {
    let unrelated = stripe::CheckoutSession {
        id: "cs_test_unrelated".parse().unwrap(),
        ..Default::default()
    };
    let (gateway, stub, task) = stub_gateway(vec![
        page(vec![unrelated], true),
        page(
            vec![existing_session(stripe::CheckoutSessionStatus::Open)],
            false,
        ),
    ])
    .await;
    let attempt = gateway
        .trial_attempt(&"cus_test".parse().unwrap(), &request())
        .await
        .unwrap();
    task.abort();
    assert!(matches!(attempt, TrialSessionAttempt::Reuse(_)));
    assert!(stub.requests.lock().unwrap()[1].contains("starting_after=cs_test_unrelated"));
}

#[tokio::test]
async fn history_includes_canceled_subscriptions_and_every_page() {
    let canceled = stripe::Subscription {
        id: "sub_canceled".parse().unwrap(),
        customer: stripe::Expandable::Id("cus_test".parse().unwrap()),
        status: stripe::SubscriptionStatus::Canceled,
        ..Default::default()
    };
    let trial = stripe::Subscription {
        id: "sub_trial".parse().unwrap(),
        customer: stripe::Expandable::Id("cus_test".parse().unwrap()),
        status: stripe::SubscriptionStatus::Trialing,
        ..Default::default()
    };
    let (gateway, stub, task) = stub_gateway(vec![
        serde_json::json!({"object":"list", "url":"/v1/subscriptions", "data":[canceled], "has_more":true}),
        serde_json::json!({"object":"list", "url":"/v1/subscriptions", "data":[trial], "has_more":false}),
    ]).await;
    let history = subscription_history(&gateway.stripe, &"cus_test".parse().unwrap())
        .await
        .unwrap();
    task.abort();
    assert!(history.has_previous_subscription);
    assert!(history.has_active_subscription);
    let requests = stub.requests.lock().unwrap();
    assert!(
        requests
            .iter()
            .all(|request| request.contains("status=all"))
    );
    assert!(requests[1].contains("starting_after=sub_canceled"));
}
