use std::time::Duration;

use crate::{
    RateBudgetPort, RateLimitConfig, RateLimitKey, RateLimitPort, RateLimitResult,
    RateLimitServiceImpl, TokenBucketConfig, TokenBucketPort, TokenBucketResult,
    domain::ports::RateLimitService, outbound::redis::RedisRateLimitAdapter,
};

fn redis_client() -> redis::Client {
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    redis::Client::open(url).expect("failed to create Redis client")
}

fn unique_key(name: &str) -> RateLimitKey {
    RateLimitKey::builder(&format!("test_{name}_{}", uuid::Uuid::new_v4())).finish()
}

fn adapter() -> RedisRateLimitAdapter<redis::Client> {
    RedisRateLimitAdapter {
        redis: redis_client(),
    }
}

fn service() -> RateLimitServiceImpl<RedisRateLimitAdapter<redis::Client>> {
    RateLimitServiceImpl { repo: adapter() }
}

#[tokio::test]
async fn retry_after_is_populated_when_rate_limit_exceeded() {
    let svc = service();
    let key = unique_key("retry_after");
    let config = RateLimitConfig {
        max_count: 1,
        window: Duration::from_secs(30),
    };

    // First request succeeds (check atomically increments the counter).
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .expect("check_rate_limit failed");
    assert!(ticket.is_ok(), "first request should be allowed");

    // Second request should be exceeded.
    let ticket = svc
        .check_rate_limit(key, config.clone())
        .await
        .expect("check_rate_limit failed");

    match ticket {
        RateLimitResult::Err(exceeded) => {
            assert!(
                !exceeded.retry_after.is_zero(),
                "retry_after should be non-zero"
            );
            assert!(
                exceeded.retry_after <= config.window,
                "retry_after ({:?}) should not exceed the window ({:?})",
                exceeded.retry_after,
                config.window,
            );
        }
        RateLimitResult::Ok(_) => {
            panic!("expected rate limit to be exceeded after max_count requests");
        }
    }
}

#[tokio::test]
async fn retry_after_decreases_over_time() {
    let svc = service();
    let key = unique_key("retry_decreases");
    let config = RateLimitConfig {
        max_count: 1,
        window: Duration::from_secs(30),
    };

    // Exhaust the rate limit (check atomically increments).
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    assert!(ticket.is_ok(), "first request should be allowed");

    // Check immediately.
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    let first_retry_after = match ticket {
        RateLimitResult::Err(e) => e.retry_after,
        _ => panic!("expected exceeded"),
    };

    // Wait a bit then check again.
    tokio::time::sleep(Duration::from_secs(2)).await;

    let ticket = svc.check_rate_limit(key, config).await.unwrap();
    let second_retry_after = match ticket {
        RateLimitResult::Err(e) => e.retry_after,
        _ => panic!("expected exceeded"),
    };

    assert!(
        second_retry_after < first_retry_after,
        "retry_after should decrease over time: first={first_retry_after:?}, second={second_retry_after:?}",
    );
}

#[tokio::test]
async fn check_atomically_increments_counter() {
    let adapter = adapter();
    let key = unique_key("atomic_incr");
    let config = RateLimitConfig {
        max_count: 3,
        window: Duration::from_secs(30),
    };

    // Each check should atomically increment, consuming one slot.
    for i in 1..=3 {
        let result = adapter.check(key.clone(), config.clone()).await.unwrap();
        match result {
            RateLimitResult::Ok(ok) => {
                assert_eq!(ok.current_count, i, "count after check #{i}");
            }
            RateLimitResult::Err(_) => panic!("check #{i} should be allowed"),
        }
    }

    // Fourth check should be denied without incrementing past 3.
    let result = adapter.check(key.clone(), config.clone()).await.unwrap();
    match result {
        RateLimitResult::Err(exceeded) => {
            assert_eq!(exceeded.current_count, 3);
            assert_eq!(exceeded.max_count, 3);
        }
        RateLimitResult::Ok(_) => panic!("fourth check should be denied"),
    }
}

