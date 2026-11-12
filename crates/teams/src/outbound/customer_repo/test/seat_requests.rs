//! Seat changes send the same Stripe requests they sent before subscription
//! item changes (Macro computers) were added: the same endpoints in the same
//! order, the same form fields, always-invoice proration, and no
//! `Idempotency-Key`. The expected requests are written out from the seat code
//! as it was before that change.

use super::*;

/// Every request the mock received: method, path with query, form fields in
/// the order they were sent, and whether it carried an idempotency key.
async fn sent(server: &MockServer) -> Vec<(String, String, Vec<(String, String)>, bool)> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| {
            let path = match request.url.query() {
                Some(query) if !query.is_empty() => format!("{}?{query}", request.url.path()),
                _ => request.url.path().to_string(),
            };
            (
                request.method.to_string(),
                path,
                url::form_urlencoded::parse(&request.body)
                    .into_owned()
                    .collect(),
                request.headers.contains_key("Idempotency-Key"),
            )
        })
        .collect()
}

fn get_subscription() -> (String, String, Vec<(String, String)>, bool) {
    (
        "GET".to_string(),
        "/v1/subscriptions/sub_team".to_string(),
        vec![],
        false,
    )
}

fn pairs(fields: &[(&str, &str)]) -> Vec<(String, String)> {
    fields
        .iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adding_a_seat_to_an_existing_plan_sends_mains_request(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .increment_seat_count(&sub.id, SeatPlan::Premium, 1)
        .await
        .unwrap();

    assert_eq!(
        sent(&server).await,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("items[0][id]", "si_pro"),
                    ("items[0][quantity]", "3"),
                    ("proration_behavior", "always_invoice"),
                ]),
                false,
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn adding_the_first_seat_on_a_plan_sends_mains_request(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![item("si_pro", "price_pro", 2)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .increment_seat_count(&sub.id, SeatPlan::Max, 2)
        .await
        .unwrap();

    assert_eq!(
        sent(&server).await,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("items[0][price]", "price_max"),
                    ("items[0][quantity]", "2"),
                    ("proration_behavior", "always_invoice"),
                ]),
                false,
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_seats_sends_mains_requests(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![
        item("si_max", "price_max", 1),
        item("si_pro", "price_pro", 3),
    ];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;
    let repo = repo(&server, pool);

    repo.decrement_seat_count(&sub.id, SeatPlan::Premium, 1)
        .await
        .unwrap();
    repo.decrement_seat_count(&sub.id, SeatPlan::Max, 1)
        .await
        .unwrap();

    assert_eq!(
        sent(&server).await,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("items[0][id]", "si_pro"),
                    ("items[0][quantity]", "2"),
                    ("proration_behavior", "always_invoice"),
                ]),
                false,
            ),
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("items[0][deleted]", "true"),
                    ("items[0][id]", "si_max"),
                    ("proration_behavior", "always_invoice"),
                ]),
                false,
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_the_last_seat_sends_nothing(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![item("si_pro", "price_pro", 1)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .decrement_seat_count(&sub.id, SeatPlan::Premium, 1)
        .await
        .unwrap();

    assert_eq!(sent(&server).await, vec![get_subscription()]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moving_a_seat_sends_mains_request(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .move_seat(&sub.id, SeatPlan::Premium, SeatPlan::Max)
        .await
        .unwrap();

    assert_eq!(
        sent(&server).await,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("items[0][id]", "si_pro"),
                    ("items[0][quantity]", "1"),
                    ("items[1][id]", "si_max"),
                    ("items[1][quantity]", "3"),
                    ("proration_behavior", "always_invoice"),
                ]),
                false,
            ),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trial_gaining_its_first_max_seat_sends_mains_request(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.status = stripe::SubscriptionStatus::Trialing;
    sub.items.data = vec![item("si_pro", "price_pro", 1)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .move_seat(&sub.id, SeatPlan::Premium, SeatPlan::Max)
        .await
        .unwrap();

    assert_eq!(
        sent(&server).await,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "POST".to_string(),
                "/v1/subscriptions/sub_team".to_string(),
                pairs(&[
                    ("billing_cycle_anchor", "now"),
                    ("items[0][deleted]", "true"),
                    ("items[0][id]", "si_pro"),
                    ("items[1][price]", "price_max"),
                    ("items[1][quantity]", "1"),
                    ("proration_behavior", "always_invoice"),
                    ("trial_end", "now"),
                ]),
                false,
            ),
        ]
    );
}

/// With downgrades scheduled for renewal, a seat change rewrites both schedule
/// phases. The schedule metadata is a map, so its fields are compared unordered.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_seat_change_with_scheduled_downgrades_sends_mains_schedule_update(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    let mut sched = schedule();
    let id = macro_uuid::generate_uuid_v7();
    let at = chrono::DateTime::from_timestamp(sub.current_period_end, 0).unwrap();
    let members = json!({"macro|one@example.com": "premium"});
    sqlx::query!("INSERT INTO subscription_plan_schedule (id, subscription_id, effective_at, member_plans) VALUES ($1, 'sub_team', $2, $3)", id, at, members).execute(&pool).await.unwrap();
    sched
        .metadata
        .as_mut()
        .unwrap()
        .insert(PENDING_KEY.into(), id.to_string());
    sub.schedule = Some(stripe::Expandable::Id(sched.id.clone()));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        1,
    )
    .await;
    mount(
        &server,
        "POST",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        1,
    )
    .await;

    repo(&server, pool)
        .increment_seat_count(&sub.id, SeatPlan::Premium, 1)
        .await
        .unwrap();

    let mut requests = sent(&server).await;
    let (method, path, fields, idempotent) = requests.pop().unwrap();
    assert_eq!(
        requests,
        vec![
            get_subscription(),
            get_subscription(),
            (
                "GET".to_string(),
                "/v1/subscription_schedules/sub_sched_test".to_string(),
                vec![],
                false,
            ),
        ]
    );
    assert_eq!(method, "POST");
    assert_eq!(path, "/v1/subscription_schedules/sub_sched_test");
    assert!(!idempotent);
    let mut fields: std::collections::BTreeMap<String, String> = fields.into_iter().collect();
    // Each write stores its renewal record under a fresh id.
    let record = fields["metadata[macro_pending_seats]"].clone();
    assert_ne!(record, id.to_string());
    assert_eq!(
        fields.remove("phases[1][metadata][macro_renewed_seats]"),
        Some(record.clone())
    );
    assert_eq!(fields.remove("metadata[macro_pending_seats]"), Some(record));
    assert_eq!(
        fields,
        std::collections::BTreeMap::from(
            [
                ("end_behavior", "release"),
                ("metadata[macro_plan_schedule]", "1"),
                ("phases[0][coupon]", "coupon_existing"),
                ("phases[0][currency]", "usd"),
                ("phases[0][default_payment_method]", "pm_existing"),
                ("phases[0][default_tax_rates][0]", "txr_existing"),
                ("phases[0][end_date]", "1802678400"),
                ("phases[0][items][0][price]", "price_max"),
                ("phases[0][items][0][quantity]", "2"),
                ("phases[0][items][1][price]", "price_pro"),
                ("phases[0][items][1][quantity]", "3"),
                ("phases[0][proration_behavior]", "none"),
                ("phases[0][start_date]", "1800000000"),
                ("phases[1][coupon]", "coupon_existing"),
                ("phases[1][currency]", "usd"),
                ("phases[1][default_payment_method]", "pm_existing"),
                ("phases[1][default_tax_rates][0]", "txr_existing"),
                ("phases[1][items][0][price]", "price_max"),
                ("phases[1][items][0][quantity]", "1"),
                ("phases[1][items][1][price]", "price_pro"),
                ("phases[1][items][1][quantity]", "4"),
                ("phases[1][iterations]", "1"),
                ("phases[1][proration_behavior]", "none"),
                ("phases[1][start_date]", "1802678400"),
                ("proration_behavior", "always_invoice"),
            ]
            .map(|(key, value)| (key.to_string(), value.to_string()))
        )
    );
}
