use std::sync::Mutex;
use std::time::Duration;

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rate_limit::domain::models::{RateLimitOk, RateLimitResult};
use rate_limit::{RateBudgetPort, RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitPort};
use rootcause::Report;

use super::{HourlyAllowance, NOTIFICATIONS_PER_WINDOW, RECEIVES_PER_WINDOW, WINDOW};
use crate::ping::{AllowanceExceeded, SendAllowance};

/// A budget that counts in memory, one window that never ends.
#[derive(Default)]
struct CountingBudget {
    spent: Mutex<Vec<(String, u64)>>,
}

impl RateBudgetPort for CountingBudget {
    async fn spend(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
        cost: u64,
    ) -> Result<Result<u64, RateLimitExceeded>, Report> {
        assert_eq!(config.window, WINDOW);
        let mut spent = self.spent.lock().unwrap();
        let current: u64 = spent
            .iter()
            .filter(|(spender, _)| *spender == key.to_hex_string())
            .map(|(_, cost)| cost)
            .sum();
        if current + cost > config.max_count {
            return Ok(Err(RateLimitExceeded {
                current_count: current,
                max_count: config.max_count,
                retry_after: Duration::from_secs(25 * 60),
            }));
        }
        spent.push((key.to_hex_string(), cost));
        Ok(Ok(current + cost))
    }
}

impl RateLimitPort for CountingBudget {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        let current = self.spend(key.clone(), config.clone(), 1).await?;
        Ok(current.map(|count| RateLimitOk::new_testing_value(count, key, config)))
    }

    async fn decrement(&self, key: &RateLimitKey) -> Result<(), Report> {
        let mut spent = self.spent.lock().unwrap();
        let at = spent
            .iter()
            .position(|(spender, _)| *spender == key.to_hex_string())
            .expect("a count to give back");
        spent.remove(at);
        Ok(())
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

#[tokio::test]
async fn counts_each_recipient_against_the_senders_own_hour() {
    let allowance = HourlyAllowance(CountingBudget::default());
    let sender = user("macro|sender@macro.com");
    let other = user("macro|other@macro.com");

    assert_eq!(
        allowance
            .take(&sender, NOTIFICATIONS_PER_WINDOW - 1)
            .await
            .unwrap(),
        Ok(())
    );
    assert_eq!(allowance.take(&sender, 1).await.unwrap(), Ok(()));

    // Full: one more does not fit, and says when to try again.
    assert_eq!(
        allowance.take(&sender, 1).await.unwrap(),
        Err(AllowanceExceeded {
            limit: NOTIFICATIONS_PER_WINDOW,
            retry_after: Duration::from_secs(25 * 60),
        })
    );

    // Another sender has an allowance of their own.
    assert_eq!(allowance.take(&other, 100).await.unwrap(), Ok(()));
}

#[tokio::test]
async fn takes_nothing_when_the_whole_send_does_not_fit() {
    let allowance = HourlyAllowance(CountingBudget::default());
    let sender = user("macro|sender@macro.com");

    assert_eq!(
        allowance
            .take(&sender, NOTIFICATIONS_PER_WINDOW - 5)
            .await
            .unwrap(),
        Ok(())
    );
    assert!(allowance.take(&sender, 10).await.unwrap().is_err());
    // The refused ten were not counted, so five still fit.
    assert_eq!(allowance.take(&sender, 5).await.unwrap(), Ok(()));
}

#[tokio::test]
async fn caps_what_one_person_receives_from_every_sender_together() {
    let allowance = HourlyAllowance(CountingBudget::default());
    let (recipient, other) = (
        user("macro|recipient@macro.com"),
        user("macro|other@macro.com"),
    );

    for _ in 0..RECEIVES_PER_WINDOW {
        assert!(allowance.take_received(&recipient).await.unwrap());
    }
    assert!(!allowance.take_received(&recipient).await.unwrap());
    // Someone else has a cap of their own, apart from any sender's.
    assert!(allowance.take_received(&other).await.unwrap());

    // A count given back makes room for one more.
    allowance.give_back_received(&recipient).await.unwrap();
    assert!(allowance.take_received(&recipient).await.unwrap());
}

#[tokio::test]
async fn keeps_received_counts_apart_from_the_senders_allowance() {
    let allowance = HourlyAllowance(CountingBudget::default());
    let person = user("macro|person@macro.com");

    for _ in 0..RECEIVES_PER_WINDOW {
        assert!(allowance.take_received(&person).await.unwrap());
    }
    assert_eq!(
        allowance
            .take(&person, NOTIFICATIONS_PER_WINDOW)
            .await
            .unwrap(),
        Ok(())
    );
}
