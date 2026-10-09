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
    let mut attached = sub.clone();
    attached.schedule = Some(stripe::Expandable::Id(sched.id.clone()));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &attached, 2).await;
    assert_eq!(
        repo.pending_seat_plan(&sub.id, &user).await.unwrap(),
        Some(pending)
    );
    attached.current_period_start = sub.current_period_end;
    mount(&server, "GET", "/v1/subscriptions/sub_team", &attached, 1).await;
    assert!(
        repo.pending_seat_plan(&sub.id, &user)
            .await
            .unwrap()
            .is_none()
    );
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
            .find(|r| {
                r.method.as_str() == "POST"
                    && r.url.path() == "/v1/subscription_schedules/sub_sched_test"
            })
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_upgrade_replaces_the_existing_item_and_invoices_proration(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    sub.items.data = vec![item("si_personal", "price_pro", 1)];
    let schedule = schedule();
    sub.schedule = Some(stripe::Expandable::Id(schedule.id.clone()));
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &schedule,
        1,
    )
    .await;
    mount(
        &server,
        "POST",
        "/v1/subscription_schedules/sub_sched_test/release",
        &schedule,
        1,
    )
    .await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 1).await;
    repo(&server, pool)
        .upgrade_personal_plan(&sub.id, SeatPlan::Max)
        .await
        .unwrap();
    let requests = server.received_requests().await.unwrap();
    let update = form(
        requests
            .iter()
            .find(|r| r.method.as_str() == "POST" && r.url.path() == "/v1/subscriptions/sub_team")
            .unwrap(),
    );
    assert_eq!(update["items[0][id]"], "si_personal");
    assert_eq!(update["items[0][price]"], "price_max");
    assert_eq!(update["proration_behavior"], "always_invoice");
    let release = requests
        .iter()
        .position(|request| request.url.path().ends_with("/release"))
        .unwrap();
    let upgrade = requests
        .iter()
        .position(|request| {
            request.method.as_str() == "POST" && request.url.path() == "/v1/subscriptions/sub_team"
        })
        .unwrap();
    assert!(release < upgrade);
    assert!(
        chrono::DateTime::parse_from_rfc3339(&update["metadata[macro_plan_change_at]"]).is_ok()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_instances_preserve_all_scheduled_members_and_seat_additions(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    let sched = schedule();
    sub.schedule = Some(stripe::Expandable::Id(sched.id.clone()));
    let provider = Arc::new(std::sync::Mutex::new((sub, sched)));
    let read_sub = provider.clone();
    Mock::given(method("GET"))
        .and(path("/v1/subscriptions/sub_team"))
        .respond_with(move |_: &wiremock::Request| {
            ResponseTemplate::new(200)
                .set_body_json(response(&read_sub.lock().unwrap().0))
                .set_delay(std::time::Duration::from_millis(30))
        })
        .mount(&server)
        .await;
    let read_schedule = provider.clone();
    Mock::given(method("GET"))
        .and(path("/v1/subscription_schedules/sub_sched_test"))
        .respond_with(move |_: &wiremock::Request| {
            ResponseTemplate::new(200).set_body_json(response(&read_schedule.lock().unwrap().1))
        })
        .mount(&server)
        .await;
    let write = provider.clone();
    Mock::given(method("POST"))
        .and(path("/v1/subscription_schedules/sub_sched_test"))
        .respond_with(move |request: &wiremock::Request| {
            let fields = form(request);
            let mut state = write.lock().unwrap();
            state.1.metadata.as_mut().unwrap().insert(
                PENDING_KEY.into(),
                fields["metadata[macro_pending_seats]"].clone(),
            );
            let original = state.1.phases[0].clone();
            state.1.phases = (0..2)
                .map(|phase_index| {
                    let mut phase = original.clone();
                    phase.items = (0..3)
                        .filter_map(|index| {
                            let price = fields
                                .get(&format!("phases[{phase_index}][items][{index}][price]"))?;
                            let quantity = fields
                                [&format!("phases[{phase_index}][items][{index}][quantity]")]
                                .parse()
                                .unwrap();
                            Some(stripe::SubscriptionScheduleConfigurationItem {
                                price: stripe::Expandable::Id(price.parse().unwrap()),
                                quantity: Some(quantity),
                                ..Default::default()
                            })
                        })
                        .collect();
                    phase
                })
                .collect();
            state.0.items.data = state.1.phases[0]
                .items
                .iter()
                .map(|seat| {
                    let price = seat.price.id();
                    item(
                        if price.as_str() == "price_max" {
                            "si_max"
                        } else {
                            "si_pro"
                        },
                        price.as_str(),
                        seat.quantity.unwrap(),
                    )
                })
                .collect();
            ResponseTemplate::new(200).set_body_json(response(&state.1))
        })
        .mount(&server)
        .await;
    // Separate adapters (and lock pools) simulate independent service replicas.
    let one = repo(&server, pool.clone());
    let two = repo(&server, pool.clone());
    let seats = repo(&server, pool);
    let subscription = "sub_team".parse().unwrap();
    let first = MacroUserIdStr::try_from("macro|one@example.com").unwrap();
    let second = MacroUserIdStr::try_from("macro|two@example.com").unwrap();
    let (a, b, c) = tokio::join!(
        one.schedule_seat_plan(&subscription, &first, Some(SeatPlan::Premium)),
        two.schedule_seat_plan(&subscription, &second, Some(SeatPlan::Premium)),
        seats.increment_seat_count(&subscription, SeatPlan::Premium, 1),
    );
    a.unwrap();
    b.unwrap();
    c.unwrap();
    let schedule = provider.lock().unwrap().1.clone();
    let sub = provider.lock().unwrap().0.clone();
    let pending = one.pending_changes(&schedule, &sub).await.unwrap();
    assert_eq!(pending.members.len(), 2);
    assert_eq!(
        pending.members.get(first.as_ref()),
        Some(&SeatPlan::Premium)
    );
    assert_eq!(
        pending.members.get(second.as_ref()),
        Some(&SeatPlan::Premium)
    );
    assert_eq!(
        phase_quantities(&phase_parameters(&schedule.phases[0]).unwrap()).unwrap(),
        HashMap::from([("price_max".into(), 2), ("price_pro".into(), 3)])
    );
    assert_eq!(
        phase_quantities(&phase_parameters(&schedule.phases[1]).unwrap()).unwrap(),
        HashMap::from([("price_pro".into(), 5)])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cancelling_a_guard_holder_releases_the_subscription_for_another_instance(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let holder = repo(&server, pool.clone());
    let waiter = repo(&server, pool);
    let locked = Arc::new(tokio::sync::Notify::new());
    let acquired = locked.clone();
    let task = tokio::spawn(async move {
        let id = "sub_team".parse().unwrap();
        let _guard = holder.subscription_guard(&id).await.unwrap();
        acquired.notify_one();
        std::future::pending::<()>().await;
    });
    locked.notified().await;
    let id = "sub_team".parse().unwrap();
    let mut waiting = Box::pin(waiter.subscription_guard(&id));
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(40), &mut waiting)
            .await
            .is_err()
    );
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let _guard = tokio::time::timeout(std::time::Duration::from_secs(2), waiting)
        .await
        .unwrap()
        .unwrap();
}
