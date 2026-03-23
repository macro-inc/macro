use std::time::Duration;

use crate::{
    RateLimitConfig, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::ports::RateLimitService, outbound::redis::RedisRateLimitAdapter,
};

fn redis_client() -> redis::Client {
    let url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    redis::Client::open(url).expect("failed to create Redis client")
}

fn unique_key(name: &str) -> RateLimitKey {
    RateLimitKey::builder(&format!("test_{name}_{}", uuid::Uuid::new_v4())).finish()
}

fn service() -> RateLimitServiceImpl<RedisRateLimitAdapter<redis::Client>> {
    RateLimitServiceImpl {
        repo: RedisRateLimitAdapter {
            redis: redis_client(),
        },
    }
}

#[tokio::test]
async fn retry_after_is_populated_when_rate_limit_exceeded() {
    let svc = service();
    let key = unique_key("retry_after");
    let config = RateLimitConfig {
        max_count: 1,
        window: Duration::from_secs(30),
    };

    // First request succeeds and increments the counter.
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .expect("check_rate_limit failed");
    assert!(matches!(&*ticket, RateLimitResult::Allowed { .. }));
    svc.increment_ticket(ticket)
        .await
        .expect("increment_ticket failed");

    // Second request should be exceeded.
    let ticket = svc
        .check_rate_limit(key, config.clone())
        .await
        .expect("check_rate_limit failed");

    match &*ticket {
        RateLimitResult::Exceeded(exceeded) => {
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
        RateLimitResult::Allowed { .. } => {
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

    // Exhaust the rate limit.
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    svc.increment_ticket(ticket).await.unwrap();

    // Check immediately.
    let ticket = svc
        .check_rate_limit(key.clone(), config.clone())
        .await
        .unwrap();
    let first_retry_after = match &*ticket {
        RateLimitResult::Exceeded(e) => e.retry_after,
        _ => panic!("expected exceeded"),
    };

    // Wait a bit then check again.
    tokio::time::sleep(Duration::from_secs(2)).await;

    let ticket = svc.check_rate_limit(key, config).await.unwrap();
    let second_retry_after = match &*ticket {
        RateLimitResult::Exceeded(e) => e.retry_after,
        _ => panic!("expected exceeded"),
    };

    assert!(
        second_retry_after < first_retry_after,
        "retry_after should decrease over time: first={first_retry_after:?}, second={second_retry_after:?}",
    );
}
