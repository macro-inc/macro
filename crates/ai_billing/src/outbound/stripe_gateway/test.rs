use super::*;
use chrono::TimeZone;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::HashMap;
use wiremock::matchers::{method, path, query_param, query_param_is_missing};
use wiremock::{Mock, MockServer, ResponseTemplate};

const CUSTOMER_ID: &str = "cus_test";
const STALE_PAYMENT_METHOD: &str = "pm_stale";
const CURRENT_PAYMENT_METHOD: &str = "pm_current";
const PERSONAL_PAYMENT_METHOD: &str = "pm_personal";
const TEAM_PAYMENT_METHOD: &str = "pm_team";
const INVOICE_ID: &str = "in_overage";
const TEAM_ID: Uuid = Uuid::from_u128(7);

#[tokio::test]
async fn open_overage_invoice_keeps_create_stable_and_updates_current_routing() {
    let invoice = stripe_response(&draft_invoice());
    let invoice_item = stripe_response(&draft_invoice_item());
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(
            vec![stripe_response(&subscription(
                "sub_active",
                stripe::SubscriptionStatus::Active,
                Some(CURRENT_PAYMENT_METHOD),
                None,
            ))],
            false,
        ),
    )
    .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoiceitems"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice_item))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/finalize")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    gateway(&server)
        .open_overage_invoice(OverageChargeRequest {
            customer_id: CUSTOMER_ID.to_string(),
            charge_id: Uuid::from_u128(1),
            amount_cents: 2_500,
            description: "Macro AI usage beyond plan".to_string(),
            scope: SubscriptionScope::Personal,
        })
        .await
        .expect("open overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");

    let create = post_request(&requests, "/v1/invoices");
    let create_body = body_str(create);
    assert_eq!(form_value(create_body, "default_payment_method"), None);
    assert_eq!(form_value(create_body, "subscription"), None);
    assert_eq!(form_value(create_body, "auto_advance"), Some("false"));
    assert_eq!(
        form_value(
            create_body,
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        None
    );
    assert_eq!(
        form_value(create_body, &format!("metadata[{PURPOSE_METADATA_KEY}]")),
        Some(PURPOSE_AI_OVERAGE)
    );
    assert_eq!(
        form_value(create_body, &format!("metadata[{CHARGE_METADATA_KEY}]")),
        Some("00000000-0000-0000-0000-000000000001")
    );
    assert_eq!(
        idempotency_key(create),
        Some("ai_overage:00000000-0000-0000-0000-000000000001:invoice")
    );

    let update = post_request(&requests, &format!("/v1/invoices/{INVOICE_ID}"));
    let update_body = body_str(update);
    assert_eq!(
        form_value(update_body, "default_payment_method"),
        Some(CURRENT_PAYMENT_METHOD)
    );
    assert_eq!(
        form_value(
            update_body,
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        Some(PERSONAL_SCOPE_STAMP)
    );
    assert_eq!(idempotency_key(update), None);

    let item = post_request(&requests, "/v1/invoiceitems");
    let item_body = body_str(item);
    assert_eq!(
        form_value(
            item_body,
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        None
    );
    assert_eq!(form_value(item_body, "default_payment_method"), None);
    assert_eq!(form_value(item_body, "subscription"), None);
    assert_eq!(
        form_value(item_body, &format!("metadata[{PURPOSE_METADATA_KEY}]")),
        Some(PURPOSE_AI_OVERAGE)
    );
    assert_eq!(
        form_value(item_body, &format!("metadata[{CHARGE_METADATA_KEY}]")),
        Some("00000000-0000-0000-0000-000000000001")
    );
    assert_eq!(
        idempotency_key(item),
        Some("ai_overage:00000000-0000-0000-0000-000000000001:item")
    );

    let create_at = request_position(&requests, "POST", "/v1/invoices");
    let retrieve_at = request_position(&requests, "GET", &format!("/v1/invoices/{INVOICE_ID}"));
    let update_at = request_position(&requests, "POST", &format!("/v1/invoices/{INVOICE_ID}"));
    let item_at = request_position(&requests, "POST", "/v1/invoiceitems");
    let finalize_at = request_position(
        &requests,
        "POST",
        &format!("/v1/invoices/{INVOICE_ID}/finalize"),
    );
    assert!(create_at < retrieve_at, "{requests:?}");
    assert!(retrieve_at < update_at, "{requests:?}");
    assert!(update_at < item_at, "{requests:?}");
    assert!(item_at < finalize_at, "{requests:?}");
}

#[tokio::test]
async fn pay_overage_invoice_updates_a_stale_open_invoice_before_paying() {
    let invoice = stripe_response(&open_invoice(Some(STALE_PAYMENT_METHOD), None));
    let paid = stripe_response(&paid_invoice(TEAM_PAYMENT_METHOD, None));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, both_subscriptions()).await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/pay")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    let paid_now = gateway(&server)
        .pay_overage_invoice(
            Uuid::from_u128(1),
            INVOICE_ID,
            SubscriptionScope::Team { team_id: TEAM_ID },
        )
        .await
        .expect("pay overage invoice");
    assert!(paid_now);

    let requests = server.received_requests().await.expect("recorded requests");
    let update_at = request_position(&requests, "POST", &format!("/v1/invoices/{INVOICE_ID}"));
    let pay_at = request_position(&requests, "POST", &format!("/v1/invoices/{INVOICE_ID}/pay"));
    assert!(update_at < pay_at);
    let update = &requests[update_at];
    let pay = &requests[pay_at];
    assert_eq!(idempotency_key(update), None);
    assert_eq!(
        form_value(body_str(update), "default_payment_method"),
        Some(TEAM_PAYMENT_METHOD)
    );
    assert_eq!(
        form_value(
            body_str(update),
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        Some("00000000-0000-0000-0000-000000000007")
    );
    assert!(idempotency_key(pay).is_some_and(|key| key.starts_with("ai_overage:")));
    assert_eq!(
        form_value(body_str(pay), "payment_method"),
        Some(TEAM_PAYMENT_METHOD)
    );
}

#[tokio::test]
async fn open_overage_invoice_rejects_distinct_subscription_methods_without_posting() {
    let server = MockServer::start().await;
    mount_customer(&server).await;
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .and(query_param("customer", CUSTOMER_ID))
        .and(query_param_is_missing("starting_after"))
        .respond_with(ResponseTemplate::new(200).set_body_json(subscription_page(
            vec![stripe_response(&subscription(
                "sub_first",
                stripe::SubscriptionStatus::Active,
                Some(PERSONAL_PAYMENT_METHOD),
                None,
            ))],
            true,
        )))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .and(query_param("customer", CUSTOMER_ID))
        .and(query_param("starting_after", "sub_first"))
        .respond_with(ResponseTemplate::new(200).set_body_json(subscription_page(
            vec![stripe_response(&subscription(
                "sub_second",
                stripe::SubscriptionStatus::Trialing,
                Some("pm_other"),
                None,
            ))],
            false,
        )))
        .mount(&server)
        .await;

    let error = gateway(&server)
        .open_overage_invoice(OverageChargeRequest {
            customer_id: CUSTOMER_ID.to_string(),
            charge_id: Uuid::from_u128(2),
            amount_cents: 2_500,
            description: "Macro AI usage beyond plan".to_string(),
            scope: SubscriptionScope::Personal,
        })
        .await
        .expect_err("distinct subscription methods");
    assert!(matches!(error, BillingError::Payment(_)));

    let requests = server.received_requests().await.expect("recorded requests");
    assert!(
        requests.iter().any(|request| request
            .url
            .query_pairs()
            .any(|(key, value)| { key == "starting_after" && value == "sub_first" })),
        "{requests:?}"
    );
    assert!(
        requests
            .iter()
            .all(|request| request.method.as_str() != "POST"),
        "{requests:?}"
    );
}

#[tokio::test]
async fn pay_overage_invoice_skips_the_update_when_the_open_invoice_already_matches() {
    let invoice = stripe_response(&open_invoice(
        Some(CURRENT_PAYMENT_METHOD),
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let paid = stripe_response(&paid_invoice(CURRENT_PAYMENT_METHOD, None));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(
            vec![stripe_response(&subscription(
                "sub_active",
                stripe::SubscriptionStatus::Active,
                Some(CURRENT_PAYMENT_METHOD),
                None,
            ))],
            false,
        ),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/pay")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid))
        .mount(&server)
        .await;

    let paid_now = gateway(&server)
        .pay_overage_invoice(Uuid::from_u128(3), INVOICE_ID, SubscriptionScope::Personal)
        .await
        .expect("pay overage invoice");
    assert!(paid_now);

    let requests = server.received_requests().await.expect("recorded requests");
    assert!(requests.iter().all(|request| {
        !(request.method.as_str() == "POST"
            && request.url.path() == format!("/v1/invoices/{INVOICE_ID}"))
    }));
    assert_eq!(
        form_value(
            post_body(&requests, &format!("/v1/invoices/{INVOICE_ID}/pay")),
            "payment_method"
        ),
        Some(CURRENT_PAYMENT_METHOD)
    );
}

#[tokio::test]
async fn open_overage_invoice_selects_the_subscription_for_the_requested_scope() {
    let invoice = stripe_response(&draft_invoice());
    let invoice_item = stripe_response(&draft_invoice_item());
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, both_subscriptions()).await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoiceitems"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice_item))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/finalize")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    let gateway = gateway(&server);
    gateway
        .open_overage_invoice(charge(SubscriptionScope::Personal, 4))
        .await
        .expect("personal overage invoice");
    gateway
        .open_overage_invoice(charge(SubscriptionScope::Team { team_id: TEAM_ID }, 5))
        .await
        .expect("team overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");
    let creates: Vec<_> = requests
        .iter()
        .filter(|request| request.method.as_str() == "POST" && request.url.path() == "/v1/invoices")
        .collect();
    assert_eq!(creates.len(), 2);
    for create in creates {
        let body = body_str(create);
        assert_eq!(form_value(body, "default_payment_method"), None, "{body}");
        assert_eq!(form_value(body, "subscription"), None, "{body}");
        assert_eq!(
            form_value(body, &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")),
            None,
            "{body}"
        );
    }

    let updates: Vec<_> = requests
        .iter()
        .filter(|request| {
            request.method.as_str() == "POST"
                && request.url.path() == format!("/v1/invoices/{INVOICE_ID}")
        })
        .collect();
    assert_eq!(updates.len(), 2);
    let personal = body_str(updates[0]);
    let team = body_str(updates[1]);
    assert_eq!(
        form_value(personal, "default_payment_method"),
        Some(PERSONAL_PAYMENT_METHOD),
        "{personal}"
    );
    assert_eq!(
        form_value(personal, &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")),
        Some(PERSONAL_SCOPE_STAMP),
        "{personal}"
    );
    assert_eq!(
        form_value(team, "default_payment_method"),
        Some(TEAM_PAYMENT_METHOD),
        "{team}"
    );
    assert_eq!(
        form_value(team, &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")),
        Some("00000000-0000-0000-0000-000000000007"),
        "{team}"
    );
}

#[tokio::test]
async fn open_overage_invoice_replay_uses_the_retrieved_scope_and_stored_method() {
    let cached_invoice = stripe_response(&draft_invoice());
    let mut current_invoice = draft_invoice();
    current_invoice.default_payment_method = Some(stripe::Expandable::Id(
        PERSONAL_PAYMENT_METHOD
            .parse()
            .expect("personal payment method"),
    ));
    current_invoice.metadata = Some(HashMap::from([(
        BILLING_SCOPE_METADATA_KEY.to_string(),
        PERSONAL_SCOPE_STAMP.to_string(),
    )]));
    let current_invoice = stripe_response(&current_invoice);
    let invoice_item = stripe_response(&draft_invoice_item());
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, subscription_page(Vec::new(), false)).await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&cached_invoice))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&current_invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&current_invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoiceitems"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice_item))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/finalize")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&current_invoice))
        .mount(&server)
        .await;

    gateway(&server)
        .open_overage_invoice(charge(SubscriptionScope::Team { team_id: TEAM_ID }, 7))
        .await
        .expect("replay overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");
    let update_at = request_position(&requests, "POST", &format!("/v1/invoices/{INVOICE_ID}"));
    let item_at = request_position(&requests, "POST", "/v1/invoiceitems");
    let finalize_at = request_position(
        &requests,
        "POST",
        &format!("/v1/invoices/{INVOICE_ID}/finalize"),
    );
    assert!(update_at < item_at, "{requests:?}");
    assert!(item_at < finalize_at, "{requests:?}");
    let update = post_request(&requests, &format!("/v1/invoices/{INVOICE_ID}"));
    assert_eq!(
        form_value(body_str(update), "default_payment_method"),
        Some(PERSONAL_PAYMENT_METHOD)
    );
    assert_eq!(
        form_value(
            body_str(update),
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        Some(PERSONAL_SCOPE_STAMP)
    );
    assert_eq!(idempotency_key(update), None);
}

