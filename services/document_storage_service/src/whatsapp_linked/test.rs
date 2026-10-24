use super::*;
use rate_limit::outbound::redis::RedisRateLimitOps;
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

#[derive(Clone, Default)]
struct Counter {
    now: Arc<AtomicU64>,
    windows: Arc<Mutex<HashMap<String, u64>>>,
}

impl RedisRateLimitOps for Counter {
    async fn check_and_increment(
        &self,
        key: &str,
        max_count: u64,
        expiry_seconds: u64,
    ) -> Result<(bool, u64, Option<u64>), rootcause::Report> {
        assert_eq!((max_count, expiry_seconds), (1, 1));
        let now = self.now.load(Ordering::Relaxed);
        let mut windows = self.windows.lock().unwrap();
        if windows.get(key).is_some_and(|expires| *expires > now) {
            return Ok((false, 1, Some(1)));
        }
        windows.insert(key.to_owned(), now + expiry_seconds);
        Ok((true, 1, None))
    }

    async fn decrement(&self, _: &str) -> Result<(), rootcause::Report> {
        panic!("send requests must not refund their request budget")
    }
}

fn limiter(counter: Counter) -> impl SendRateLimiter {
    SendRequestLimiter(rate_limit::RateLimitServiceImpl {
        repo: rate_limit::RedisRateLimitAdapter { redis: counter },
    })
}

#[tokio::test]
async fn a_users_budget_is_shared_across_replicas_and_recovers_after_one_second() {
    let counter = Counter::default();
    let first_replica = limiter(counter.clone());
    let second_replica = limiter(counter.clone());
    let (first, second) = tokio::join!(first_replica.check("alice"), second_replica.check("alice"));
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    let denied = first.err().or_else(|| second.err()).unwrap();
    assert_eq!(denied.current_context(), &LinkedError::RateLimited);
    second_replica.check("bob").await.unwrap();
    assert_eq!(counter.windows.lock().unwrap().len(), 2);
    counter.now.store(1, Ordering::Relaxed);
    second_replica.check("alice").await.unwrap();
}

struct Unavailable;

impl RedisRateLimitOps for Unavailable {
    async fn check_and_increment(
        &self,
        _: &str,
        _: u64,
        _: u64,
    ) -> Result<(bool, u64, Option<u64>), rootcause::Report> {
        Err(rootcause::report!("counter unavailable"))
    }

    async fn decrement(&self, _: &str) -> Result<(), rootcause::Report> {
        panic!("no ticket exists")
    }
}

#[tokio::test]
async fn unavailable_shared_counter_fails_closed() {
    let limiter = SendRequestLimiter(rate_limit::RateLimitServiceImpl {
        repo: rate_limit::RedisRateLimitAdapter { redis: Unavailable },
    });
    assert_eq!(
        limiter.check("alice").await.unwrap_err().current_context(),
        &LinkedError::Unavailable
    );
}

#[tokio::test]
async fn redis_enforces_the_shared_budget_without_affecting_another_user() {
    // Unique, expiring keys on the local test server; never clear shared Redis.
    let redis = redis::Client::open("redis://127.0.0.1:6379/").unwrap();
    let first = SendRequestLimiter(rate_limit::RateLimitServiceImpl {
        repo: rate_limit::RedisRateLimitAdapter {
            redis: redis.clone(),
        },
    });
    let second = SendRequestLimiter(rate_limit::RateLimitServiceImpl {
        repo: rate_limit::RedisRateLimitAdapter { redis },
    });
    let alice = format!("whatsapp-rate-test-{}", uuid::Uuid::now_v7());
    let bob = format!("whatsapp-rate-test-{}", uuid::Uuid::now_v7());
    let (one, two, other) = tokio::join!(
        first.check(&alice),
        second.check(&alice),
        second.check(&bob)
    );
    assert_eq!(usize::from(one.is_ok()) + usize::from(two.is_ok()), 1);
    assert_eq!(
        one.err().or_else(|| two.err()).unwrap().current_context(),
        &LinkedError::RateLimited
    );
    other.unwrap();
}
