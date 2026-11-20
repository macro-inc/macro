use std::sync::Mutex;
use std::time::Duration;

use macro_user_id::user_id::MacroUserId;
use rate_limit::{RateLimitKey, TokenBucketConfig, TokenBucketPort, TokenBucketResult};
use rootcause::Report;

use super::{AllowanceDraw, draw_api_key_search};

enum Answer {
    Bucket(TokenBucketResult),
    Down,
    Silent,
}

struct Buckets {
    answer: Answer,
    taken: Mutex<Vec<(String, TokenBucketConfig)>>,
}

impl Buckets {
    fn answering(answer: Answer) -> Self {
        Buckets {
            answer,
            taken: Mutex::new(Vec::new()),
        }
    }
}

impl TokenBucketPort for Buckets {
    async fn take(
        &self,
        key: RateLimitKey,
        config: TokenBucketConfig,
    ) -> Result<TokenBucketResult, Report> {
        self.taken
            .lock()
            .unwrap()
            .push((key.to_hex_string(), config));
        match self.answer {
            Answer::Bucket(result) => Ok(result),
            Answer::Down => {
                Err(Report::new(std::io::Error::other("connection refused")).into_dynamic())
            }
            Answer::Silent => std::future::pending().await,
        }
    }
}

#[tokio::test]
async fn every_api_key_of_one_account_draws_on_one_bucket_of_200_refilled_each_second() {
    let buckets = Buckets::answering(Answer::Bucket(TokenBucketResult::Taken { remaining: 7 }));
    let account = MacroUserId::parse_from_str("macro|ada@example.com")
        .unwrap()
        .lowercase();
    let same_account = MacroUserId::parse_from_str("macro|Ada@Example.com")
        .unwrap()
        .lowercase();
    let other_account = MacroUserId::parse_from_str("macro|grace@example.com")
        .unwrap()
        .lowercase();

    assert_eq!(
        draw_api_key_search(&buckets, &account).await,
        AllowanceDraw::Allowed { remaining: 7 }
    );
    draw_api_key_search(&buckets, &same_account).await;
    draw_api_key_search(&buckets, &other_account).await;

    let taken = buckets.taken.lock().unwrap();
    assert_eq!(taken[0].0, taken[1].0);
    assert_ne!(taken[0].0, taken[2].0);
    assert_eq!(
        taken[0].1,
        TokenBucketConfig {
            capacity: 200,
            refill_interval: Duration::from_secs(1),
        }
    );
}

#[tokio::test]
async fn an_empty_bucket_limits_the_search_until_its_next_token() {
    let buckets = Buckets::answering(Answer::Bucket(TokenBucketResult::Empty {
        retry_after: Duration::from_millis(400),
    }));
    let account = MacroUserId::parse_from_str("macro|ada@example.com")
        .unwrap()
        .lowercase();

    assert_eq!(
        draw_api_key_search(&buckets, &account).await,
        AllowanceDraw::Limited {
            retry_after: Duration::from_millis(400)
        }
    );
}

#[tokio::test]
async fn a_search_runs_when_its_bucket_cannot_be_read() {
    let buckets = Buckets::answering(Answer::Down);
    let account = MacroUserId::parse_from_str("macro|ada@example.com")
        .unwrap()
        .lowercase();

    assert_eq!(
        draw_api_key_search(&buckets, &account).await,
        AllowanceDraw::Unavailable
    );
}

#[tokio::test(start_paused = true)]
async fn a_search_waits_at_most_half_a_second_on_a_bucket_that_does_not_answer() {
    let buckets = Buckets::answering(Answer::Silent);
    let account = MacroUserId::parse_from_str("macro|ada@example.com")
        .unwrap()
        .lowercase();

    let started = tokio::time::Instant::now();
    let draw = draw_api_key_search(&buckets, &account).await;

    assert_eq!(draw, AllowanceDraw::Unavailable);
    assert_eq!(started.elapsed(), Duration::from_millis(500));
}
