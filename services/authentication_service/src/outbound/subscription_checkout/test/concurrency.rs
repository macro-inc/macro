use super::*;
use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
use std::collections::BTreeMap;
use tokio::sync::Barrier;

#[derive(Default)]
struct ProviderState {
    sessions: Vec<stripe::CheckoutSession>,
    idempotency: HashMap<String, (BTreeMap<String, String>, stripe::CheckoutSession)>,
    creates: usize,
    create_keys: Vec<String>,
    cached_server_failure: bool,
    fail_first_response: bool,
    hide_created_once: bool,
    complete_on_expire: bool,
    expire_before_retrieve: bool,
    list_count: usize,
}

#[derive(Clone)]
struct Provider {
    state: Arc<Mutex<ProviderState>>,
    initial_lists: Option<Arc<Barrier>>,
}

async fn provider(State(provider): State<Provider>, request: Request) -> axum::response::Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let key = request
        .headers()
        .get("idempotency-key")
        .map(|value| value.to_str().unwrap().to_owned());
    let body = to_bytes(request.into_body(), 1_000_000).await.unwrap();
    let params: BTreeMap<String, String> =
        url::form_urlencoded::parse(&body).into_owned().collect();
    let first_list = {
        let mut state = provider.state.lock().unwrap();
        if path == "/v1/checkout/sessions" && method == "GET" {
            state.list_count += 1;
            state.list_count <= 2 && provider.initial_lists.is_some()
        } else {
            false
        }
    };
    if first_list {
        provider.initial_lists.as_ref().unwrap().wait().await;
        return Json(page(vec![], false)).into_response();
    }
    let mut state = provider.state.lock().unwrap();
    if path == "/v1/subscriptions" {
        return Json(empty_history()).into_response();
    }
    if path == "/v1/checkout/sessions" && method == "GET" {
        if state.hide_created_once {
            state.hide_created_once = false;
            return Json(page(vec![], false)).into_response();
        }
        return Json(page(state.sessions.clone(), false)).into_response();
    }
    if path.ends_with("/expire") {
        if state.complete_on_expire {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":{"type":"invalid_request_error", "message":"Session has completed"}}))).into_response();
        }
        let id = path.split('/').nth(4).unwrap();
        let session = state
            .sessions
            .iter_mut()
            .find(|session| session.id.as_str() == id)
            .unwrap();
        session.status = Some(stripe::CheckoutSessionStatus::Expired);
        return Json(session.clone()).into_response();
    }
    if path == "/v1/checkout/sessions" && method == "POST" {
        let key = key.expect("every subscription create must be idempotent");
        state.create_keys.push(key.clone());
        if state.cached_server_failure {
            return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error":{"type":"api_error", "message":"Cached provider failure"}}))).into_response();
        }
        if let Some((original, session)) = state.idempotency.get(&key) {
            if original != &params {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error":{"type":"idempotency_error", "message":"Parameters differ"}}))).into_response();
            }
            return Json(session.clone()).into_response();
        }
        state.creates += 1;
        let session = stripe::CheckoutSession {
            id: format!("cs_test_{}", state.creates).parse().unwrap(),
            status: Some(stripe::CheckoutSessionStatus::Open),
            mode: stripe::CheckoutSessionMode::Subscription,
            url: Some(format!("https://checkout.stripe.com/{}", state.creates)),
            metadata: Some(
                [(
                    "checkout_terms".into(),
                    params.get("metadata[checkout_terms]").unwrap().clone(),
                )]
                .into(),
            ),
            ..Default::default()
        };
        state.idempotency.insert(key, (params, session.clone()));
        state.sessions.insert(0, session.clone());
        if state.fail_first_response {
            state.fail_first_response = false;
            state.hide_created_once = true;
            // The provider committed a 200 result, but the response body is
            // truncated in transit. Its idempotency cache still holds success.
            return (StatusCode::OK, "{\"id\":").into_response();
        }
        return Json(session).into_response();
    }
    if method == "GET" && path.starts_with("/v1/checkout/sessions/") {
        let id = path.rsplit('/').next().unwrap();
        let expired = state.expire_before_retrieve;
        let session = state
            .sessions
            .iter_mut()
            .find(|session| session.id.as_str() == id)
            .unwrap();
        if expired {
            session.status = Some(stripe::CheckoutSessionStatus::Expired);
        }
        return Json(session.clone()).into_response();
    }
    panic!("unexpected request: {method} {path}");
}

async fn setup(
    concurrent: bool,
) -> (
    StripeCheckoutGateway<()>,
    Provider,
    tokio::task::JoinHandle<()>,
) {
    let provider_state = Provider {
        state: Arc::new(Mutex::new(ProviderState::default())),
        initial_lists: concurrent.then(|| Arc::new(Barrier::new(2))),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let app = Router::new()
        .fallback(provider)
        .with_state(provider_state.clone());
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
            premium: "price_pro".into(),
            max: Some("price_max".into()),
        },
    );
    (gateway, provider_state, task)
}

