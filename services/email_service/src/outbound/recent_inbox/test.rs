use std::cell::Cell;

use email_api_client::domain::models::{MessageWithCalendarParts, RateLimitOrigin};

use super::*;

type Read = std::future::Ready<Result<Option<MessageWithCalendarParts>, EmailApiError>>;

/// A read refused `refusals` times, each asking for `retry_after` seconds,
/// then answered; it counts its tries.
fn read(tries: &Cell<u32>, refusals: u32, retry_after: Option<u64>) -> impl FnMut() -> Read + '_ {
    move || {
        tries.set(tries.get() + 1);
        std::future::ready(if tries.get() <= refusals {
            Err(EmailApiError::RateLimited {
                retry_after: retry_after.map(Duration::from_secs),
                origin: RateLimitOrigin::Local,
            })
        } else {
            Ok(None)
        })
    }
}

#[tokio::test(start_paused = true)]
async fn a_window_read_waits_out_refusals_until_its_deadline() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer =
        wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), read(&tries, 3, Some(10))).await;

    assert!(matches!(answer, Ok(None)));
    assert_eq!(tries.get(), 4);
    assert_eq!(started.elapsed(), Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn a_refusal_without_a_wait_retries_after_a_second() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), read(&tries, 2, None)).await;

    assert!(matches!(answer, Ok(None)));
    assert_eq!(started.elapsed(), GMAIL_REFUSED_RETRY * 2);
}

#[tokio::test(start_paused = true)]
async fn a_wait_past_the_deadline_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    // Four waits of 10 s fit in 45; the fifth would not.
    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 10, Some(10)),
    )
    .await;

    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited {
            retry_after: Some(wait),
            ..
        }) if wait == Duration::from_secs(10)
    ));
    assert_eq!(tries.get(), 5);
    assert_eq!(started.elapsed(), Duration::from_secs(40));
}

#[tokio::test(start_paused = true)]
async fn a_read_not_started_by_its_deadline_is_left_out_untried() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(Some(started), read(&tries, 0, None)).await;

    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local
        })
    ));
    assert_eq!(tries.get(), 0);
}

#[tokio::test(start_paused = true)]
async fn a_read_still_running_at_its_deadline_is_cut_off() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(Some(started + GMAIL_WINDOW_WAIT), || {
        tries.set(tries.get() + 1);
        async {
            tokio::time::sleep(Duration::from_secs(60)).await;
            Ok::<_, EmailApiError>(None::<MessageWithCalendarParts>)
        }
    })
    .await;

    assert!(matches!(
        answer,
        Err(EmailApiError::RateLimited {
            retry_after: None,
            origin: RateLimitOrigin::Local
        })
    ));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), GMAIL_WINDOW_WAIT);
}

#[tokio::test(start_paused = true)]
async fn a_wait_that_reaches_the_deadline_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    // A wait of the whole window would wake with nothing left to try in.
    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 1, Some(GMAIL_WINDOW_WAIT.as_secs())),
    )
    .await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn an_oversized_wait_is_the_answer() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(
        Some(started + GMAIL_WINDOW_WAIT),
        read(&tries, 1, Some(u64::MAX)),
    )
    .await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}

#[tokio::test(start_paused = true)]
async fn the_newest_few_are_refused_at_once() {
    let tries = Cell::new(0);
    let started = Instant::now();

    let answer = wait_out_refusals(None, read(&tries, 1, Some(1))).await;

    assert!(matches!(answer, Err(EmailApiError::RateLimited { .. })));
    assert_eq!(tries.get(), 1);
    assert_eq!(started.elapsed(), Duration::ZERO);
}
