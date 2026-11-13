use std::time::Duration;

use super::RedisConcurrencyLimitAdapter;
use crate::domain::models::{ConcurrencyLease, ConcurrencyLimitConfig, RateLimitKey};
use crate::domain::ports::ConcurrencyLimitPort;

fn adapter() -> RedisConcurrencyLimitAdapter {
    let url = macro_env_var::maybe_read_env("REDIS_URL")
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    RedisConcurrencyLimitAdapter {
        redis: redis::Client::open(url).expect("failed to create Redis client"),
    }
}

fn unique_key(name: &str) -> RateLimitKey {
    RateLimitKey::builder(&format!("test_{name}_{}", uuid::Uuid::new_v4())).finish()
}

const TWO_HOLDERS: ConcurrencyLimitConfig = ConcurrencyLimitConfig {
    max_holders: 2,
    lease: Duration::from_secs(60),
};

#[tokio::test]
async fn a_third_holder_is_refused_until_one_releases() {
    let limiter = adapter();
    let key = unique_key("third_holder");

    assert_eq!(
        limiter.acquire(&key, "a", TWO_HOLDERS).await.unwrap(),
        ConcurrencyLease::Held
    );
    assert_eq!(
        limiter.acquire(&key, "b", TWO_HOLDERS).await.unwrap(),
        ConcurrencyLease::Held
    );
    assert_eq!(
        limiter.acquire(&key, "c", TWO_HOLDERS).await.unwrap(),
        ConcurrencyLease::Exceeded {
            current: 2,
            max_holders: 2
        }
    );

    limiter.release(&key, "a").await.unwrap();

    assert_eq!(
        limiter.acquire(&key, "c", TWO_HOLDERS).await.unwrap(),
        ConcurrencyLease::Held
    );
}

#[tokio::test]
async fn a_holder_renewing_at_the_limit_is_never_refused() {
    let limiter = adapter();
    let key = unique_key("renew");

    limiter.acquire(&key, "a", TWO_HOLDERS).await.unwrap();
    limiter.acquire(&key, "b", TWO_HOLDERS).await.unwrap();

    assert_eq!(
        limiter.acquire(&key, "b", TWO_HOLDERS).await.unwrap(),
        ConcurrencyLease::Held
    );
}

#[tokio::test]
async fn a_lapsed_lease_stops_counting() {
    let limiter = adapter();
    let key = unique_key("lapsed");
    let one_holder = ConcurrencyLimitConfig {
        max_holders: 1,
        lease: Duration::from_secs(60),
    };
    // A holder that died: its lease lapsed at the epoch.
    let mut connection = limiter
        .redis
        .get_multiplexed_async_connection()
        .await
        .unwrap();
    let _: i64 = redis::cmd("ZADD")
        .arg(super::redis_key(&key))
        .arg(0)
        .arg("dead")
        .query_async(&mut connection)
        .await
        .unwrap();

    assert_eq!(
        limiter.acquire(&key, "alive", one_holder).await.unwrap(),
        ConcurrencyLease::Held
    );
}
