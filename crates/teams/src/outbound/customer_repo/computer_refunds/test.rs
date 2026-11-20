use super::*;
use crate::outbound::customer_repo::test::{form, repo};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Value, json};
use std::str::FromStr;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const COMPUTER_UUID: &str = "0193a1b2-0000-7000-8000-0000000000c1";

fn computer() -> computer_id::ComputerId {
    COMPUTER_UUID.parse().unwrap()
}
const KEY: &str = "computer-refund:0193a1b2-0000-7000-8000-0000000000c1";

fn line(id: &str, computer_id: Option<&str>, amount: i64, proration: bool) -> Value {
    json!({
        "id": id,
        "object": "line_item",
        "amount": amount,
        "currency": "usd",
        "discountable": true,
        "livemode": false,
        "metadata": {},
        "proration": proration,
        "quantity": 1,
        "type": "subscription",
        "price": {
            "id": format!("price_{id}"),
            "object": "price",
            "metadata": computer_id
                .map(|computer_id| json!({ "computer_id": computer_id }))
                .unwrap_or_else(|| json!({})),
        },
    })
}

fn invoice(id: &str, amount_paid: i64, lines: Vec<Value>) -> Value {
    json!({
        "id": id,
        "object": "invoice",
        "amount_paid": amount_paid,
        "post_payment_credit_notes_amount": 0,
        "lines": { "object": "list", "data": lines, "has_more": false, "url": format!("/v1/invoices/{id}/lines") },
    })
}

fn credit_note(id: &str, total: i64, refund: Option<&str>, key: Option<&str>) -> Value {
    json!({
        "id": id,
        "object": "credit_note",
        "amount": total,
        "amount_shipping": 0,
        "created": 1_700_000_000,
        "currency": "usd",
        "customer": "cus_team",
        "discount_amount": 0,
        "discount_amounts": [],
        "invoice": "in_purchase",
        "lines": { "object": "list", "data": [], "has_more": false, "url": "/v1/credit_notes/lines" },
        "livemode": false,
        "number": "CN-1",
        "pdf": "https://example.invalid/cn.pdf",
        "status": "issued",
        "subtotal": total,
        "tax_amounts": [],
        "total": total,
        "type": "post_payment",
        "refund": refund,
        "metadata": key.map(|key| json!({ "computer_refund": key })).unwrap_or_else(|| json!({})),
    })
}

fn list(data: Vec<Value>, url: &str) -> Value {
    json!({ "object": "list", "data": data, "has_more": false, "url": url })
}

async fn respond(server: &MockServer, verb: &str, route: &str, body: Value) {
    Mock::given(method(verb))
        .and(path(route))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

fn subscription() -> stripe::SubscriptionId {
    stripe::SubscriptionId::from_str("sub_team").unwrap()
}

fn created_credit_notes(requests: &[wiremock::Request]) -> Vec<&wiremock::Request> {
    requests
        .iter()
        .filter(|request| {
            request.method.as_str() == "POST" && request.url.path() == "/v1/credit_notes"
        })
        .collect()
}

/// The newest paid invoice carrying the computer's own price is its
/// purchase; only that line is credited, and the card refund covers it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_card_paid_purchase_is_refunded_by_a_credit_note_on_its_line(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let invoices = vec![
        invoice("in_other", 900, vec![line("il_seat", None, 900, true)]),
        invoice(
            "in_purchase",
            2000,
            vec![
                line("il_computer", Some(COMPUTER_UUID), 2000, true),
                line("il_seat2", None, 0, true),
            ],
        ),
    ];
    respond(
        &server,
        "GET",
        "/v1/invoices",
        list(invoices, "/v1/invoices"),
    )
    .await;
    respond(
        &server,
        "GET",
        "/v1/credit_notes",
        list(vec![], "/v1/credit_notes"),
    )
    .await;
    respond(
        &server,
        "GET",
        "/v1/credit_notes/preview",
        credit_note("cn_preview", 2000, None, None),
    )
    .await;
    respond(
        &server,
        "POST",
        "/v1/credit_notes",
        credit_note("cn_1", 2000, Some("re_1"), Some(KEY)),
    )
    .await;

    let credit = repo(&server, pool)
        .refund_computer_purchase(&subscription(), computer(), KEY)
        .await
        .unwrap();

    assert_eq!(
        credit,
        Some(ComputerPurchaseCredit {
            credit_note: "cn_1".parse().unwrap(),
            refund: Some("re_1".parse().unwrap()),
        })
    );
    let requests = server.received_requests().await.unwrap();
    let created = created_credit_notes(&requests);
    assert_eq!(created.len(), 1);
    let sent = form(created[0]);
    assert_eq!(sent["invoice"], "in_purchase");
    assert_eq!(sent["lines[0][invoice_line_item]"], "il_computer");
    assert_eq!(sent["lines[0][type]"], "invoice_line_item");
    assert!(!sent.contains_key("lines[1][invoice_line_item]"));
    assert_eq!(sent["refund_amount"], "2000");
    assert_eq!(sent["credit_amount"], "0");
    assert_eq!(sent["metadata[computer_refund]"], KEY);
    assert_eq!(
        created[0]
            .headers
            .get("Idempotency-Key")
            .unwrap()
            .to_str()
            .unwrap(),
        KEY
    );
}