#[tokio::test]
async fn denied_check_does_not_increment() {
    let client = redis_client();
    let key = unique_key("denied_no_incr");
    let key_str = super::redis_key(&key);
    let config = RateLimitConfig {
        max_count: 1,
        window: Duration::from_secs(30),
    };
    let adapter = adapter();

    // Exhaust the limit.
    let result = adapter.check(key.clone(), config.clone()).await.unwrap();
    assert!(result.is_ok());

    // Hammer the key with denied checks.
    for _ in 0..5 {
        let result = adapter.check(key.clone(), config.clone()).await.unwrap();
        assert!(result.is_err());
    }

    // Counter should still be 1 — denied checks must not increment.
    let count: Option<u64> = redis::AsyncCommands::get(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        &key_str,
    )
    .await
    .unwrap();
    assert_eq!(count, Some(1), "counter should not grow past limit");
}

#[tokio::test]
async fn rollback_frees_a_slot() {
    let svc = service();
    let key = unique_key("rollback");
    let config = RateLimitConfig {
        max_count: 1,
        window: Duration::from_secs(30),
    };

    // Use the one allowed slot.
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap()
        .expect("first check should succeed");

    // Now the limit is reached.
    let result = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    assert!(result.is_err(), "should be denied after exhausting limit");

    // Roll back the ticket (simulating a failed downstream action).
    svc.rollback_ticket(ticket).await.unwrap();

    // The slot should be free again.
    let result = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    assert!(result.is_ok(), "should be allowed after rollback");
}

#[tokio::test]
async fn rollback_does_not_go_below_zero() {
    let client = redis_client();
    let adapter = adapter();
    let key = unique_key("rollback_floor");
    let key_str = super::redis_key(&key);

    // Decrement on a key that was never incremented.
    adapter.decrement(&key).await.unwrap();

    let count: Option<u64> = redis::AsyncCommands::get(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        &key_str,
    )
    .await
    .unwrap();
    assert!(
        count.is_none() || count == Some(0),
        "counter should not go negative, got {count:?}"
    );
}

#[tokio::test]
async fn concurrent_checks_do_not_exceed_limit() {
    let key = unique_key("concurrent");
    let config = RateLimitConfig {
        max_count: 5,
        window: Duration::from_secs(30),
    };

    // Spawn 20 concurrent checks against a limit of 5.
    let mut handles = Vec::new();
    for _ in 0..20 {
        let adapter = adapter();
        let k = key.clone();
        let c = config.clone();
        handles.push(tokio::spawn(async move { adapter.check(k, c).await }));
    }

    let mut allowed = 0u64;
    let mut denied = 0u64;
    for handle in handles {
        let result = handle.await.unwrap().unwrap();
        match result {
            RateLimitResult::Ok(_) => allowed += 1,
            RateLimitResult::Err(_) => denied += 1,
        }
    }

    assert_eq!(allowed, 5, "exactly max_count requests should be allowed");
    assert_eq!(denied, 15, "the rest should be denied");
}

#[tokio::test]
async fn check_and_increment_sets_expiry_on_first_key() {
    let client = redis_client();
    let key = unique_key("expiry");
    let key_str = super::redis_key(&key);
    let config = RateLimitConfig {
        max_count: 10,
        window: Duration::from_secs(60),
    };
    let adapter = adapter();

    let _ = adapter.check(key, config).await.unwrap();

    let ttl: i64 = redis::AsyncCommands::ttl(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        &key_str,
    )
    .await
    .unwrap();
    assert!(
        ttl > 0 && ttl <= 60,
        "key should have a TTL within the window, got {ttl}"
    );
}

async fn bucket_adapter() -> RedisRateLimitAdapter<redis::aio::ConnectionManager> {
    RedisRateLimitAdapter {
        redis: redis_client().get_connection_manager().await.unwrap(),
    }
}

async fn redis_now_ms(client: &redis::Client) -> u64 {
    let (seconds, micros): (u64, u64) = redis::cmd("TIME")
        .query_async(&mut client.get_multiplexed_async_connection().await.unwrap())
        .await
        .unwrap();
    seconds * 1000 + micros / 1000
}