#[tokio::test]
async fn open_overage_invoice_replay_returns_an_already_paid_invoice() {
    let cached_invoice = stripe_response(&draft_invoice());
    let paid_invoice = stripe_response(&paid_invoice(
        CURRENT_PAYMENT_METHOD,
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(
            vec![stripe_response(&subscription(
                "sub_active",
                stripe::SubscriptionStatus::Active,
                Some(CURRENT_PAYMENT_METHOD),
                None,
            ))],
            false,
        ),
    )
    .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&cached_invoice))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid_invoice))
        .mount(&server)
        .await;

    let invoice_id = gateway(&server)
        .open_overage_invoice(charge(SubscriptionScope::Personal, 12))
        .await
        .expect("already paid invoice");
    assert_eq!(invoice_id, INVOICE_ID);

    let requests = server.received_requests().await.expect("recorded requests");
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.method.as_str() == "POST")
            .map(|request| request.url.path())
            .collect::<Vec<_>>(),
        vec!["/v1/invoices"],
        "{requests:?}"
    );
    assert!(requests.iter().any(|request| {
        request.method.as_str() == "GET"
            && request.url.path() == format!("/v1/invoices/{INVOICE_ID}")
    }));
}

#[tokio::test]
async fn open_overage_invoice_leaves_a_safe_draft_when_scope_has_no_match() {
    let invoice = stripe_response(&draft_invoice());
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, team_subscription()).await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    let error = gateway(&server)
        .open_overage_invoice(charge(SubscriptionScope::Personal, 9))
        .await
        .expect_err("missing personal subscription");
    assert!(matches!(error, BillingError::Payment(_)));

    let requests = server.received_requests().await.expect("recorded requests");
    let create = post_request(&requests, "/v1/invoices");
    let body = body_str(create);
    assert_eq!(form_value(body, "default_payment_method"), None, "{body}");
    assert_eq!(form_value(body, "subscription"), None, "{body}");
    assert_eq!(form_value(body, "auto_advance"), Some("false"), "{body}");
    assert_eq!(
        form_value(body, &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")),
        None,
        "{body}"
    );
    assert_eq!(
        idempotency_key(create),
        Some("ai_overage:00000000-0000-0000-0000-000000000009:invoice")
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| request.method.as_str() == "POST")
            .count(),
        1,
        "{requests:?}"
    );
    assert_eq!(
        requests
            .iter()
            .filter(|request| {
                request.method.as_str() == "GET"
                    && request.url.path() == format!("/v1/invoices/{INVOICE_ID}")
            })
            .count(),
        1,
        "{requests:?}"
    );
    let create_at = request_position(&requests, "POST", "/v1/invoices");
    let retrieve_at = request_position(&requests, "GET", &format!("/v1/invoices/{INVOICE_ID}"));
    assert!(create_at < retrieve_at, "{requests:?}");
}

