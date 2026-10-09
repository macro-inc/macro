use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

fn subscription() -> stripe::Subscription {
    stripe::Subscription {
        id: "sub_team".parse().unwrap(),
        customer: stripe::Expandable::Id("cus_test".parse().unwrap()),
        status: stripe::SubscriptionStatus::Active,
        current_period_start: 1_800_000_000,
        current_period_end: 1_802_678_400,
        currency: stripe::Currency::USD,
        items: stripe::List {
            data: vec![
                item("si_max", "price_max", 2),
                item("si_pro", "price_pro", 2),
            ],
            has_more: false,
            total_count: Some(2),
            url: "/v1/subscription_items".into(),
        },
        ..Default::default()
    }
}
fn item(id: &str, price: &str, quantity: u64) -> stripe::SubscriptionItem {
    stripe::SubscriptionItem {
        id: id.parse().unwrap(),
        price: Some(stripe::Price {
            id: price.parse().unwrap(),
            product: Some(stripe::Expandable::Id("prod_test".parse().unwrap())),
            ..Default::default()
        }),
        quantity: Some(quantity),
        ..Default::default()
    }
}
fn schedule() -> stripe::SubscriptionSchedule {
    stripe::SubscriptionSchedule {
        id: "sub_sched_test".parse().unwrap(),
        customer: stripe::Expandable::Id("cus_test".parse().unwrap()),
        metadata: Some(HashMap::from([(OWNED_KEY.into(), "1".into())])),
        phases: vec![stripe::SubscriptionSchedulePhaseConfiguration {
            start_date: 1_800_000_000,
            end_date: 1_802_678_400,
            currency: stripe::Currency::USD,
            coupon: Some(stripe::Expandable::Id("coupon_existing".parse().unwrap())),
            default_payment_method: Some(stripe::Expandable::Id("pm_existing".parse().unwrap())),
            default_tax_rates: Some(vec![stripe::TaxRate {
                id: "txr_existing".parse().unwrap(),
                ..Default::default()
            }]),
            items: vec![
                stripe::SubscriptionScheduleConfigurationItem {
                    price: stripe::Expandable::Id("price_max".parse().unwrap()),
                    quantity: Some(2),
                    ..Default::default()
                },
                stripe::SubscriptionScheduleConfigurationItem {
                    price: stripe::Expandable::Id("price_pro".parse().unwrap()),
                    quantity: Some(2),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }
}
fn repo(server: &MockServer, pool: sqlx::PgPool) -> CustomerRepositoryImpl {
    CustomerRepositoryImpl::new(
        stripe::Client::from_url(server.uri().as_str(), "sk_test"),
        SeatPrices {
            premium: "price_pro".into(),
            max: Some("price_max".into()),
        },
        pool,
    )
}
async fn mount<T: Serialize + DeserializeOwned>(
    server: &MockServer,
    verb: &str,
    route: &str,
    value: &T,
    priority: u8,
) {
    Mock::given(method(verb))
        .and(path(route))
        .respond_with(ResponseTemplate::new(200).set_body_json(response(value)))
        .with_priority(priority)
        .mount(server)
        .await;
}
fn response<T: Serialize + DeserializeOwned>(value: &T) -> Value {
    let mut value = serde_json::to_value(value).unwrap();
    for _ in 0..256 {
        match serde_json::from_value::<T>(value.clone()) {
            Ok(_) => return value,
            Err(error) => {
                let message = error.to_string();
                let field = message
                    .strip_prefix("missing field `")
                    .and_then(|s| s.split_once('`'))
                    .map(|(s, _)| s)
                    .unwrap_or_else(|| panic!("invalid fixture: {message}"));
                fill_missing(&mut value, field);
            }
        }
    }
    panic!("invalid stripe fixture")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pending_status_reads_only_the_callers_seat_from_an_active_owned_schedule(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let sub = subscription();
    let mut sched = schedule();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 5).await;
    mount(&server, "POST", "/v1/subscription_schedules", &sched, 5).await;
    mount(
        &server,
        "POST",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        5,
    )
    .await;
    let repo = repo(&server, pool);
    let user = MacroUserIdStr::try_from("macro|max@example.com").unwrap();
    repo.schedule_seat_plan(&sub.id, &user, Some(SeatPlan::Premium))
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let update = form(
        requests
            .iter()
            .find(|r| {
                r.method.as_str() == "POST"
                    && r.url.path() == "/v1/subscription_schedules/sub_sched_test"
            })
            .unwrap(),
    );
    sched.status = stripe::SubscriptionScheduleStatus::Active;
    sched.metadata.as_mut().unwrap().insert(
        PENDING_KEY.into(),
        update["metadata[macro_pending_seats]"].clone(),
    );
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        5,
    )
    .await;
    let pending = repo
        .scheduled_seat_plan(&sub.id, &sched.id, &user)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(pending.plan, SeatPlan::Premium);
    assert_eq!(pending.effective_at.timestamp(), sub.current_period_end);
    let other = MacroUserIdStr::try_from("macro|other@example.com").unwrap();
    assert!(
        repo.scheduled_seat_plan(&sub.id, &sched.id, &other)
            .await
            .unwrap()
            .is_none()
    );

    sched.status = stripe::SubscriptionScheduleStatus::Released;
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        2,
    )
    .await;
    assert!(
        repo.scheduled_seat_plan(&sub.id, &sched.id, &user)
            .await
            .unwrap()
            .is_none()
    );
    sched.status = stripe::SubscriptionScheduleStatus::Active;
    sched.metadata.as_mut().unwrap().remove(OWNED_KEY);
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        1,
    )
    .await;
    assert!(
        repo.scheduled_seat_plan(&sub.id, &sched.id, &user)
            .await
            .unwrap()
            .is_none()
    );
}
fn fill_missing(value: &mut Value, field: &str) {
    match value {
        Value::Object(map) => {
            map.entry(field).or_insert(Value::Null);
            for child in map.values_mut() {
                fill_missing(child, field);
            }
        }
        Value::Array(values) => {
            for child in values {
                fill_missing(child, field);
            }
        }
        _ => {}
    }
}
fn form(request: &wiremock::Request) -> HashMap<String, String> {
    url::form_urlencoded::parse(&request.body)
        .into_owned()
        .collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn downgrade_preserves_current_prices_and_terms_then_keep_max_releases_schedule(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let sub = subscription();
    let mut sched = schedule();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 5).await;
    mount(&server, "POST", "/v1/subscription_schedules", &sched, 5).await;
    mount(
        &server,
        "POST",
        "/v1/subscription_schedules/sub_sched_test",
        &sched,
        5,
    )
    .await;
    let repo = repo(&server, pool.clone());
    let user = MacroUserIdStr::try_from("macro|max@example.com").unwrap();
    repo.schedule_seat_plan(&sub.id, &user, Some(SeatPlan::Premium))
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let update = form(
        requests
            .iter()
            .find(|r| {
                r.method.as_str() == "POST"
                    && r.url.path() == "/v1/subscription_schedules/sub_sched_test"
            })
            .unwrap(),
    );
    assert_eq!(update["proration_behavior"], "none");
    assert_eq!(
        update["phases[0][end_date]"],
        sub.current_period_end.to_string()
    );
    assert_eq!(update["phases[0][items][0][quantity]"], "2");
    assert_eq!(update["phases[1][items][0][quantity]"], "1");
    assert_eq!(update["phases[1][items][1][quantity]"], "3");
    assert_eq!(
        update["phases[1][start_date]"],
        sub.current_period_end.to_string()
    );
    assert_eq!(update["phases[1][coupon]"], "coupon_existing");
    assert_eq!(update["phases[1][default_payment_method]"], "pm_existing");
    assert_eq!(update["phases[1][default_tax_rates][0]"], "txr_existing");
    assert_eq!(update["end_behavior"], "release");
    assert!(
        !requests
            .iter()
            .any(|r| r.method.as_str() == "POST" && r.url.path() == "/v1/subscriptions/sub_team")
    );
    sched.metadata.as_mut().unwrap().insert(
        PENDING_KEY.into(),
        update[&format!("metadata[{PENDING_KEY}]")].clone(),
    );
    let mut sub = sub;
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
        "/v1/subscription_schedules/sub_sched_test/release",
        &sched,
        1,
    )
    .await;
    repo.schedule_seat_plan(&sub.id, &user, None).await.unwrap();
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.url.path().ends_with("/release"))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unrelated_upgrade_keeps_other_seats_pending_and_prorates_only_current_phase(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    let mut sched = schedule();
    let id = macro_uuid::generate_uuid_v7();
    let at = chrono::DateTime::from_timestamp(sub.current_period_end, 0).unwrap();
    let members = json!({"macro|one@example.com": "premium", "macro|two@example.com": "premium"});
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
        .move_seat(&sub.id, SeatPlan::Premium, SeatPlan::Max)
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let update = form(
        requests
            .iter()
            .find(|r| r.method.as_str() == "POST")
            .unwrap(),
    );
    assert_eq!(update["proration_behavior"], "always_invoice");
    assert_eq!(update["phases[0][items][0][quantity]"], "3");
    assert_eq!(update["phases[0][items][1][quantity]"], "1");
    assert_eq!(update["phases[1][items][0][quantity]"], "1");
    assert_eq!(update["phases[1][items][1][quantity]"], "3");
    assert_eq!(update["phases[1][proration_behavior]"], "none");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scheduled_members_are_returned_only_after_the_provider_renews(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    let id = macro_uuid::generate_uuid_v7();
    let at = chrono::DateTime::from_timestamp(sub.current_period_end, 0).unwrap();
    let members = json!({"macro|max@example.com": "premium"});
    sqlx::query!("INSERT INTO subscription_plan_schedule (id, subscription_id, effective_at, member_plans) VALUES ($1, 'sub_team', $2, $3)", id, at, members).execute(&pool).await.unwrap();
    sub.metadata.insert(APPLIED_KEY.into(), id.to_string());
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 5).await;
    let repo = repo(&server, pool);
    assert!(repo.renewed_seat_plans(&sub.id).await.unwrap().is_empty());
    sub.current_period_start = sub.current_period_end;
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    assert_eq!(
        repo.renewed_seat_plans(&sub.id).await.unwrap(),
        vec![("macro|max@example.com".into(), SeatPlan::Premium)]
    );
}

#[tokio::test]
async fn personal_upgrade_replaces_the_existing_item_and_invoices_proration() {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![item("si_personal", "price_pro", 1)];
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;
    let pool = sqlx::PgPool::connect_lazy("postgres://user@localhost/unused").unwrap();
    repo(&server, pool)
        .upgrade_personal_plan(&sub.id, SeatPlan::Max)
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let update = form(
        requests
            .iter()
            .find(|r| r.method.as_str() == "POST")
            .unwrap(),
    );
    assert_eq!(update["items[0][id]"], "si_personal");
    assert_eq!(update["items[0][price]"], "price_max");
    assert_eq!(update["proration_behavior"], "always_invoice");
    assert!(
        chrono::DateTime::parse_from_rfc3339(&update["metadata[macro_plan_change_at]"]).is_ok()
    );
}
