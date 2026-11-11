use super::*;
use crate::outbound::customer_repo::test::{computer, mount, repo, subscription};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn receipts_survive_intervening_item_changes_and_replay_without_stripe(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 2).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &sub, 2).await;
    let repo = repo(&server, pool);
    repo.change_item_quantities(
        &sub.id,
        vec![computer(1)],
        ItemProration::InvoiceNow,
        "computer-add:first",
    )
    .await
    .unwrap();
    repo.change_item_quantities(
        &sub.id,
        vec![computer(1)],
        ItemProration::InvoiceNow,
        "computer-add:second",
    )
    .await
    .unwrap();
    assert!(repo.replay_item_change("computer-add:first").await.unwrap());
    assert!(
        repo.replay_item_change("computer-add:second")
            .await
            .unwrap()
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 4);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_charge_replays_the_exact_request(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    Mock::given(method("POST"))
        .and(path("/v1/subscriptions/sub_team"))
        .respond_with(
            ResponseTemplate::new(500)
                .set_body_json(json!({"error": {"type": "api_error", "message": "response lost"}})),
        )
        .expect(1)
        .mount(&server)
        .await;
    let repo = repo(&server, pool.clone());
    assert!(
        repo.change_item_quantities(
            &sub.id,
            vec![computer(1)],
            ItemProration::InvoiceNow,
            "computer-add:pending"
        )
        .await
        .is_err()
    );
    let first_requests = server.received_requests().await.unwrap();
    let original = first_requests
        .iter()
        .find(|request| request.method.as_str() == "POST")
        .unwrap()
        .body
        .clone();
    server.reset().await;
    // The current quantity is irrelevant: the journal reuses the original request.
    let mut changed = sub.clone();
    changed.items.data[0].quantity = Some(91);
    mount(&server, "GET", "/v1/subscriptions/sub_team", &changed, 1).await;
    mount(&server, "POST", "/v1/subscriptions/sub_team", &changed, 1).await;
    assert!(
        repo.replay_item_change("computer-add:pending")
            .await
            .unwrap()
    );
    let retried = server.received_requests().await.unwrap();
    let post = retried
        .iter()
        .find(|request| request.method.as_str() == "POST")
        .unwrap();
    assert_eq!(post.body, original);
    assert_eq!(
        post.headers.get("Idempotency-Key").unwrap(),
        "computer-add:pending"
    );
    let outcome = sqlx::query_scalar!(r#"SELECT outcome::text AS "outcome!" FROM subscription_item_change WHERE idempotency_key = 'computer-add:pending'"#).fetch_one(&pool).await.unwrap();
    assert_eq!(outcome, "succeeded");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lost_success_is_recovered_from_the_atomic_marker_without_another_charge(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    sqlx::query!("INSERT INTO subscription_item_change (idempotency_key, subscription_id, path, request) VALUES ('computer-add:lost', 'sub_team', '/subscriptions/sub_team', $1)", json!({"items": [{"price": "price_computer", "quantity": 1}], "metadata": {"macro_item_change": "computer-add:lost"}, "payment_behavior": "error_if_incomplete"})).execute(&pool).await.unwrap();
    let mut sub = subscription();
    sub.metadata
        .insert(ITEM_CHANGE_KEY.to_owned(), "computer-add:lost".to_owned());
    mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
    let repo = repo(&server, pool);
    assert!(repo.replay_item_change("computer-add:lost").await.unwrap());
    assert!(repo.replay_item_change("computer-add:lost").await.unwrap());
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_declined_receipt_cannot_later_charge_even_if_the_subscription_changes(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    sqlx::query!("INSERT INTO subscription_item_change (idempotency_key, subscription_id, path, request, outcome) VALUES ('computer-add:declined', 'sub_team', '/subscriptions/sub_team', '{}', 'payment_failed')").execute(&pool).await.unwrap();
    assert!(matches!(
        repo(&server, pool)
            .replay_item_change("computer-add:declined")
            .await,
        Err(CustomerError::PaymentFailed)
    ));
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_schedule_charge_marks_the_same_atomic_request_and_recovers_without_reinvoicing(
    pool: sqlx::PgPool,
) {
    let server = MockServer::start().await;
    let mut sub = subscription();
    let schedule = crate::outbound::customer_repo::test::schedule();
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
        "/v1/subscription_schedules/sub_sched_test",
        &schedule,
        1,
    )
    .await;
    let repo = repo(&server, pool.clone());
    repo.change_item_quantities(
        &sub.id,
        vec![computer(1)],
        ItemProration::InvoiceNow,
        "computer-add:scheduled",
    )
    .await
    .unwrap();
    let requests = server.received_requests().await.unwrap();
    let post = requests
        .iter()
        .find(|request| request.method.as_str() == "POST")
        .unwrap();
    assert_eq!(
        post.headers.get("Idempotency-Key").unwrap(),
        "computer-add:scheduled"
    );
    let receipt = sqlx::query!("SELECT request, path FROM subscription_item_change WHERE idempotency_key = 'computer-add:scheduled'").fetch_one(&pool).await.unwrap();
    assert_eq!(
        receipt.request["metadata"][ITEM_CHANGE_KEY],
        "computer-add:scheduled"
    );
    assert_eq!(receipt.path, "/subscription_schedules/sub_sched_test");
    // Model the provider's success followed by a lost local receipt write.
    sqlx::query!("UPDATE subscription_item_change SET outcome = 'pending' WHERE idempotency_key = 'computer-add:scheduled'").execute(&pool).await.unwrap();
    server.reset().await;
    let mut completed = schedule;
    completed.metadata.as_mut().unwrap().insert(
        ITEM_CHANGE_KEY.to_owned(),
        "computer-add:scheduled".to_owned(),
    );
    mount(
        &server,
        "GET",
        "/v1/subscription_schedules/sub_sched_test",
        &completed,
        1,
    )
    .await;
    assert!(
        repo.replay_item_change("computer-add:scheduled")
            .await
            .unwrap()
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

/// A change left pending (its response lost, then never replayed) must not
/// wedge the subscription: the next guarded mutation settles it by the
/// provider's marker and goes ahead.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_next_mutation_settles_a_pending_change_instead_of_refusing(pool: sqlx::PgPool) {
    for (landed, expected) in [(false, "abandoned"), (true, "succeeded")] {
        sqlx::query!("DELETE FROM subscription_item_change")
            .execute(&pool)
            .await
            .unwrap();
        let server = MockServer::start().await;
        let sub = subscription();
        mount(&server, "GET", "/v1/subscriptions/sub_team", &sub, 1).await;
        Mock::given(method("POST"))
            .and(path("/v1/subscriptions/sub_team"))
            .respond_with(
                ResponseTemplate::new(500).set_body_json(
                    json!({"error": {"type": "api_error", "message": "response lost"}}),
                ),
            )
            .expect(1)
            .mount(&server)
            .await;
        let repo = repo(&server, pool.clone());
        assert!(
            repo.change_item_quantities(
                &sub.id,
                vec![computer(1)],
                ItemProration::InvoiceNow,
                "computer-restore:lost",
            )
            .await
            .is_err()
        );
        server.reset().await;
        let mut current = sub.clone();
        if landed {
            current.metadata.insert(
                ITEM_CHANGE_KEY.to_owned(),
                "computer-restore:lost".to_owned(),
            );
        }
        // One read settles the pending change, one is the new change's own.
        mount(&server, "GET", "/v1/subscriptions/sub_team", &current, 2).await;
        mount(&server, "POST", "/v1/subscriptions/sub_team", &current, 1).await;
        repo.change_item_quantities(
            &sub.id,
            vec![computer(1)],
            ItemProration::InvoiceNow,
            "computer-add:next",
        )
        .await
        .unwrap();
        let outcome = sqlx::query_scalar!(r#"SELECT outcome::text AS "outcome!" FROM subscription_item_change WHERE idempotency_key = 'computer-restore:lost'"#).fetch_one(&pool).await.unwrap();
        assert_eq!(outcome, expected, "landed: {landed}");
    }
}

/// Settling a change that was never sent fences it: a send still on its way
/// (another replica, or a request that has not taken the guard yet) finds
/// the abandoned receipt and never charges.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn settling_an_unsent_change_fences_a_later_send(pool: sqlx::PgPool) {
    let server = MockServer::start().await;
    let sub = subscription();
    let repo = repo(&server, pool.clone());
    assert_eq!(
        repo.settle_item_change("computer-add:expired", Some(&sub.id))
            .await
            .unwrap(),
        ItemChangeSettlement::NotApplied
    );
    assert!(matches!(
        repo.change_item_quantities(
            &sub.id,
            vec![computer(1)],
            ItemProration::InvoiceNow,
            "computer-add:expired",
        )
        .await,
        Err(CustomerError::ItemChangeAbandoned)
    ));
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|request| request.method.as_str() != "POST")
    );
}
