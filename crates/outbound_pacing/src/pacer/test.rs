use std::{cell::Cell, convert::Infallible, num::NonZeroU32, time::Duration};

use tokio::time::Instant;

use super::{Answer, PaceError, Pacer, PacingConfig, Throttled};

fn pacer(per_minute: u32, burst: u32) -> Pacer<&'static str> {
    Pacer::new(PacingConfig {
        per_minute: NonZeroU32::new(per_minute).unwrap(),
        burst: NonZeroU32::new(burst).unwrap(),
        max_hold: Duration::from_secs(1),
        unnamed_wait: Duration::from_secs(60),
    })
}

async fn accepted() -> Result<Answer<&'static str>, Infallible> {
    Ok(Answer::Accepted("ok"))
}

#[tokio::test(start_paused = true)]
async fn calls_past_the_burst_wait_for_their_turn() {
    // One a second, two at once.
    let pacer = pacer(60, 2);
    let start = Instant::now();

    pacer.call(&"token", accepted).await.unwrap();
    pacer.call(&"token", accepted).await.unwrap();
    assert_eq!(start.elapsed(), Duration::ZERO);

    pacer.call(&"token", accepted).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(1));
}

#[tokio::test(start_paused = true)]
async fn a_turn_past_the_hold_fails_with_its_wait() {
    // One every two seconds; the hold is one.
    let pacer = pacer(30, 1);
    pacer.call(&"token", accepted).await.unwrap();
    let attempts = Cell::new(0);

    let result = pacer
        .call(&"token", || {
            attempts.set(attempts.get() + 1);
            accepted()
        })
        .await;

    assert_eq!(
        result,
        Err(PaceError::Throttled(Throttled {
            retry_after: Some(Duration::from_secs(2)),
        }))
    );
    assert_eq!(attempts.get(), 0);
    // Another key has its own turns.
    pacer.call(&"other token", accepted).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_blocked_key_fails_fast_until_the_block_lifts() {
    let pacer = pacer(600, 10);
    pacer.block(&"token", Duration::from_secs(60));
    let attempts = Cell::new(0);
    let attempt = || {
        attempts.set(attempts.get() + 1);
        accepted()
    };

    let result = pacer.call(&"token", attempt).await;

    assert_eq!(
        result,
        Err(PaceError::Throttled(Throttled {
            retry_after: Some(Duration::from_secs(60)),
        }))
    );
    assert_eq!(attempts.get(), 0);
    pacer.call(&"other token", accepted).await.unwrap();

    tokio::time::advance(Duration::from_secs(60)).await;
    pacer.call(&"token", attempt).await.unwrap();
    assert_eq!(attempts.get(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_block_inside_the_hold_is_waited_out() {
    let pacer = pacer(600, 10);
    pacer.block(&"token", Duration::from_millis(800));
    let start = Instant::now();

    pacer.call(&"token", accepted).await.unwrap();

    assert_eq!(start.elapsed(), Duration::from_millis(800));
}

#[tokio::test(start_paused = true)]
async fn a_throttled_answer_inside_the_hold_is_retried_once() {
    let pacer = pacer(600, 10);
    let attempts = Cell::new(0);
    let start = Instant::now();

    let result = pacer
        .call(&"token", || {
            attempts.set(attempts.get() + 1);
            let first = attempts.get() == 1;
            async move {
                Ok::<_, Infallible>(if first {
                    Answer::Throttled {
                        retry_after: Some(Duration::from_secs(1)),
                    }
                } else {
                    Answer::Accepted("ok")
                })
            }
        })
        .await;

    assert_eq!(result, Ok("ok"));
    assert_eq!(attempts.get(), 2);
    assert_eq!(start.elapsed(), Duration::from_secs(1));
}

#[tokio::test(start_paused = true)]
async fn a_throttled_answer_past_the_hold_fails_and_blocks_the_key() {
    let pacer = pacer(600, 10);
    let attempts = Cell::new(0);
    let throttled = || {
        attempts.set(attempts.get() + 1);
        async {
            Ok::<Answer<&str>, Infallible>(Answer::Throttled {
                retry_after: Some(Duration::from_secs(600)),
            })
        }
    };

    let first = pacer.call(&"token", throttled).await;
    let second = pacer.call(&"token", throttled).await;

    assert_eq!(
        first,
        Err(PaceError::Throttled(Throttled {
            retry_after: Some(Duration::from_secs(600)),
        }))
    );
    assert_eq!(
        second,
        Err(PaceError::Throttled(Throttled {
            retry_after: Some(Duration::from_secs(600)),
        }))
    );
    assert_eq!(attempts.get(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_throttled_answer_without_a_wait_blocks_for_the_unnamed_wait() {
    let pacer = pacer(600, 10);
    let unnamed =
        || async { Ok::<Answer<&str>, Infallible>(Answer::Throttled { retry_after: None }) };

    let first = pacer.call(&"token", unnamed).await;
    let second = pacer.call(&"token", accepted).await;

    assert_eq!(
        first,
        Err(PaceError::Throttled(Throttled { retry_after: None }))
    );
    assert_eq!(
        second,
        Err(PaceError::Throttled(Throttled {
            retry_after: Some(Duration::from_secs(60)),
        }))
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_attempt_is_returned_as_it_failed() {
    let pacer = pacer(600, 10);

    let result = pacer
        .call(&"token", || async { Err::<Answer<()>, _>("unreachable") })
        .await;

    assert_eq!(result, Err(PaceError::Failed("unreachable")));
}
