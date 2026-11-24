//! Business seats, annual subscriptions, legacy prices, and downgrades
//! between any two plans.

use super::*;

fn annual_subscription() -> stripe::Subscription {
    let mut sub = subscription();
    sub.items.data = vec![
        item("si_max", "price_max_year", 1),
        item("si_business", "price_business_year", 2),
    ];
    sub
}

fn posted_forms(requests: &[wiremock::Request]) -> Vec<HashMap<String, String>> {
    requests
        .iter()
        .filter(|request| request.method.as_str() == "POST")
        .map(form)
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_first_business_seat_on_an_annual_subscription_uses_the_annual_price(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let mut sub = annual_subscription();
    sub.items.data = vec![item("si_max", "price_max_year", 1)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .increment_seat_count(&sub.id, SeatPlan::Business, 1)
        .await
        .unwrap();

    let posted = posted_forms(&server.received_requests().await.unwrap());
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0]["items[0][price]"], "price_business_year");
    assert_eq!(posted[0]["items[0][quantity]"], "1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn premium_is_refused_on_an_annual_subscription_before_anything_is_sent(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let sub = annual_subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;
    let repo = repo(&server, pool);

    let added = repo
        .increment_seat_count(&sub.id, SeatPlan::Premium, 1)
        .await;
    let moved = repo
        .move_seat(&sub.id, SeatPlan::Business, SeatPlan::Premium)
        .await;

    assert!(matches!(
        added,
        Err(CustomerError::PlanUnavailable(SeatPlan::Premium))
    ));
    assert!(matches!(
        moved,
        Err(CustomerError::PlanUnavailable(SeatPlan::Premium))
    ));
    assert!(posted_forms(&server.received_requests().await.unwrap()).is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_max_seat_added_to_a_legacy_max_item_keeps_the_legacy_price(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![
        item("si_max", "price_max_legacy", 2),
        item("si_pro", "price_pro", 1),
    ];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .increment_seat_count(&sub.id, SeatPlan::Max, 1)
        .await
        .unwrap();

    let posted = posted_forms(&server.received_requests().await.unwrap());
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0]["items[0][id]"], "si_max");
    assert_eq!(posted[0]["items[0][quantity]"], "3");
    assert!(!posted[0].contains_key("items[0][price]"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pro_trial_gaining_a_business_seat_ends_the_trial(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.status = stripe::SubscriptionStatus::Trialing;
    sub.items.data = vec![item("si_pro", "price_pro", 2)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;

    repo(&server, pool)
        .move_seat(&sub.id, SeatPlan::Premium, SeatPlan::Business)
        .await
        .unwrap();

    let posted = posted_forms(&server.received_requests().await.unwrap());
    assert_eq!(posted.len(), 1);
    assert_eq!(posted[0]["trial_end"], "now");
    assert_eq!(posted[0]["billing_cycle_anchor"], "now");
    assert_eq!(posted[0]["items[1][price]"], "price_business");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn renewal_phase_applies_downgrades_from_each_source_plan(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![
        item("si_max", "price_max_legacy", 2),
        item("si_business", "price_business", 1),
        item("si_pro", "price_pro", 1),
    ];
    let mut sched = schedule();
    sched.phases[0].items = vec![
        stripe::SubscriptionScheduleConfigurationItem {
            price: stripe::Expandable::Id("price_max_legacy".parse().unwrap()),
            quantity: Some(2),
            ..Default::default()
        },
        stripe::SubscriptionScheduleConfigurationItem {
            price: stripe::Expandable::Id("price_business".parse().unwrap()),
            quantity: Some(1),
            ..Default::default()
        },
        stripe::SubscriptionScheduleConfigurationItem {
            price: stripe::Expandable::Id("price_pro".parse().unwrap()),
            quantity: Some(1),
            ..Default::default()
        },
    ];
    mount(
        &server,
        "POST",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        1,
    )
    .await;
    let repo = repo(&server, pool);
    let current = phase_parameters(&sched.phases[0]).unwrap();
    let pending = PendingChanges {
        at: sub.current_period_end,
        members: HashMap::from([
            (
                "macro|max-to-business@example.com".to_string(),
                PendingSeat::Move(SeatDowngrade {
                    from: SeatPlan::Max,
                    to: SeatPlan::Business,
                }),
            ),
            (
                "macro|business-to-pro@example.com".to_string(),
                PendingSeat::Move(SeatDowngrade {
                    from: SeatPlan::Business,
                    to: SeatPlan::Premium,
                }),
            ),
            (
                "macro|legacy-record@example.com".to_string(),
                PendingSeat::Target(SeatPlan::Premium),
            ),
        ]),
    };

    repo.write_schedule(&sched, &sub, current, pending, "none", None)
        .await
        .unwrap();

    let posted = posted_forms(&server.received_requests().await.unwrap());
    assert_eq!(posted.len(), 1);
    let renewal: HashMap<String, String> = (0..)
        .map_while(|index| {
            let price = posted[0].get(&format!("phases[1][items][{index}][price]"))?;
            let quantity = &posted[0][&format!("phases[1][items][{index}][quantity]")];
            Some((price.clone(), quantity.clone()))
        })
        .collect();
    // Max loses both seats (one to Business, one by the legacy record to
    // Pro); Business gains one and loses one; Pro gains two.
    assert_eq!(
        renewal,
        HashMap::from([
            ("price_business".to_string(), "1".to_string()),
            ("price_pro".to_string(), "3".to_string()),
        ])
    );
}

#[test]
fn pending_records_written_before_business_read_as_downgrades_from_max() {
    let legacy: PendingChanges =
        serde_json::from_value(json!({"at": 1, "members": {"macro|a@example.com": "premium"}}))
            .unwrap();
    let current: PendingChanges = serde_json::from_value(json!({
        "at": 1,
        "members": {"macro|b@example.com": {"from": "business", "to": "premium"}}
    }))
    .unwrap();

    assert_eq!(
        legacy.members["macro|a@example.com"].downgrade(),
        MAX_TO_PRO
    );
    assert_eq!(
        current.members["macro|b@example.com"].downgrade(),
        SeatDowngrade {
            from: SeatPlan::Business,
            to: SeatPlan::Premium,
        }
    );
}
