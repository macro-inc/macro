use super::*;
use crate::domain::model::{CardBrand, PaymentCard};

fn card(id: &str, brand: &str, last4: &str) -> stripe::PaymentMethod {
    stripe::PaymentMethod {
        id: id.parse().unwrap(),
        type_: stripe::PaymentMethodType::Card,
        card: Some(stripe::CardDetails {
            brand: brand.into(),
            last4: last4.into(),
            ..Default::default()
        }),
        ..Default::default()
    }
}

fn line(price: &str, amount: i64, proration: bool) -> stripe::InvoiceLineItem {
    stripe::InvoiceLineItem {
        id: format!("il_{price}_{proration}").parse().unwrap(),
        amount,
        currency: stripe::Currency::USD,
        price: Some(stripe::Price {
            id: price.parse().unwrap(),
            ..Default::default()
        }),
        proration,
        ..Default::default()
    }
}

fn lines(data: Vec<stripe::InvoiceLineItem>) -> stripe::List<stripe::InvoiceLineItem> {
    stripe::List {
        data,
        has_more: false,
        total_count: None,
        url: "/v1/invoices/upcoming/lines".into(),
    }
}

fn query(request: &wiremock::Request) -> HashMap<String, String> {
    request.url.query_pairs().into_owned().collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn payment_terms_read_the_terms_and_the_subscriptions_card_at_once(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data[0].price.as_mut().unwrap().recurring = Some(stripe::Recurring {
        interval: stripe::RecurringInterval::Month,
        interval_count: 1,
        usage_type: stripe::RecurringUsageType::Licensed,
        ..Default::default()
    });
    sub.default_payment_method = Some(stripe::Expandable::Object(Box::new(card(
        "pm_visa", "visa", "4242",
    ))));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;

    assert_eq!(
        repo(&server, pool).payment_terms(&sub.id).await.unwrap(),
        PaymentTerms {
            terms: SubscriptionTerms {
                current_period_end: chrono::DateTime::from_timestamp(1_802_678_400, 0).unwrap(),
                interval: BillingCadence::Month,
                currency: "usd".into(),
                trialing: false,
            },
            card: Some(PaymentCard {
                brand: CardBrand::Visa,
                last4: "4242".into(),
            }),
            credit: 0,
        }
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let expand: Vec<String> = requests[0]
        .url
        .query_pairs()
        .filter(|(key, _)| key.starts_with("expand"))
        .map(|(_, value)| value.into_owned())
        .collect();
    assert_eq!(
        expand,
        [
            "default_payment_method",
            "customer.invoice_settings.default_payment_method"
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn payment_terms_fall_back_to_the_customers_card_and_name_no_other_method(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data[0].price.as_mut().unwrap().recurring = Some(stripe::Recurring {
        interval: stripe::RecurringInterval::Month,
        interval_count: 1,
        usage_type: stripe::RecurringUsageType::Licensed,
        ..Default::default()
    });
    sub.customer = stripe::Expandable::Object(Box::new(stripe::Customer {
        id: "cus_test".parse().unwrap(),
        // Credit is a negative balance.
        balance: Some(-500),
        invoice_settings: Some(stripe::InvoiceSettingCustomerSetting {
            default_payment_method: Some(stripe::Expandable::Object(Box::new(card(
                "pm_amex", "amex", "0005",
            )))),
            ..Default::default()
        }),
        ..Default::default()
    }));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    let repo = repo(&server, pool);

    let terms = repo.payment_terms(&sub.id).await.unwrap();
    assert_eq!(
        terms.card,
        Some(PaymentCard {
            brand: CardBrand::Amex,
            last4: "0005".into(),
        })
    );
    assert_eq!(terms.credit, 500);

    // The subscription's own method wins even when it is not a card.
    sub.default_payment_method = Some(stripe::Expandable::Object(Box::new(
        stripe::PaymentMethod {
            id: "pm_bank".parse().unwrap(),
            type_: stripe::PaymentMethodType::UsBankAccount,
            ..Default::default()
        },
    )));
    server.reset().await;
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    assert_eq!(repo.payment_terms(&sub.id).await.unwrap().card, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_preview_prorates_every_price_with_its_discounts_and_tax(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut standard = line("price_standard", 2000, true);
    // async-stripe exports two types of each name; let the fields pick theirs.
    standard.discount_amounts =
        serde_json::from_value(json!([{ "amount": 200, "discount": "di_test" }])).unwrap();
    standard.tax_amounts = serde_json::from_value(json!([
        { "amount": 180, "inclusive": false, "tax_rate": "txr_test", "taxable_amount": 1800 },
        { "amount": 99, "inclusive": true, "tax_rate": "txr_test", "taxable_amount": 1800 },
    ]))
    .unwrap();
    mount(
        &server,
        "GET",
        "/v1/invoices/upcoming/lines",
        &lines(vec![
            standard,
            // The next period's full price is not charged today.
            line("price_standard", 4000, false),
            line("price_large", 4266, true),
        ]),
        1,
    )
    .await;
    let prices = [
        stripe::PriceId::from_str("price_standard").unwrap(),
        stripe::PriceId::from_str("price_large").unwrap(),
    ];

    assert_eq!(
        repo(&server, pool)
            .preview_prorations(&"sub_team".parse().unwrap(), &prices)
            .await
            .unwrap(),
        [
            ProratedCharge {
                price_id: prices[0].clone(),
                amount: 2000 - 200 + 180,
            },
            ProratedCharge {
                price_id: prices[1].clone(),
                amount: 4266,
            },
        ]
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests.len(), 1);
    let sent = query(&requests[0]);
    assert_eq!(sent["subscription"], "sub_team");
    assert_eq!(sent["subscription_proration_behavior"], "always_invoice");
    assert_eq!(sent["subscription_items[0][price]"], "price_standard");
    assert_eq!(sent["subscription_items[0][quantity]"], "1");
    assert_eq!(sent["subscription_items[1][price]"], "price_large");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_price_the_preview_does_not_prorate_is_an_error_not_free(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    mount(
        &server,
        "GET",
        "/v1/invoices/upcoming/lines",
        &lines(vec![line("price_standard", 4000, false)]),
        1,
    )
    .await;

    assert!(
        repo(&server, pool)
            .preview_prorations(
                &"sub_team".parse().unwrap(),
                &[stripe::PriceId::from_str("price_standard").unwrap()],
            )
            .await
            .is_err()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_prices_preview_nothing(pool: sqlx::PgPool) {
    let server = MockServer::start().await;

    assert_eq!(
        repo(&server, pool)
            .preview_prorations(&"sub_team".parse().unwrap(), &[])
            .await
            .unwrap(),
        []
    );
    assert!(server.received_requests().await.unwrap().is_empty());
}