#[tokio::test]
async fn a_bucket_lets_its_capacity_through_at_once_then_waits_for_its_next_token() {
    let adapter = bucket_adapter().await;
    let key = unique_key("bucket_capacity");
    let config = TokenBucketConfig {
        capacity: 3,
        refill_interval: Duration::from_secs(60),
    };

    let mut taken = Vec::new();
    for _ in 0..3 {
        taken.push(
            TokenBucketPort::take(&adapter, key.clone(), config)
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        taken,
        vec![
            TokenBucketResult::Taken { remaining: 2 },
            TokenBucketResult::Taken { remaining: 1 },
            TokenBucketResult::Taken { remaining: 0 },
        ]
    );

    match TokenBucketPort::take(&adapter, key, config).await.unwrap() {
        TokenBucketResult::Empty { retry_after } => {
            assert!(!retry_after.is_zero());
            assert!(retry_after <= Duration::from_secs(60), "{retry_after:?}");
        }
        TokenBucketResult::Taken { remaining } => {
            panic!("an empty bucket gave a token, {remaining} left")
        }
    }
}

#[tokio::test]
async fn an_emptied_bucket_gains_one_token_per_refill_interval() {
    let client = redis_client();
    let adapter = bucket_adapter().await;
    let key = unique_key("bucket_refill");
    let config = TokenBucketConfig {
        capacity: 200,
        refill_interval: Duration::from_secs(60),
    };
    let emptied_at = redis_now_ms(&client).await - 150_000;
    let _: () = redis::AsyncCommands::hset_multiple(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        super::token_bucket_key(&key),
        &[("tokens", 0), ("refilled_at", emptied_at)],
    )
    .await
    .unwrap();

    assert_eq!(
        TokenBucketPort::take(&adapter, key.clone(), config)
            .await
            .unwrap(),
        TokenBucketResult::Taken { remaining: 1 }
    );
    assert_eq!(
        TokenBucketPort::take(&adapter, key.clone(), config)
            .await
            .unwrap(),
        TokenBucketResult::Taken { remaining: 0 }
    );
    match TokenBucketPort::take(&adapter, key, config).await.unwrap() {
        TokenBucketResult::Empty { retry_after } => {
            assert!(!retry_after.is_zero());
            assert!(retry_after <= Duration::from_secs(30), "{retry_after:?}");
        }
        TokenBucketResult::Taken { remaining } => {
            panic!("the third token came early, {remaining} left")
        }
    }
}

#[tokio::test]
async fn a_full_bucket_banks_no_time_beyond_its_capacity() {
    let client = redis_client();
    let adapter = bucket_adapter().await;
    let key = unique_key("bucket_full");
    let config = TokenBucketConfig {
        capacity: 3,
        refill_interval: Duration::from_secs(1),
    };
    let an_hour_ago = redis_now_ms(&client).await - 3_600_000;
    let _: () = redis::AsyncCommands::hset_multiple(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        super::token_bucket_key(&key),
        &[("tokens", 3), ("refilled_at", an_hour_ago)],
    )
    .await
    .unwrap();

    assert_eq!(
        TokenBucketPort::take(&adapter, key, config).await.unwrap(),
        TokenBucketResult::Taken { remaining: 2 }
    );
}

#[tokio::test]
async fn a_full_bucket_starts_its_next_token_from_its_first_take() {
    let client = redis_client();
    let adapter = bucket_adapter().await;
    let key = unique_key("bucket_full_restart");
    let config = TokenBucketConfig {
        capacity: 3,
        refill_interval: Duration::from_secs(60),
    };
    let full_since = redis_now_ms(&client).await - 90_000;
    let _: () = redis::AsyncCommands::hset_multiple(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        super::token_bucket_key(&key),
        &[("tokens", 3), ("refilled_at", full_since)],
    )
    .await
    .unwrap();

    for _ in 0..3 {
        TokenBucketPort::take(&adapter, key.clone(), config)
            .await
            .unwrap();
    }

    match TokenBucketPort::take(&adapter, key, config).await.unwrap() {
        TokenBucketResult::Empty { retry_after } => {
            assert!(retry_after > Duration::from_secs(45), "{retry_after:?}");
        }
        TokenBucketResult::Taken { remaining } => {
            panic!("a fourth token came from banked time, {remaining} left")
        }
    }
}

#[tokio::test]
async fn concurrent_takes_never_take_more_than_the_capacity() {
    let key = unique_key("bucket_concurrent");
    let config = TokenBucketConfig {
        capacity: 5,
        refill_interval: Duration::from_secs(60),
    };

    let adapter = bucket_adapter().await;
    let mut handles = Vec::new();
    for _ in 0..20 {
        let adapter = adapter.clone();
        let key = key.clone();
        handles.push(tokio::spawn(async move {
            TokenBucketPort::take(&adapter, key, config).await
        }));
    }
    let mut taken = 0;
    for handle in handles {
        if let TokenBucketResult::Taken { .. } = handle.await.unwrap().unwrap() {
            taken += 1;
        }
    }

    assert_eq!(taken, 5);
}

#[tokio::test]
async fn each_key_has_its_own_bucket() {
    let adapter = bucket_adapter().await;
    let emptied = unique_key("bucket_emptied");
    let other = unique_key("bucket_other");
    let config = TokenBucketConfig {
        capacity: 1,
        refill_interval: Duration::from_secs(60),
    };

    TokenBucketPort::take(&adapter, emptied.clone(), config)
        .await
        .unwrap();
    assert!(matches!(
        TokenBucketPort::take(&adapter, emptied, config)
            .await
            .unwrap(),
        TokenBucketResult::Empty { .. }
    ));

    assert_eq!(
        TokenBucketPort::take(&adapter, other, config)
            .await
            .unwrap(),
        TokenBucketResult::Taken { remaining: 0 }
    );
}

#[tokio::test]
async fn a_bucket_expires_once_it_would_be_full_again() {
    let client = redis_client();
    let adapter = bucket_adapter().await;
    let key = unique_key("bucket_expiry");
    let config = TokenBucketConfig {
        capacity: 3,
        refill_interval: Duration::from_secs(1),
    };

    TokenBucketPort::take(&adapter, key.clone(), config)
        .await
        .unwrap();

    let ttl_ms: i64 = redis::AsyncCommands::pttl(
        &mut client.get_multiplexed_async_connection().await.unwrap(),
        super::token_bucket_key(&key),
    )
    .await
    .unwrap();
    assert!(ttl_ms > 0 && ttl_ms <= 3_000, "{ttl_ms}");
}

#[tokio::test]
async fn concurrent_takes_share_the_managers_one_connection() {
    let client = redis_client();
    let manager = client.get_connection_manager().await.unwrap();
    let name = format!("rtb-test-{}", uuid::Uuid::new_v4().simple());
    let _: () = redis::cmd("CLIENT")
        .arg("SETNAME")
        .arg(&name)
        .query_async(&mut manager.clone())
        .await
        .unwrap();
    let adapter = RedisRateLimitAdapter { redis: manager };
    let key = unique_key("bucket_shared_connection");
    let config = TokenBucketConfig {
        capacity: 50,
        refill_interval: Duration::from_secs(60),
    };

    let mut handles = Vec::new();
    for _ in 0..20 {
        let adapter = adapter.clone();
        let key = key.clone();
        handles.push(tokio::spawn(async move {
            TokenBucketPort::take(&adapter, key, config).await
        }));
    }
    for handle in handles {
        handle.await.unwrap().unwrap();
    }

    let clients: String = redis::cmd("CLIENT")
        .arg("LIST")
        .query_async(&mut client.get_multiplexed_async_connection().await.unwrap())
        .await
        .unwrap();
    let name_field = format!("name={name}");
    let named: Vec<&str> = clients
        .lines()
        .filter(|line| line.split(' ').any(|field| field == name_field))
        .collect();
    assert_eq!(named.len(), 1, "{named:?}");
    assert!(
        named[0].split(' ').any(|field| field == "cmd=evalsha"),
        "the takes ran on another connection: {}",
        named[0]
    );
}

#[tokio::test]
async fn spend_adds_the_whole_cost_or_none_of_it() {
    let adapter = adapter();
    let key = unique_key("spend");
    let config = RateLimitConfig {
        max_count: 10,
        window: Duration::from_secs(30),
    };

    assert_eq!(
        adapter
            .spend(key.clone(), config.clone(), 7)
            .await
            .unwrap()
            .unwrap(),
        7
    );

    // Four more would pass the limit: refused, and nothing is counted.
    let exceeded = adapter
        .spend(key.clone(), config.clone(), 4)
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(exceeded.current_count, 7);
    assert_eq!(exceeded.max_count, 10);
    assert!(!exceeded.retry_after.is_zero());
    assert!(exceeded.retry_after <= config.window);

    // Three still fit, and fill it exactly.
    assert_eq!(
        adapter
            .spend(key.clone(), config.clone(), 3)
            .await
            .unwrap()
            .unwrap(),
        10
    );
    assert!(adapter.spend(key, config, 1).await.unwrap().is_err());
}

#[tokio::test]
async fn a_spend_larger_than_the_limit_never_fits() {
    let adapter = adapter();
    let config = RateLimitConfig {
        max_count: 10,
        window: Duration::from_secs(30),
    };

    let exceeded = adapter
        .spend(unique_key("spend_too_large"), config.clone(), 11)
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(exceeded.current_count, 0);
    // No window is open yet, so the wait is a whole one.
    assert_eq!(exceeded.retry_after, config.window);
}