/// What the invoice took from the team's credit balance goes back there;
/// only the card part is refunded.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_balance_paid_part_is_credited_back_not_refunded(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let invoices = vec![invoice(
        "in_purchase",
        500,
        vec![line("il_computer", Some(COMPUTER_UUID), 2000, true)],
    )];
    respond(
        &server,
        "GET",
        "/v1/invoices",
        list(invoices, "/v1/invoices"),
    )
    .await;
    respond(
        &server,
        "GET",
        "/v1/credit_notes",
        list(vec![], "/v1/credit_notes"),
    )
    .await;
    respond(
        &server,
        "GET",
        "/v1/credit_notes/preview",
        credit_note("cn_preview", 2000, None, None),
    )
    .await;
    respond(
        &server,
        "POST",
        "/v1/credit_notes",
        credit_note("cn_1", 2000, Some("re_1"), Some(KEY)),
    )
    .await;

    repo(&server, pool)
        .refund_computer_purchase(&subscription(), computer(), KEY)
        .await
        .unwrap();

    let requests = server.received_requests().await.unwrap();
    let sent = form(created_credit_notes(&requests)[0]);
    assert_eq!(sent["refund_amount"], "500");
    assert_eq!(sent["credit_amount"], "1500");
}

/// A retry after the first attempt landed finds its note by key and makes
/// no second one, even past Stripe's idempotency window.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retry_answers_with_the_note_it_already_made(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let invoices = vec![invoice(
        "in_purchase",
        2000,
        vec![line("il_computer", Some(COMPUTER_UUID), 2000, true)],
    )];
    respond(
        &server,
        "GET",
        "/v1/invoices",
        list(invoices, "/v1/invoices"),
    )
    .await;
    respond(
        &server,
        "GET",
        "/v1/credit_notes",
        list(
            vec![credit_note("cn_1", 2000, Some("re_1"), Some(KEY))],
            "/v1/credit_notes",
        ),
    )
    .await;

    let credit = repo(&server, pool)
        .refund_computer_purchase(&subscription(), computer(), KEY)
        .await
        .unwrap();

    assert_eq!(
        credit.map(|credit| credit.credit_note.to_string()),
        Some("cn_1".to_owned())
    );
    let requests = server.received_requests().await.unwrap();
    assert!(created_credit_notes(&requests).is_empty());
}

/// No paid invoice carries the computer: nothing was charged to refund.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_paid_purchase_means_nothing_to_refund(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let invoices = vec![invoice(
        "in_other",
        900,
        vec![line("il_seat", None, 900, true)],
    )];
    respond(
        &server,
        "GET",
        "/v1/invoices",
        list(invoices, "/v1/invoices"),
    )
    .await;

    let credit = repo(&server, pool)
        .refund_computer_purchase(&subscription(), computer(), KEY)
        .await
        .unwrap();

    assert_eq!(credit, None);
}
