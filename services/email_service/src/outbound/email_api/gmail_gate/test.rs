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

fn refusal_delay(result: Result<RequestPermit, RateLimitRefusal>) -> Duration {
    result
        .err()
        .expect("the request should be refused")
        .retry_after
        .expect("a refusal reports when to retry")
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn backfill_leaves_two_of_five_in_flight_slots_to_live_work() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let mut backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    backfill.wait = Duration::ZERO;
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
    let _second_live = live
        .acquire(link_id, ApiOperationKind::ModifyMessageLabels)
        .await
        .unwrap();
    assert_eq!(
        refusal_delay(
            live.acquire(link_id, ApiOperationKind::ModifyMessageLabels)
                .await
        ),
        Duration::from_secs(1)
    );

    live.finish(first_live, None).await;
    let _third_live = live
        .acquire(link_id, ApiOperationKind::ModifyMessageLabels)
        .await
        .unwrap();
    backfill.finish(backfill_permits.remove(0), None).await;
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
async fn twelve_refused_backfill_requests_wait_for_room_and_the_rest_defer() {
    let connection = connection().await;
    let backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    let link_id = Uuid::now_v7();
    let mut permits = Vec::new();
    for _ in 0..3 {
        permits.push(
            backfill
                .acquire(link_id, ApiOperationKind::GetMessage)
                .await
                .unwrap(),
        );
    }

    let waiters: Vec<Uuid> = (0..12).map(|_| Uuid::now_v7()).collect();
    for &waiter in &waiters {
        assert_eq!(
            backfill
                .admit(link_id, waiter, 5, BACKFILL_WAIT)
                .await
                .unwrap(),
            Admission::Wait(Duration::from_millis(50))
        );
    }
    let deferred = Uuid::now_v7();
    assert_eq!(
        backfill
            .admit(link_id, deferred, 5, BACKFILL_WAIT)
            .await
            .unwrap(),
        Admission::Refused(Duration::from_secs(1))
    );

    backfill.finish(permits.remove(0), None).await;
    assert_eq!(
        backfill
            .wait_for_room(link_id, waiters[0], 5, Duration::from_millis(50))
            .await
            .unwrap(),
        Admission::Admitted(MailboxLoad {
            in_flight: 3,
            cap: 5
        })
    );
    // The admitted waiter gave up its place.
    assert_eq!(
        backfill
            .admit(link_id, deferred, 5, BACKFILL_WAIT)
            .await
            .unwrap(),
        Admission::Wait(Duration::from_millis(50))
    );
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_backfill_request_takes_a_slot_freed_while_it_waits() {
    let connection = connection().await;
    let backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    let link_id = Uuid::now_v7();
    let mut permits = Vec::new();
    for _ in 0..3 {
        permits.push(
            backfill
                .acquire(link_id, ApiOperationKind::GetMessage)
                .await
                .unwrap(),
        );
    }

    let mut waiting = tokio::spawn({
        let backfill = backfill.clone();
        async move {
            backfill
                .acquire(link_id, ApiOperationKind::GetMessage)
                .await
        }
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(300), &mut waiting)
            .await
            .is_err(),
        "a full mailbox holds the backfill request instead of refusing it"
    );
    backfill.finish(permits.remove(0), None).await;
    let admitted = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    assert!(admitted.is_ok());
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_backfill_request_defers_once_its_wait_runs_out() {
    let connection = connection().await;
    let mut backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    backfill.wait = Duration::from_millis(200);
    let link_id = Uuid::now_v7();
    let mut permits = Vec::new();
    for _ in 0..3 {
        permits.push(
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
    let waiting: u32 = redis::cmd("ZCARD")
        .arg(&keys(link_id)[3])
        .query_async(&mut connection.clone())
        .await
        .unwrap();
    assert_eq!(waiting, 0, "a request that stops waiting leaves its place");
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_gmail_rate_limit_pauses_live_work_briefly_and_backfill_longer() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let mut backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    backfill.wait = Duration::ZERO;
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
        local_refusal,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local,
        }),
    )
    .await;
    let _admitted = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();

    live.finish(
        throttled,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: false },
        }),
    )
    .await;
    let live_delay = refusal_delay(live.acquire(link_id, ApiOperationKind::SendMessage).await);
    assert!(live_delay > Duration::from_millis(500) && live_delay <= DEFAULT_COOLDOWN);
    let backfill_delay =
        refusal_delay(backfill.acquire(link_id, ApiOperationKind::GetThread).await);
    assert!(
        backfill_delay > Duration::from_secs(9) && backfill_delay <= BACKFILL_COOLDOWN,
        "backfill leaves the room Gmail has left to live work for longer"
    );
    cleanup(&connection, link_id).await;

    let permit = live
        .acquire(link_id, ApiOperationKind::SendMessage)
        .await
        .unwrap();
    live.finish(
        permit,
        Some(&EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(3_600)),
            origin: RateLimitOrigin::Provider { concurrency: false },
        }),
    )
    .await;
    let delay = refusal_delay(live.acquire(link_id, ApiOperationKind::GetMessage).await);
    assert!(delay > Duration::from_secs(59) && delay <= MAX_COOLDOWN);
    let delay = refusal_delay(
        backfill
            .acquire(link_id, ApiOperationKind::GetMessage)
            .await,
    );
    assert!(delay > Duration::from_secs(59) && delay <= MAX_COOLDOWN);
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_concurrency_429_lowers_the_mailbox_cap_until_it_recovers() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let mut backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    backfill.wait = Duration::ZERO;
    let link_id = Uuid::now_v7();
    let [_, _, cooldown, _, backfill_cooldown, limit] = keys(link_id);
    let concurrency_429 = EmailApiError::RateLimited {
        retry_after: None,
        origin: RateLimitOrigin::Provider { concurrency: true },
    };

    let first = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    let second = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    live.finish(first, Some(&concurrency_429)).await;
    // Requests already in flight under the old cap don't lower it again.
    live.finish(second, Some(&concurrency_429)).await;
    let _: () = redis::cmd("DEL")
        .arg(&cooldown)
        .arg(&backfill_cooldown)
        .query_async(&mut connection.clone())
        .await
        .unwrap();

    let backfill_permit = backfill
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    assert!(
        backfill
            .acquire(link_id, ApiOperationKind::GetMessage)
            .await
            .is_err(),
        "backfill keeps one of the three slots Gmail allows"
    );
    let mut permits = vec![backfill_permit];
    for _ in 0..2 {
        permits.push(
            live.acquire(link_id, ApiOperationKind::GetMessage)
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        refusal_delay(live.acquire(link_id, ApiOperationKind::GetMessage).await),
        Duration::from_secs(1),
        "the mailbox's cap fell from five to three"
    );

    // Two minutes later the cap is back at five.
    let rewind = r#"
        redis.call('HINCRBY', KEYS[1], 'at', -120000)
        return 1
    "#;
    let _: i32 = redis::Script::new(rewind)
        .key(&limit)
        .invoke_async(&mut connection.clone())
        .await
        .unwrap();
    for _ in 0..2 {
        permits.push(
            live.acquire(link_id, ApiOperationKind::GetMessage)
                .await
                .unwrap(),
        );
    }
    cleanup(&connection, link_id).await;

    let permit = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    live.finish(
        permit,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: false },
        }),
    )
    .await;
    let learned: Option<u32> = redis::cmd("HGET")
        .arg(&limit)
        .arg("cap")
        .query_async(&mut connection.clone())
        .await
        .unwrap();
    assert_eq!(learned, None, "a quota 429 leaves the cap alone");
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn an_admitted_request_reports_the_mailbox_load_it_joined() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let link_id = Uuid::now_v7();

    let first = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    let second = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    assert_eq!(
        first.load(),
        Some(MailboxLoad {
            in_flight: 1,
            cap: 5
        })
    );
    assert_eq!(
        second.load(),
        Some(MailboxLoad {
            in_flight: 2,
            cap: 5
        })
    );

    live.finish(
        first,
        Some(&EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Provider { concurrency: true },
        }),
    )
    .await;
    let _: () = redis::cmd("DEL")
        .arg(&keys(link_id)[2])
        .query_async(&mut connection.clone())
        .await
        .unwrap();
    let third = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .unwrap();
    assert_eq!(
        third.load(),
        Some(MailboxLoad {
            in_flight: 2,
            cap: 3
        }),
        "the load reports the learned cap"
    );
    cleanup(&connection, link_id).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn quota_units_are_refused_until_the_oldest_second_leaves_the_window() {
    let connection = connection().await;
    let live = RedisGmailRequestGate::new(connection.clone(), RateBudget::Live);
    let mut backfill = RedisGmailRequestGate::new(connection.clone(), RateBudget::Backfill);
    backfill.wait = Duration::ZERO;
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
    live.finish(permit, None).await;
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
            .await
            .err(),
        Some(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER)))
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
    let first = live
        .acquire(link_id, ApiOperationKind::GetMessage)
        .await
        .err();
    assert!(
        first.is_none() || first == Some(RateLimitRefusal::new(Some(UNAVAILABLE_RETRY_AFTER))),
        "{first:?}"
    );
    assert!(
        live.acquire(link_id, ApiOperationKind::GetMessage)
            .await
            .is_ok(),
        "the gate reconnects instead of refusing until a restart"
    );
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
