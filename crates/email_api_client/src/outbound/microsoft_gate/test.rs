use super::*;

async fn fixture() -> (RedisMicrosoftRequestGate, MailboxAccess) {
    let connection = redis::Client::open("redis://127.0.0.1:6379/")
        .unwrap()
        .get_multiplexed_async_connection()
        .await
        .expect("start local Redis before running this integration test");
    (
        RedisMicrosoftRequestGate(connection),
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
        .query_async(&mut gate.0.clone())
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
            origin: RateLimitOrigin::Local,
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
            ..
        }) => assert!(delay > Duration::from_secs(80)),
        _ => panic!("a shorter cooldown must not erase an existing provider Retry-After"),
    }
    cleanup(&gate, mailbox).await;
}

#[tokio::test]
#[ignore = "requires local Redis on port 6379; uses only unique mailbox keys"]
async fn request_window_survives_permit_release_and_reconnect() {
    let (gate, mailbox) = fixture().await;
    let fill = r#"
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        for i=1,tonumber(ARGV[1]) do redis.call('ZADD',KEYS[1],now,tostring(i)) end
        redis.call('PEXPIRE',KEYS[1],600000)
        return 1
    "#;
    let _: i32 = redis::Script::new(fill)
        .key(&keys(mailbox)[1])
        .arg(REQUESTS_PER_WINDOW)
        .invoke_async(&mut gate.0.clone())
        .await
        .unwrap();
    assert!(
        matches!(gate.acquire(MailboxAccess { grant_generation: 2,..mailbox }).await,
        Err(EmailApiError::RateLimited { retry_after: Some(delay),.. }) if delay > Duration::from_secs(590))
    );
    cleanup(&gate, mailbox).await;
}
