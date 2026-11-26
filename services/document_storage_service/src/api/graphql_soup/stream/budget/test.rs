use super::*;
use rate_limit::RateLimitExceeded;
use rootcause::Report;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Counters held in memory, as Redis holds them: a spend adds its whole cost
/// or nothing. `down` makes every spend fail, as Redis being unreachable does.
#[derive(Clone, Default)]
struct Counters {
    counts: Arc<Mutex<HashMap<Vec<u8>, u64>>>,
    down: Arc<Mutex<bool>>,
    /// Every spend takes this long.
    delay: Duration,
}

impl RateBudgetPort for Counters {
    async fn spend(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
        cost: u64,
    ) -> Result<Result<u64, RateLimitExceeded>, Report> {
        tokio::time::sleep(self.delay).await;
        if *self.down.lock().unwrap() {
            return Err(rootcause::report!("redis unavailable"));
        }
        let mut counts = self.counts.lock().unwrap();
        let count = counts.entry(key.as_bytes().to_vec()).or_default();
        if *count + cost > config.max_count {
            return Ok(Err(RateLimitExceeded {
                current_count: *count,
                max_count: config.max_count,
                retry_after: config.window,
            }));
        }
        *count += cost;
        Ok(Ok(*count))
    }
}

const USER: &str = "user@example.com";

#[tokio::test]
async fn a_user_may_start_ten_streams_a_minute() {
    let budget = SyncStreamBudget::new(Counters::default());
    for _ in 0..STARTS_PER_MINUTE {
        assert_eq!(budget.admit(USER).await, Admission::Admitted);
    }
    assert_eq!(
        budget.admit(USER).await,
        Admission::Refused {
            retry_after: Duration::from_secs(60)
        }
    );
    // Another user's budget is their own.
    assert_eq!(budget.admit("other@example.com").await, Admission::Admitted);
}

#[tokio::test]
async fn a_page_past_the_hours_page_time_ends_the_stream_and_refuses_the_next() {
    let budget = SyncStreamBudget::new(Counters::default());
    assert_eq!(budget.admit(USER).await, Admission::Admitted);
    assert_eq!(
        budget.charge(USER, Duration::from_secs(29 * 60)).await,
        Charge::Charged
    );
    // Two minutes do not fit in the minute left: the stream ends.
    assert_eq!(
        budget.charge(USER, Duration::from_secs(2 * 60)).await,
        Charge::Spent
    );
    // The page took what was left, so no stream starts until the hour ends.
    assert_eq!(
        budget.admit(USER).await,
        Admission::Refused {
            retry_after: Duration::from_secs(60 * 60)
        }
    );
}

#[tokio::test]
async fn streams_run_when_the_budget_cannot_be_read() {
    let counters = Counters::default();
    *counters.down.lock().unwrap() = true;
    let budget = SyncStreamBudget::new(counters);
    for _ in 0..=STARTS_PER_MINUTE {
        assert_eq!(budget.admit(USER).await, Admission::Admitted);
    }
    assert_eq!(
        budget.charge(USER, Duration::from_secs(60 * 60)).await,
        Charge::Unavailable
    );
}

#[tokio::test(start_paused = true)]
async fn a_slow_store_lets_the_stream_run_without_holding_it() {
    let budget = SyncStreamBudget::new(Counters {
        delay: Duration::from_secs(5),
        ..Counters::default()
    });
    let started = tokio::time::Instant::now();
    assert_eq!(budget.admit(USER).await, Admission::Admitted);
    assert_eq!(
        budget.charge(USER, Duration::from_secs(1)).await,
        Charge::Unavailable
    );
    // Each answer waits at most `STORE_TIMEOUT`.
    assert!(started.elapsed() <= STORE_TIMEOUT * 2);
}

#[tokio::test]
async fn a_start_spends_almost_none_of_the_page_time() {
    let budget = SyncStreamBudget::new(Counters::default());
    for _ in 0..STARTS_PER_MINUTE {
        assert_eq!(budget.admit(USER).await, Admission::Admitted);
    }
    // Ten starts leave the hour's page time whole but for 10 ms.
    assert_eq!(
        budget
            .charge(USER, Duration::from_millis(PAGE_MS_PER_HOUR - 10))
            .await,
        Charge::Charged
    );
}