#[tokio::test]
async fn pay_overage_invoice_keeps_a_stamped_scope_when_the_live_scope_differs() {
    let invoice = stripe_response(&open_invoice(
        Some(STALE_PAYMENT_METHOD),
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let paid = stripe_response(&paid_invoice(
        PERSONAL_PAYMENT_METHOD,
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, both_subscriptions()).await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/pay")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid))
        .mount(&server)
        .await;

    let paid_now = gateway(&server)
        .pay_overage_invoice(
            Uuid::from_u128(6),
            INVOICE_ID,
            SubscriptionScope::Team { team_id: TEAM_ID },
        )
        .await
        .expect("pay stamped invoice");
    assert!(paid_now);

    let requests = server.received_requests().await.expect("recorded requests");
    let update = post_request(&requests, &format!("/v1/invoices/{INVOICE_ID}"));
    assert_eq!(
        form_value(body_str(update), "default_payment_method"),
        Some(PERSONAL_PAYMENT_METHOD)
    );
    assert_eq!(
        form_value(
            body_str(update),
            &format!("metadata[{BILLING_SCOPE_METADATA_KEY}]")
        ),
        Some(PERSONAL_SCOPE_STAMP)
    );
    assert_eq!(
        form_value(
            post_body(&requests, &format!("/v1/invoices/{INVOICE_ID}/pay")),
            "payment_method"
        ),
        Some(PERSONAL_PAYMENT_METHOD)
    );
}

#[tokio::test]
async fn pay_overage_invoice_preserves_a_stamped_personal_method_after_team_conversion() {
    let invoice = stripe_response(&open_invoice(
        Some(PERSONAL_PAYMENT_METHOD),
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let paid = stripe_response(&paid_invoice(
        PERSONAL_PAYMENT_METHOD,
        Some(PERSONAL_SCOPE_STAMP),
    ));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, team_subscription()).await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/pay")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid))
        .mount(&server)
        .await;

    let paid_now = gateway(&server)
        .pay_overage_invoice(
            Uuid::from_u128(10),
            INVOICE_ID,
            SubscriptionScope::Team { team_id: TEAM_ID },
        )
        .await
        .expect("pay converted personal invoice");
    assert!(paid_now);

    let requests = server.received_requests().await.expect("recorded requests");
    assert!(requests.iter().all(|request| {
        !(request.method.as_str() == "POST"
            && request.url.path() == format!("/v1/invoices/{INVOICE_ID}"))
    }));
    let pay_body = post_body(&requests, &format!("/v1/invoices/{INVOICE_ID}/pay"));
    assert_eq!(
        form_value(pay_body, "payment_method"),
        Some(PERSONAL_PAYMENT_METHOD)
    );
    assert!(!pay_body.contains(STALE_PAYMENT_METHOD), "{pay_body}");
}

#[tokio::test]
async fn pay_overage_invoice_rejects_no_match_without_a_stored_method() {
    let invoice = stripe_response(&open_invoice(None, None));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(&server, team_subscription()).await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    let error = gateway(&server)
        .pay_overage_invoice(Uuid::from_u128(11), INVOICE_ID, SubscriptionScope::Personal)
        .await
        .expect_err("missing personal subscription and stored method");
    assert!(matches!(error, BillingError::Payment(_)));

    let requests = server.received_requests().await.expect("recorded requests");
    assert!(
        requests
            .iter()
            .all(|request| request.method.as_str() != "POST"),
        "{requests:?}"
    );
}

#[tokio::test]
async fn pay_overage_invoice_returns_when_the_invoice_is_already_paid() {
    let paid = stripe_response(&paid_invoice(STALE_PAYMENT_METHOD, None));
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&paid))
        .mount(&server)
        .await;

    let paid_now = gateway(&server)
        .pay_overage_invoice(Uuid::from_u128(8), INVOICE_ID, SubscriptionScope::Personal)
        .await
        .expect("already paid invoice");
    assert!(paid_now);

    let requests = server.received_requests().await.expect("recorded requests");
    assert!(requests.iter().all(|request| {
        request.url.path() != format!("/v1/customers/{CUSTOMER_ID}")
            && request.url.path() != "/v1/subscriptions"
            && request.method.as_str() != "POST"
    }));
}

#[tokio::test]
async fn subscription_period_selects_the_billable_subscription_in_scope() {
    let personal = BillingPeriod {
        start: Utc.with_ymd_and_hms(2026, 4, 10, 0, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap(),
    };
    let team = BillingPeriod {
        start: Utc.with_ymd_and_hms(2026, 3, 18, 8, 0, 0).unwrap(),
        end: Utc.with_ymd_and_hms(2026, 4, 18, 8, 0, 0).unwrap(),
    };
    let team_id = TEAM_ID.to_string();
    let server = MockServer::start().await;
    mount_subscriptions(
        &server,
        subscription_page(
            vec![
                subscription_in_period(
                    "sub_past_due",
                    stripe::SubscriptionStatus::PastDue,
                    None,
                    BillingPeriod {
                        start: Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap(),
                        end: Utc.with_ymd_and_hms(2026, 2, 15, 0, 0, 0).unwrap(),
                    },
                ),
                subscription_in_period(
                    "sub_personal",
                    stripe::SubscriptionStatus::Active,
                    None,
                    personal,
                ),
                subscription_in_period(
                    "sub_team",
                    stripe::SubscriptionStatus::Active,
                    Some(&team_id),
                    team,
                ),
            ],
            false,
        ),
    )
    .await;
    let gateway = gateway(&server);

    assert_eq!(
        gateway
            .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
            .await
            .unwrap(),
        Some(personal)
    );
    assert_eq!(
        gateway
            .subscription_period(CUSTOMER_ID, SubscriptionScope::Team { team_id: TEAM_ID })
            .await
            .unwrap(),
        Some(team)
    );
    assert_eq!(
        gateway
            .subscription_period(
                CUSTOMER_ID,
                SubscriptionScope::Team {
                    team_id: Uuid::from_u128(8)
                }
            )
            .await
            .unwrap(),
        None
    );
    let requests = server.received_requests().await.expect("recorded requests");
    assert!(
        requests
            .iter()
            .all(|request| request.url.path() == "/v1/subscriptions"),
        "{requests:?}"
    );
}

#[tokio::test]
async fn subscription_period_rejects_disagreeing_subscriptions() {
    let server = MockServer::start().await;
    mount_subscriptions(
        &server,
        subscription_page(
            vec![
                subscription_in_period(
                    "sub_monthly",
                    stripe::SubscriptionStatus::Active,
                    None,
                    BillingPeriod {
                        start: Utc.with_ymd_and_hms(2026, 4, 10, 0, 0, 0).unwrap(),
                        end: Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap(),
                    },
                ),
                subscription_in_period(
                    "sub_other",
                    stripe::SubscriptionStatus::Active,
                    None,
                    BillingPeriod {
                        start: Utc.with_ymd_and_hms(2026, 4, 1, 0, 0, 0).unwrap(),
                        end: Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap(),
                    },
                ),
            ],
            false,
        ),
    )
    .await;

    let error = gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
        .expect_err("two personal subscriptions on different periods");
    assert!(matches!(error, BillingError::Payment(_)), "{error:?}");
}

#[tokio::test]
async fn subscription_period_reports_provider_errors() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "error": { "type": "api_error", "message": "stripe is down" }
        })))
        .mount(&server)
        .await;

    let error = gateway(&server)
        .subscription_period(CUSTOMER_ID, SubscriptionScope::Personal)
        .await
        .expect_err("stripe answered 500");
    assert!(matches!(error, BillingError::Payment(_)), "{error:?}");
}

