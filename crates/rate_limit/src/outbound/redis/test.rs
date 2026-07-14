use std::time::Duration;

use crate::{
    RateLimitConfig, RateLimitKey, RateLimitPort, RateLimitResult, RateLimitServiceImpl,
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
