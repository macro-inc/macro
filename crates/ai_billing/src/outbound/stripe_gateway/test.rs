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
    let customer = stripe_response(&customer_with_stale_fallback());
    let subscriptions = json!({
        "data": [stripe_response(&active_subscription())],
        "has_more": false,
        "total_count": 1,
        "url": "/v1/subscriptions",
    });
    serde_json::from_value::<stripe::List<stripe::Subscription>>(subscriptions.clone())
        .expect("active subscription list");
    let invoice = stripe_response(&draft_invoice());
    let invoice_item = stripe_response(&draft_invoice_item());

    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/v1/customers/{CUSTOMER_ID}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(&customer))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&subscriptions))
        .mount(&server)
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

    let api_base = server.uri();
    let gateway = StripePaymentGateway::new(Arc::new(stripe::Client::from_url(
        api_base.as_str(),
        "sk_test",
    )));
    gateway
        .open_overage_invoice(OverageChargeRequest {
            customer_id: CUSTOMER_ID.to_string(),
            charge_id: Uuid::from_u128(1),
            amount_cents: 2_500,
            description: "Macro AI usage beyond plan".to_string(),
        })
        .await
        .expect("open overage invoice");

    let requests = server.received_requests().await.expect("recorded requests");

    let invoice_create = requests
        .iter()
        .find(|request| request.method.as_str() == "POST" && request.url.path() == "/v1/invoices")
        .expect("POST /v1/invoices");
    let body = std::str::from_utf8(&invoice_create.body).expect("utf-8 invoice body");
    let default_payment_method = body.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "default_payment_method").then_some(value)
    });
    assert_eq!(
        default_payment_method,
        Some(CURRENT_PAYMENT_METHOD),
        "{body}"
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

fn active_subscription() -> stripe::Subscription {
    let current: stripe::PaymentMethodId = CURRENT_PAYMENT_METHOD
        .parse()
        .expect("current payment method");
    stripe::Subscription {
        id: "sub_active".parse().expect("subscription id"),
        customer: stripe::Expandable::Id(CUSTOMER_ID.parse().expect("customer id")),
        default_payment_method: Some(stripe::Expandable::Id(current)),
        status: stripe::SubscriptionStatus::Active,
        currency: stripe::Currency::USD,
        items: stripe::List {
            data: vec![stripe::SubscriptionItem {
                id: "si_seat".parse().expect("subscription item id"),
                ..Default::default()
            }],
            has_more: false,
            total_count: Some(1),
            url: "/v1/subscription_items".into(),
        },
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
