use super::*;

async fn connection() -> MultiplexedConnection {
    redis::Client::open("redis://127.0.0.1:6379/")
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .expect("start local Redis before running this integration test")
}

async fn fixture() -> (RedisMicrosoftRequestGate, MailboxAccess) {
    (
        RedisMicrosoftRequestGate::new(connection().await, RequestBudget::Live),
        MailboxAccess {
            sync_generation: 1,
            link_id: Uuid::now_v7(),
            grant_generation: 1,
        },
    )
}

async fn cleanup(gate: &RedisMicrosoftRequestGate, mailbox: MailboxAccess) {
    let _: i32 = redis::cmd("DEL")
        .arg(&keys(mailbox))
        .query_async(&mut gate.connection.clone())
        .await
        .unwrap();
}

fn refusal(result: Result<Uuid, EmailApiError>) -> (GateLimit, Duration) {
    match result {
        Err(EmailApiError::RateLimited {
            retry_after: Some(delay),
            origin: RateLimitOrigin::Gate(limit),
        }) => (limit, delay),
        _ => panic!("the gate should refuse the request"),
    }
}

/// Adds `count` requests sent `age` ago to the mailbox's request window.
async fn fill_window(
    gate: &RedisMicrosoftRequestGate,
    mailbox: MailboxAccess,
    count: u32,
    age: Duration,
) {
    let fill = r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local sent = now - tonumber(ARGV[2])
        for i=1,tonumber(ARGV[1]) do redis.call('ZADD',KEYS[1],sent,ARGV[2] .. ':' .. i) end
        redis.call('PEXPIRE',KEYS[1],600000)
        return 1
    "#;
    let _: i32 = redis::Script::new(fill)
        .key(&keys(mailbox)[1])
        .arg(count)
        .arg(age.as_millis().to_string())
        .invoke_async(&mut gate.connection.clone())
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn concurrent_requests_share_limits_and_reconnect_does_not_reset_them() {
    let (gate, mailbox) = fixture().await;
    let first = gate.acquire(mailbox).await.unwrap();
    let second = gate.acquire(mailbox).await.unwrap();
    let third = gate.acquire(mailbox).await.unwrap();
    let reconnected = MailboxAccess {
        sync_generation: 1,
        grant_generation: 2,
        ..mailbox
    };
    assert!(matches!(
        gate.acquire(reconnected).await,
        Err(EmailApiError::RateLimited {
            origin: RateLimitOrigin::Gate(GateLimit::Concurrency),
            ..
        })
    ));
    gate.finish(mailbox, first, None).await;
    let fourth = gate.acquire(reconnected).await.unwrap();
    gate.finish(mailbox, second, Some(Duration::from_secs(90)))
        .await;
    gate.finish(mailbox, third, Some(Duration::from_secs(1)))
        .await;
    gate.finish(reconnected, fourth, None).await;
    match gate.acquire(mailbox).await {
        Err(EmailApiError::RateLimited {
            retry_after: Some(delay),
            origin: RateLimitOrigin::Gate(GateLimit::Cooldown),
        }) => assert!(delay > Duration::from_secs(80)),
        _ => panic!("a shorter cooldown must not erase an existing provider Retry-After"),
    }
    // Four requests were admitted, all under sync generation 1.
    assert_eq!(gate.admitted(mailbox).await, Some(4));
    assert_eq!(
        gate.admitted(MailboxAccess {
            sync_generation: 2,
            ..mailbox
        })
        .await,
        None
    );
    cleanup(&gate, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_full_mailbox_asks_for_a_retry_in_a_second_not_when_the_oldest_lease_expires() {
    let (gate, mailbox) = fixture().await;
    for _ in 0..3 {
        gate.acquire(mailbox).await.unwrap();
    }
    // The permits in flight hold 90-second leases, but each frees its slot as
    // soon as its request finishes.
    assert_eq!(
        refusal(gate.acquire(mailbox).await),
        (GateLimit::Concurrency, Duration::from_secs(1))
    );
    cleanup(&gate, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn request_window_survives_permit_release_and_reconnect() {
    let (gate, mailbox) = fixture().await;
    fill_window(&gate, mailbox, REQUESTS_PER_WINDOW, Duration::ZERO).await;
    let (limit, delay) = refusal(
        gate.acquire(MailboxAccess {
            grant_generation: 2,
            ..mailbox
        })
        .await,
    );
    assert_eq!(limit, GateLimit::Window);
    assert!(delay > Duration::from_secs(590));
    cleanup(&gate, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn import_leaves_a_slot_and_part_of_the_window_to_calendar_and_other_live_work() {
    let (live, mailbox) = fixture().await;
    let mut import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    import.wait = Duration::ZERO;

    let first_import = import.acquire(mailbox).await.unwrap();
    import.acquire(mailbox).await.unwrap();
    assert_eq!(
        refusal(import.acquire(mailbox).await),
        (GateLimit::Concurrency, Duration::from_secs(1))
    );
    // Calendar sync and user actions use the live budget, which keeps the
    // mailbox's third slot and is refused at once, never held, when it is full.
    let calendar = live.acquire(mailbox).await.unwrap();
    assert_eq!(
        refusal(live.acquire(mailbox).await),
        (GateLimit::Concurrency, Duration::from_secs(1))
    );
    import.finish(mailbox, first_import, None).await;
    assert!(
        import.acquire(mailbox).await.is_err(),
        "a released import slot must not let import take the last slot while live work holds one"
    );
    live.finish(mailbox, calendar, None).await;
    import.acquire(mailbox).await.unwrap();
    cleanup(&live, mailbox).await;

    let (_, mailbox) = fixture().await;
    fill_window(&live, mailbox, IMPORT_REQUESTS_PER_WINDOW, Duration::ZERO).await;
    let (limit, delay) = refusal(import.acquire(mailbox).await);
    assert_eq!(limit, GateLimit::Window);
    assert!(delay > Duration::from_secs(590));
    live.acquire(mailbox).await.unwrap();
    cleanup(&live, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn a_full_window_sets_the_retry_even_while_every_slot_is_taken() {
    let (live, mailbox) = fixture().await;
    let import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    for _ in 0..CONCURRENT_REQUESTS {
        live.acquire(mailbox).await.unwrap();
    }
    fill_window(&live, mailbox, REQUESTS_PER_WINDOW, Duration::from_secs(1)).await;
    for gate in [&live, &import] {
        let (limit, delay) = refusal(gate.acquire(mailbox).await);
        assert_eq!(limit, GateLimit::Window);
        assert!(delay > Duration::from_secs(590), "retry after {delay:?}");
    }
    cleanup(&live, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn an_import_request_waits_only_until_the_window_has_room_for_it() {
    let (live, mailbox) = fixture().await;
    let import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    // Ten requests leave the window in ten seconds, but live work has sent
    // ten more than the import's share since: the import must wait for those
    // to leave too, not only the oldest.
    fill_window(&live, mailbox, 10, Duration::from_secs(590)).await;
    fill_window(&live, mailbox, IMPORT_REQUESTS_PER_WINDOW, Duration::ZERO).await;
    assert!(matches!(
        import.admit(mailbox, Uuid::now_v7(), IMPORT_WAIT).await.unwrap(),
        Admission::Refused(GateLimit::Window, delay) if delay > Duration::from_secs(590)
    ));
    cleanup(&live, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn two_refused_import_requests_wait_for_room_and_the_rest_defer() {
    let (live, mailbox) = fixture().await;
    let poll = Duration::from_millis(WAIT_POLL_MS.into());
    let import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    let mut permits = Vec::new();
    for _ in 0..2 {
        permits.push(import.acquire(mailbox).await.unwrap());
    }

    let waiters: Vec<Uuid> = (0..2).map(|_| Uuid::now_v7()).collect();
    for &waiter in &waiters {
        assert_eq!(
            import.admit(mailbox, waiter, IMPORT_WAIT).await.unwrap(),
            Admission::Wait(GateLimit::Concurrency, poll)
        );
    }
    let deferred = Uuid::now_v7();
    assert_eq!(
        import.admit(mailbox, deferred, IMPORT_WAIT).await.unwrap(),
        Admission::Refused(GateLimit::Concurrency, Duration::from_secs(1))
    );

    import.finish(mailbox, permits.remove(0), None).await;
    assert_eq!(
        import
            .wait_for_room(mailbox, waiters[0], poll)
            .await
            .unwrap(),
        Admission::Admitted
    );
    // The admitted waiter gave up its place.
    assert_eq!(
        import.admit(mailbox, deferred, IMPORT_WAIT).await.unwrap(),
        Admission::Wait(GateLimit::Concurrency, poll)
    );
    cleanup(&live, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn an_import_request_takes_a_slot_freed_while_it_waits() {
    let (live, mailbox) = fixture().await;
    let import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    let first = import.acquire(mailbox).await.unwrap();
    import.acquire(mailbox).await.unwrap();

    let mut waiting = tokio::spawn({
        let import = import.clone();
        async move { import.acquire(mailbox).await }
    });
    assert!(
        tokio::time::timeout(Duration::from_millis(300), &mut waiting)
            .await
            .is_err(),
        "a mailbox at its import share holds the import request instead of refusing it"
    );
    let places: u32 = redis::cmd("ZCARD")
        .arg(&keys(mailbox)[4])
        .query_async(&mut live.connection.clone())
        .await
        .unwrap();
    assert_eq!(places, 1, "the request holds a waiter's place");
    import.finish(mailbox, first, None).await;
    let admitted = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    assert!(admitted.is_ok());
    cleanup(&live, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn an_import_request_defers_once_its_wait_runs_out() {
    let (live, mailbox) = fixture().await;
    let mut import = RedisMicrosoftRequestGate::new(live.connection.clone(), RequestBudget::Import);
    import.wait = Duration::from_millis(200);
    for _ in 0..2 {
        import.acquire(mailbox).await.unwrap();
    }

    assert_eq!(
        refusal(import.acquire(mailbox).await),
        (GateLimit::Concurrency, Duration::from_secs(1))
    );
    let waiting: u32 = redis::cmd("ZCARD")
        .arg(&keys(mailbox)[4])
        .query_async(&mut live.connection.clone())
        .await
        .unwrap();
    assert_eq!(waiting, 0, "a request that stops waiting leaves its place");
    cleanup(&live, mailbox).await;
}