fn customer_with_stale_fallback() -> stripe::Customer {
    let stale: stripe::PaymentMethodId =
        STALE_PAYMENT_METHOD.parse().expect("stale payment method");
    stripe::Customer {
        id: CUSTOMER_ID.parse().expect("customer id"),
        invoice_settings: Some(stripe::InvoiceSettingCustomerSetting {
            default_payment_method: Some(stripe::Expandable::Id(stale)),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn subscription(
    id: &str,
    status: stripe::SubscriptionStatus,
    default_payment_method: Option<&str>,
    team_id: Option<&str>,
) -> stripe::Subscription {
    let mut metadata = HashMap::new();
    if let Some(team_id) = team_id {
        metadata.insert(TEAM_ID_METADATA_KEY.to_string(), team_id.to_string());
    }
    stripe::Subscription {
        id: id.parse().expect("subscription id"),
        customer: stripe::Expandable::Id(CUSTOMER_ID.parse().expect("customer id")),
        default_payment_method: default_payment_method
            .map(|method| stripe::Expandable::Id(method.parse().expect("payment method"))),
        status,
        currency: stripe::Currency::USD,
        metadata,
        items: stripe::List {
            data: vec![stripe::SubscriptionItem {
                id: format!("si_{id}").parse().expect("subscription item id"),
                ..Default::default()
            }],
            has_more: false,
            total_count: Some(1),
            url: "/v1/subscription_items".into(),
        },
        ..Default::default()
    }
}

fn subscription_in_period(
    id: &str,
    status: stripe::SubscriptionStatus,
    team_id: Option<&str>,
    period: BillingPeriod,
) -> Value {
    stripe_response(&stripe::Subscription {
        current_period_start: period.start.timestamp(),
        current_period_end: period.end.timestamp(),
        ..subscription(id, status, None, team_id)
    })
}

fn open_invoice(default_payment_method: Option<&str>, scope: Option<&str>) -> stripe::Invoice {
    let method = default_payment_method
        .map(|method| stripe::Expandable::Id(method.parse().expect("invoice payment method")));
    let metadata = scope.map(|scope| {
        let mut metadata = HashMap::new();
        metadata.insert(BILLING_SCOPE_METADATA_KEY.to_string(), scope.to_string());
        metadata
    });
    stripe::Invoice {
        id: INVOICE_ID.parse().expect("invoice id"),
        customer: Some(stripe::Expandable::Id(
            CUSTOMER_ID.parse().expect("customer id"),
        )),
        default_payment_method: method,
        status: Some(stripe::InvoiceStatus::Open),
        metadata,
        ..Default::default()
    }
}

fn paid_invoice(default_payment_method: &str, scope: Option<&str>) -> stripe::Invoice {
    let mut invoice = open_invoice(Some(default_payment_method), scope);
    invoice.status = Some(stripe::InvoiceStatus::Paid);
    invoice
}

fn draft_invoice() -> stripe::Invoice {
    stripe::Invoice {
        id: INVOICE_ID.parse().expect("invoice id"),
        ..Default::default()
    }
}

fn draft_invoice_item() -> stripe::InvoiceItem {
    stripe::InvoiceItem {
        id: "ii_overage".parse().expect("invoice item id"),
        ..Default::default()
    }
}

fn gateway(server: &MockServer) -> StripePaymentGateway {
    let api_base = server.uri();
    StripePaymentGateway::new(Arc::new(stripe::Client::from_url(
        api_base.as_str(),
        "sk_test",
    )))
}

async fn mount_customer(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("/v1/customers/{CUSTOMER_ID}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(stripe_response(&customer_with_stale_fallback())),
        )
        .mount(server)
        .await;
}

async fn mount_customer_and_subscriptions(server: &MockServer, subscriptions: Value) {
    mount_customer(server).await;
    mount_subscriptions(server, subscriptions).await;
}

async fn mount_subscriptions(server: &MockServer, subscriptions: Value) {
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .and(query_param("customer", CUSTOMER_ID))
        .respond_with(ResponseTemplate::new(200).set_body_json(subscriptions))
        .mount(server)
        .await;
}

fn subscription_page(data: Vec<Value>, has_more: bool) -> Value {
    let total_count = data.len();
    json!({
        "data": data,
        "has_more": has_more,
        "total_count": total_count,
        "url": "/v1/subscriptions",
    })
}

fn both_subscriptions() -> Value {
    let team_id = TEAM_ID.to_string();
    subscription_page(
        vec![
            stripe_response(&subscription(
                "sub_personal",
                stripe::SubscriptionStatus::Active,
                Some(PERSONAL_PAYMENT_METHOD),
                None,
            )),
            stripe_response(&subscription(
                "sub_team",
                stripe::SubscriptionStatus::Active,
                Some(TEAM_PAYMENT_METHOD),
                Some(&team_id),
            )),
        ],
        false,
    )
}

fn team_subscription() -> Value {
    let team_id = TEAM_ID.to_string();
    subscription_page(
        vec![stripe_response(&subscription(
            "sub_team",
            stripe::SubscriptionStatus::Active,
            Some(TEAM_PAYMENT_METHOD),
            Some(&team_id),
        ))],
        false,
    )
}

fn charge(scope: SubscriptionScope, charge_id: u128) -> OverageChargeRequest {
    OverageChargeRequest {
        customer_id: CUSTOMER_ID.to_string(),
        charge_id: Uuid::from_u128(charge_id),
        amount_cents: 2_500,
        description: "Macro AI usage beyond plan".to_string(),
        scope,
    }
}

fn post_request<'a>(requests: &'a [wiremock::Request], path: &str) -> &'a wiremock::Request {
    requests
        .iter()
        .find(|request| request.method.as_str() == "POST" && request.url.path() == path)
        .unwrap_or_else(|| panic!("POST {path}"))
}

fn post_body<'a>(requests: &'a [wiremock::Request], path: &str) -> &'a str {
    body_str(post_request(requests, path))
}