#[tokio::test]
async fn simultaneous_same_plan_creates_one_payable_session() {
    let (gateway, provider, task) = setup(true).await;
    let (first, second) = tokio::join!(
        gateway.checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None
        ),
        gateway.checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None
        ),
    );
    assert_eq!(first.unwrap(), second.unwrap());
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn concurrent_pro_and_max_intents_conflict_instead_of_creating_two_sessions() {
    let (gateway, provider, task) = setup(true).await;
    let mut max = request();
    max.plan = SeatPlan::Max;
    let (first, second) = tokio::join!(
        gateway.checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None
        ),
        gateway.checkout("cus_test".parse().unwrap(), max, CheckoutTerms::Paid, None),
    );
    assert!(matches!(
        (&first, &second),
        (Ok(_), Err(StripeCheckoutError::CheckoutConflict))
            | (Err(StripeCheckoutError::CheckoutConflict), Ok(_))
    ));
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn concurrent_trial_and_paid_intents_share_the_same_generation() {
    let (gateway, provider, task) = setup(true).await;
    let (first, second) = tokio::join!(
        gateway.checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Trial,
            None
        ),
        gateway.checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None
        ),
    );
    assert!(matches!(
        (&first, &second),
        (Ok(_), Err(StripeCheckoutError::CheckoutConflict))
            | (Err(StripeCheckoutError::CheckoutConflict), Ok(_))
    ));
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn lost_successful_response_reuses_the_key_even_before_session_is_listed() {
    let (gateway, provider, task) = setup(false).await;
    provider.state.lock().unwrap().fail_first_response = true;
    assert!(
        gateway
            .checkout(
                "cus_test".parse().unwrap(),
                request(),
                CheckoutTerms::Paid,
                None
            )
            .await
            .is_err()
    );
    let retry = gateway
        .checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None,
        )
        .await
        .unwrap();
    assert_eq!(retry, "https://checkout.stripe.com/1");
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn changing_plan_expires_the_old_link_and_retries_reuse_the_new_one() {
    let (gateway, provider, task) = setup(false).await;
    gateway
        .checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None,
        )
        .await
        .unwrap();
    let mut max = request();
    max.plan = SeatPlan::Max;
    let url = gateway
        .checkout("cus_test".parse().unwrap(), max, CheckoutTerms::Paid, None)
        .await
        .unwrap();
    let mut max = request();
    max.plan = SeatPlan::Max;
    assert_eq!(
        gateway
            .checkout("cus_test".parse().unwrap(), max, CheckoutTerms::Paid, None)
            .await
            .unwrap(),
        url
    );
    let state = provider.state.lock().unwrap();
    assert_eq!(state.creates, 2);
    assert_eq!(
        state
            .sessions
            .iter()
            .filter(|session| session.status == Some(stripe::CheckoutSessionStatus::Open))
            .count(),
        1
    );
    task.abort();
}

#[tokio::test]
async fn completion_racing_expiration_prevents_a_new_checkout() {
    let (gateway, provider, task) = setup(false).await;
    gateway
        .checkout(
            "cus_test".parse().unwrap(),
            request(),
            CheckoutTerms::Paid,
            None,
        )
        .await
        .unwrap();
    provider.state.lock().unwrap().complete_on_expire = true;
    let mut max = request();
    max.plan = SeatPlan::Max;
    assert!(
        gateway
            .checkout("cus_test".parse().unwrap(), max, CheckoutTerms::Paid, None)
            .await
            .is_err()
    );
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn an_idempotency_response_for_an_expired_session_is_not_redirected_to() {
    let (gateway, provider, task) = setup(false).await;
    provider.state.lock().unwrap().expire_before_retrieve = true;
    assert!(matches!(
        gateway
            .checkout(
                "cus_test".parse().unwrap(),
                request(),
                CheckoutTerms::Paid,
                None
            )
            .await,
        Err(StripeCheckoutError::CheckoutConflict)
    ));
    assert_eq!(provider.state.lock().unwrap().creates, 1);
    task.abort();
}

#[tokio::test]
async fn a_cached_stripe_failure_never_rotates_the_key_to_risk_another_charge() {
    let (gateway, provider, task) = setup(false).await;
    provider.state.lock().unwrap().cached_server_failure = true;
    for _ in 0..2 {
        assert!(
            gateway
                .checkout(
                    "cus_test".parse().unwrap(),
                    request(),
                    CheckoutTerms::Paid,
                    None
                )
                .await
                .is_err()
        );
    }
    let state = provider.state.lock().unwrap();
    assert_eq!(
        state.create_keys,
        [
            "subscription-checkout-cus_test-first",
            "subscription-checkout-cus_test-first"
        ]
    );
    assert_eq!(state.creates, 0);
    task.abort();
}
