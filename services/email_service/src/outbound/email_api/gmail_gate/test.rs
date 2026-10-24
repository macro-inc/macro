use super::*;

async fn connection() -> ConnectionManager {
    redis::Client::open("redis://127.0.0.1:6379/")
        .unwrap()
        .get_connection_manager()
        .await
        .expect("start local Redis before running this integration test")
}

async fn cleanup(connection: &ConnectionManager, link_id: Uuid) {
    let _: i32 = redis::cmd("DEL")
        .arg(&keys(link_id))
        .query_async(&mut connection.clone())
        .await
        .unwrap();
}

fn refusal_delay(result: Result<Uuid, RateLimitRefusal>) -> Duration {
    result
        .expect_err("the request should be refused")
        .retry_after
        .expect("a refusal reports when to retry")
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn backfill_leaves_two_of_five_in_flight_slots_to_live_work() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    let link_id = Uuid::now_v7();

    let mut backfill_permits = Vec::new();
    for _ in 0..3 {
        backfill_permits.push(
            backfill
                .acquire(link_id, ApiOperationKind::GetMessage)
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        refusal_delay(
            backfill
                .acquire(link_id, ApiOperationKind::GetMessage)
                .await
        ),
        Duration::from_secs(1)
    );
    let first_live = live
        .acquire(link_id, ApiOperationKind::ModifyMessageLabels)
        .await
        .unwrap();
    live.acquire(link_id, ApiOperationKind::ModifyMessageLabels)
        .await
        .unwrap();
    assert_eq!(
        refusal_delay(
            live.acquire(link_id, ApiOperationKind::ModifyMessageLabels)
                .await
        ),
        Duration::from_secs(1)
    );

    live.finish(link_id, first_live, None).await;
    live.acquire(link_id, ApiOperationKind::ModifyMessageLabels)
        .await
        .unwrap();
    backfill.finish(link_id, backfill_permits[0], None).await;
    assert!(
        backfill
            .acquire(link_id, ApiOperationKind::GetMessage)
            .await
            .is_err(),
        "a released backfill slot must not let backfill exceed its share while live holds the rest"
    );
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_gmail_rate_limit_pauses_every_caller_for_the_capped_cooldown() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    let link_id = Uuid::now_v7();

    let throttled = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    let local_refusal = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    live.finish(
        link_id,
        local_refusal,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local,
        }),
    )
    .await;
    live.acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();

    live.finish(
        link_id,
        throttled,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider,
        }),
    )
    .await;
    let delay = refusal_delay(backfill.acquire(link_id, ApiOperationKind::GetThread).await);
    assert!(delay > Duration::from_secs(4) && delay <= DEFAULT_COOLDOWN);

    assert!(
        live.acquire(link_id, ApiOperationKind::SendMessage)
            .await
            .is_err(),
        "the cooldown applies to every operation"
    );
    cleanup(&connection, link_id).await;

    let permit = live
        .acquire(link_id, ApiOperationKind::SendMessage)
        .await
        .unwrap();
    live.finish(
        link_id,
        permit,
        Some(&EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(3_600)),
            origin: RateLimitOrigin::Provider,
        }),
    )
    .await;
    let delay = refusal_delay(live.acquire(link_id, ApiOperationKind::GetMessage).await);
    assert!(delay > Duration::from_secs(59) && delay <= MAX_COOLDOWN);
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn quota_units_are_refused_until_the_oldest_second_leaves_the_window() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    let link_id = Uuid::now_v7();
    let fill = r#"
        local clock = redis.call('TIME')
        redis.call('HSET', KEYS[1], tonumber(clock[1]) - 2, ARGV[1])
        redis.call('HSET', KEYS[1], tonumber(clock[1]) - 1, ARGV[2])
        redis.call('HSET', KEYS[1], tonumber(clock[1]) - 60, 100000)
        return 1
    "#;
    let _: i32 = redis::Script::new(fill)
        .key(&keys(link_id)[1])
        .arg(200)
        .arg(2_000)
        .invoke_async(&mut connection.clone())
        .await
        .unwrap();

    // 2,200 units are in the window; the expired bucket no longer counts.
    let permit = live
        .acquire(link_id, ApiOperationKind::ListThreads)
        .await
        .unwrap();
    live.finish(link_id, permit, None).await;
    // A send fits once the oldest second leaves the window; backfill's lower
    // threshold also has to wait for the next one.
    let live_delay = refusal_delay(live.acquire(link_id, ApiOperationKind::SendMessage).await);
    let backfill_delay = refusal_delay(
        backfill
            .acquire(link_id, ApiOperationKind::GetMessage)
            .await,
    );
    assert!(live_delay > Duration::from_secs(6) && live_delay <= Duration::from_secs(8));
    assert!(backfill_delay > Duration::from_secs(7) && backfill_delay <= Duration::from_secs(9));
    assert!(backfill_delay > live_delay);
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_redis_failure_defers_the_request_instead_of_admitting_it() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let link_id = Uuid::now_v7();
    let _: () = redis::cmd("SET")
        .arg(&keys(link_id)[0])
        .arg("not a sorted set")
        .query_async(&mut connection.clone())
        .await
        .unwrap();

    assert_eq!(
        live.acquire(link_id, ApiOperationKind::ModifyMessageLabels)
            .await,
        Err(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER)))
    );
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; kills only its own connection"]
async fn admission_resumes_after_redis_drops_the_connection() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let link_id = Uuid::now_v7();
    let id: i64 = redis::cmd("CLIENT")
        .arg("ID")
        .query_async(&mut connection.clone())
        .await
        .unwrap();
    let _: redis::RedisResult<i32> = redis::cmd("CLIENT")
        .arg("KILL")
        .arg("ID")
        .arg(id)
        .query_async(&mut connection.clone())
        .await;

    // The first request after the drop may still meet the dead connection.
    let first = live.acquire(link_id, ApiOperationKind::GetMessage).await;
    assert!(
        first.is_ok() || first == Err(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER))),
        "{first:?}"
    );
    live.acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .expect("the gate reconnects instead of refusing until a restart");
    cleanup(&connection, link_id).await;
}

#[test]
fn contacts_use_a_one_unit_shared_budget_proxy() {
    assert_eq!(gmail_operation(ApiOperationKind::ListContacts).cost(), 1);
}

#[test]
fn composite_blocklist_operations_use_the_dominant_filter_write_cost() {
    assert_eq!(gmail_operation(ApiOperationKind::BlockSender).cost(), 5);
    assert_eq!(gmail_operation(ApiOperationKind::UnblockSender).cost(), 5);
}
