use super::*;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const CUSTOMER_ID: &str = "cus_test";
const STALE_PAYMENT_METHOD: &str = "pm_stale";
const CURRENT_PAYMENT_METHOD: &str = "pm_current";
const INVOICE_ID: &str = "in_overage";

#[tokio::test]
async fn open_overage_invoice_posts_the_active_subscription_default_payment_method() {
    let invoice = stripe_response(&draft_invoice());
    let invoice_item = stripe_response(&draft_invoice_item());
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(vec![stripe_response(&subscription(
            "sub_active",
            stripe::SubscriptionStatus::Active,
            Some(CURRENT_PAYMENT_METHOD),
        ))]),
    )
    .await;
    Mock::given(method("POST"))
        .and(path("/v1/invoices"))
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
        })
        .await
        .expect("open overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");

    let body = post_body(&requests, "/v1/invoices");
    assert_eq!(
        form_value(body, "default_payment_method"),
        Some(CURRENT_PAYMENT_METHOD),
        "{body}"
    );
    assert_eq!(form_value(body, "subscription"), None, "{body}");
}

#[tokio::test]
async fn pay_overage_invoice_updates_a_stale_open_invoice_before_paying() {
    let invoice = stripe_response(&open_invoice(STALE_PAYMENT_METHOD));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(vec![stripe_response(&subscription(
            "sub_active",
            stripe::SubscriptionStatus::Active,
            Some(CURRENT_PAYMENT_METHOD),
        ))]),
    )
    .await;
    for pay_path in [
        format!("/v1/invoices/{INVOICE_ID}"),
        format!("/v1/invoices/{INVOICE_ID}/pay"),
    ] {
        Mock::given(method("POST"))
            .and(path(pay_path))
            .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
            .mount(&server)
            .await;
    }
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    gateway(&server)
        .pay_overage_invoice(Uuid::from_u128(1), INVOICE_ID)
        .await
        .expect("pay overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");
    let update_at = requests.iter().position(|request| {
        request.method.as_str() == "POST"
            && request.url.path() == format!("/v1/invoices/{INVOICE_ID}")
    });
    let pay_at = requests.iter().position(|request| {
        request.method.as_str() == "POST"
            && request.url.path() == format!("/v1/invoices/{INVOICE_ID}/pay")
    });
    let (Some(update_at), Some(pay_at)) = (update_at, pay_at) else {
        panic!("missing update or pay: {requests:?}");
    };
    assert!(update_at < pay_at);
    let update = &requests[update_at];
    let pay = &requests[pay_at];
    assert!(update.headers.get("idempotency-key").is_none());
    assert_eq!(
        form_value(body_str(update), "default_payment_method"),
        Some(CURRENT_PAYMENT_METHOD)
    );
    assert!(
        pay.headers
            .get("idempotency-key")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|key| key.starts_with("ai_overage:"))
    );
    assert_eq!(
        form_value(body_str(pay), "payment_method"),
        Some(CURRENT_PAYMENT_METHOD)
    );
}

#[tokio::test]
async fn open_overage_invoice_rejects_distinct_subscription_methods_without_posting() {
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(vec![
            stripe_response(&subscription(
                "sub_active",
                stripe::SubscriptionStatus::Active,
                Some(CURRENT_PAYMENT_METHOD),
            )),
            stripe_response(&subscription(
                "sub_trial",
                stripe::SubscriptionStatus::Trialing,
                Some("pm_other"),
            )),
        ]),
    )
    .await;

    let error = gateway(&server)
        .open_overage_invoice(OverageChargeRequest {
            customer_id: CUSTOMER_ID.to_string(),
            charge_id: Uuid::from_u128(2),
            amount_cents: 2_500,
            description: "Macro AI usage beyond plan".to_string(),
        })
        .await
        .expect_err("distinct subscription methods");
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
async fn pay_overage_invoice_skips_the_update_when_the_open_invoice_already_matches() {
    let invoice = stripe_response(&open_invoice(CURRENT_PAYMENT_METHOD));
    let server = MockServer::start().await;
    mount_customer_and_subscriptions(
        &server,
        subscription_page(vec![stripe_response(&subscription(
            "sub_active",
            stripe::SubscriptionStatus::Active,
            Some(CURRENT_PAYMENT_METHOD),
        ))]),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(format!("/v1/invoices/{INVOICE_ID}/pay")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&invoice))
        .mount(&server)
        .await;

    gateway(&server)
        .pay_overage_invoice(Uuid::from_u128(3), INVOICE_ID)
        .await
        .expect("pay overage invoice");

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
) -> stripe::Subscription {
    stripe::Subscription {
        id: id.parse().expect("subscription id"),
        customer: stripe::Expandable::Id(CUSTOMER_ID.parse().expect("customer id")),
        default_payment_method: default_payment_method
            .map(|method| stripe::Expandable::Id(method.parse().expect("payment method"))),
        status,
        currency: stripe::Currency::USD,
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

fn open_invoice(default_payment_method: &str) -> stripe::Invoice {
    let method: stripe::PaymentMethodId = default_payment_method
        .parse()
        .expect("invoice payment method");
    stripe::Invoice {
        id: INVOICE_ID.parse().expect("invoice id"),
        customer: Some(stripe::Expandable::Id(
            CUSTOMER_ID.parse().expect("customer id"),
        )),
        default_payment_method: Some(stripe::Expandable::Id(method)),
        status: Some(stripe::InvoiceStatus::Open),
        ..Default::default()
    }
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

async fn mount_customer_and_subscriptions(server: &MockServer, subscriptions: Value) {
    Mock::given(method("GET"))
        .and(path(format!("/v1/customers/{CUSTOMER_ID}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(stripe_response(&customer_with_stale_fallback())),
        )
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(subscriptions))
        .mount(server)
        .await;
}

fn subscription_page(data: Vec<Value>) -> Value {
    let total_count = data.len();
    json!({
        "data": data,
        "has_more": false,
        "total_count": total_count,
        "url": "/v1/subscriptions",
    })
}

fn post_body<'a>(requests: &'a [wiremock::Request], path: &str) -> &'a str {
    body_str(
        requests
            .iter()
            .find(|request| request.method.as_str() == "POST" && request.url.path() == path)
            .unwrap_or_else(|| panic!("POST {path}")),
    )
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