fn request_position(requests: &[wiremock::Request], method: &str, path: &str) -> usize {
    requests
        .iter()
        .position(|request| request.method.as_str() == method && request.url.path() == path)
        .unwrap_or_else(|| panic!("{method} {path}"))
}

fn idempotency_key(request: &wiremock::Request) -> Option<&str> {
    request
        .headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
}

fn body_str(request: &wiremock::Request) -> &str {
    std::str::from_utf8(&request.body).expect("utf-8 body")
}

fn form_value<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    body.split('&').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then_some(value)
    })
}

/// async-stripe omits `None` when serializing and then rejects that omission when reading a response.
fn stripe_response<T>(value: &T) -> Value
where
    T: Serialize + DeserializeOwned,
{
    let mut json = serde_json::to_value(value).expect("serialize stripe fixture");
    for _ in 0..256 {
        match serde_json::from_value::<T>(json.clone()) {
            Ok(_) => return json,
            Err(error) => {
                let message = error.to_string();
                let Some(field) = missing_field_name(&message) else {
                    panic!("stripe fixture does not deserialize: {message}\n{json}");
                };
                fill_missing_field(&mut json, field);
            }
        }
    }
    panic!("stripe fixture still missing fields:\n{json}");
}

fn missing_field_name(message: &str) -> Option<&str> {
    let rest = message.strip_prefix("missing field `")?;
    rest.split_once('`').map(|(name, _)| name)
}

fn fill_missing_field(value: &mut Value, field: &str) {
    match value {
        Value::Object(map) => {
            if !map.contains_key(field) {
                map.insert(field.to_string(), Value::Null);
            }
            for child in map.values_mut() {
                fill_missing_field(child, field);
            }
        }
        Value::Array(items) => {
            for item in items {
                fill_missing_field(item, field);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}
