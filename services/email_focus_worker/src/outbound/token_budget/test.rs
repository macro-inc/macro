use std::{sync::Arc, time::Duration};

use tokio::time::Instant;

use super::*;

const CALL: u64 = 10_000;

fn budget() -> TokenBudget {
    TokenBudget::new(Rates::default())
}

/// Runs `calls` background calls `at_once` at a time, each costing `CALL`
/// and taking `takes`; answers how long they took in all.
async fn background(
    budget: &Arc<TokenBudget>,
    calls: usize,
    at_once: usize,
    takes: Duration,
) -> Duration {
    use futures::StreamExt as _;
    let started = Instant::now();
    futures::stream::iter(0..calls)
        .for_each_concurrent(at_once, |_| {
            let budget = Arc::clone(budget);
            async move {
                let (reservation, _) = budget.reserve().await;
                tokio::time::sleep(takes).await;
                budget.spend(CALL);
                drop(reservation);
            }
        })
        .await;
    started.elapsed()
}

#[tokio::test(start_paused = true)]
async fn background_calls_spend_at_the_rate() {
    let budget = Arc::new(budget());
    // 600 calls of 10,000 tokens: 6M tokens, half a second of it on hand at
    // the start.
    let took = background(&budget, 600, 16, Duration::from_millis(500)).await;
    let rate = 600.0 * 10_000.0 / took.as_secs_f64();
    assert!(
        rate <= TOKENS_PER_SECOND * 1.02,
        "spent {rate} tokens a second"
    );
    assert!(
        rate >= TOKENS_PER_SECOND * 0.95,
        "spent only {rate} tokens a second"
    );
}

#[tokio::test(start_paused = true)]
async fn every_call_costs_at_least_a_requests_share() {
    let budget = Arc::new(budget());
    let started = Instant::now();
    for _ in 0..480 {
        let (reservation, _) = budget.reserve().await;
        budget.spend(10);
        drop(reservation);
    }
    // 480 calls at 1,250 tokens each is 10 s of the budget, less the half
    // second on hand: 48 calls a second, inside TypeSafe's 80.
    let took = started.elapsed().as_secs_f64();
    assert!((9.0..=10.0).contains(&took), "took {took} s");
}

#[tokio::test(start_paused = true)]
async fn a_quiet_spell_lets_through_no_more_than_typesafe_allows_in_a_second() {
    let budget = Arc::new(budget());
    // Short calls bring the estimate down to a request's share.
    for _ in 0..40 {
        let (reservation, _) = budget.reserve().await;
        budget.spend(10);
        drop(reservation);
    }
    tokio::time::advance(Duration::from_secs(60)).await;
    // Then as many short calls as fit in the next second, all at once.
    let started = Instant::now();
    let mut calls = 0_u32;
    while started.elapsed() < Duration::from_secs(1) {
        let (reservation, _) = budget.reserve().await;
        budget.spend(10);
        drop(reservation);
        calls += 1;
    }
    // Half a second on hand and a second's refill: 72 requests, and
    // 90,000 tokens at most for calls of any size.
    assert!(
        calls <= 73,
        "{calls} calls in the second after a quiet spell"
    );
}

#[tokio::test(start_paused = true)]
async fn live_calls_never_wait_and_background_calls_wait_for_what_they_spent() {
    let budget = budget();
    let started = Instant::now();
    // Live mail spends three seconds' worth at once, and nothing waits on it.
    for _ in 0..18 {
        budget.spend(CALL);
    }
    assert_eq!(started.elapsed(), Duration::ZERO);
    // The budget went 150,000 below zero; the next background call waits
    // until it holds a call's estimate again.
    let (_reservation, waited) = budget.reserve().await;
    assert!(
        waited >= Duration::from_secs(2),
        "waited only {waited:?} behind live mail"
    );
    assert!(waited <= Duration::from_secs(3), "waited {waited:?}");
}

#[tokio::test(start_paused = true)]
async fn a_given_back_reservation_lets_the_next_call_through_at_once() {
    let budget = budget();
    // One call at the first estimate fits in the half second on hand; the
    // second waits.
    let held = budget.reserve().await.0;
    let waiting = budget.reserve();
    tokio::pin!(waiting);
    tokio::select! {
        biased;
        _ = &mut waiting => panic!("a second call went through with one out"),
        () = tokio::time::sleep(Duration::from_millis(1)) => {}
    }
    // A call that ends without spending gives its share back to the next.
    let before = Instant::now();
    drop(held);
    let (_reservation, _) = waiting.await;
    assert!(
        before.elapsed() < Duration::from_millis(10),
        "the next call waited {:?} for the refill",
        before.elapsed()
    );
}

#[tokio::test(start_paused = true)]
async fn a_dearer_call_raises_the_estimate_at_once_and_cheaper_ones_lower_it_slowly() {
    let budget = budget();
    // Long threads: the next background call sets aside what the last cost,
    // so only one fits in the half second on hand.
    budget.spend(30_000);
    tokio::time::advance(Duration::from_secs(1)).await;
    let first = budget.reserve().await;
    assert_eq!(first.1, Duration::ZERO);
    let second = budget.reserve();
    tokio::pin!(second);
    tokio::select! {
        biased;
        _ = &mut second => panic!("a second 30,000-token call fit in a 30,000-token half second"),
        () = tokio::time::sleep(Duration::from_millis(1)) => {}
    }
    drop(first);
    second.await;

    // Short ones bring it down a fifth of the way each.
    budget.spend(5_000);
    assert_eq!(budget.state().estimate, 25_000.0);
}

#[tokio::test(start_paused = true)]
async fn a_push_back_halves_the_rate_once_per_cool_down_and_it_climbs_back() {
    let budget = budget();
    assert!(budget.slow_down());
    assert_eq!(budget.rate(), TOKENS_PER_SECOND / 2.0);
    // The other calls out when TypeSafe pushed back count as the same push.
    assert!(!budget.slow_down());
    assert_eq!(budget.rate(), TOKENS_PER_SECOND / 2.0);

    tokio::time::advance(COOL_DOWN).await;
    assert_eq!(budget.rate(), 36_000.0, "climbs a tenth after a cool-down");
    assert!(
        budget.slow_down(),
        "a push after the cool-down counts again"
    );
    assert_eq!(budget.rate(), 18_000.0);

    tokio::time::advance(COOL_DOWN * 2).await;
    assert_eq!(budget.rate(), 30_000.0);
    tokio::time::advance(COOL_DOWN * 10).await;
    assert_eq!(
        budget.rate(),
        TOKENS_PER_SECOND,
        "never above the full rate"
    );
}

#[tokio::test(start_paused = true)]
async fn the_rate_never_falls_below_its_floor() {
    let budget = TokenBudget::new(Rates {
        min: 20_000.0,
        ..Rates::default()
    });
    assert!(budget.slow_down());
    tokio::time::advance(COOL_DOWN).await;
    assert!(budget.slow_down());
    assert_eq!(budget.rate(), 20_000.0, "36,000 halved stops at the floor");
}

#[tokio::test(start_paused = true)]
async fn a_push_back_pauses_background_calls_and_slows_them_after() {
    let budget = Arc::new(budget());
    budget.slow_down();
    // The balance was emptied: the next call waits for its estimate at the
    // halved rate.
    let (reservation, waited) = budget.reserve().await;
    drop(reservation);
    assert!(waited >= Duration::from_millis(300), "waited {waited:?}");
    // And calls run at half the rate until the cool-down ends: 300,000
    // tokens, less the share the first call gave back, at 30,000 a second.
    let took = background(&budget, 30, 16, Duration::from_millis(100)).await;
    assert!(
        took >= Duration::from_secs(9),
        "spent 300,000 tokens in {took:?} after the push"
    );
    assert!(took <= Duration::from_secs(11), "took {took:?}");
}

#[tokio::test(start_paused = true)]
async fn a_call_dearer_than_a_seconds_worth_still_gets_through_when_slowed() {
    let budget = budget();
    // Long threads at 30,000 tokens a call, and two pushes back: 18,000 a
    // second, less than one call.
    budget.spend(30_000);
    assert!(budget.slow_down());
    tokio::time::advance(COOL_DOWN).await;
    assert!(budget.slow_down());
    assert_eq!(budget.rate(), 18_000.0);
    let (_reservation, waited) = budget.reserve().await;
    // Under two seconds of refill, not never.
    assert!(waited <= Duration::from_secs(2), "waited {waited:?}");
}

#[tokio::test(start_paused = true)]
async fn a_push_back_within_the_cool_down_puts_off_the_climb() {
    let budget = budget();
    assert!(budget.slow_down());
    tokio::time::advance(Duration::from_secs(29)).await;
    // Still being pushed back a second before the climb: no second halving,
    // and no climb for another cool-down.
    assert!(!budget.slow_down());
    tokio::time::advance(Duration::from_secs(2)).await;
    assert_eq!(budget.rate(), TOKENS_PER_SECOND / 2.0);
    tokio::time::advance(Duration::from_secs(28)).await;
    assert_eq!(budget.rate(), 36_000.0);
}

#[tokio::test(start_paused = true)]
async fn a_climb_refills_at_the_new_rate_only_from_when_it_came() {
    let budget = budget();
    assert!(budget.slow_down());
    // Live mail ran the budget deep into debt.
    budget.spend(2_000_000);
    tokio::time::advance(Duration::from_secs(40)).await;
    budget.rate();
    // 30 s at 30,000 a second, then 10 s at 36,000.
    let balance = budget.state().balance;
    assert!(
        (balance - -740_000.0).abs() < 1.0,
        "balance {balance} after the climb"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_call_keeps_its_share_after_a_push_back() {
    let budget = budget();
    let (failed, _) = budget.reserve().await;
    assert!(budget.slow_down());
    failed.keep();
    // The failed call's 20,000 tokens aren't handed to the next call: it
    // waits for them to refill at the halved rate.
    let (_reservation, waited) = budget.reserve().await;
    assert!(
        waited >= Duration::from_millis(600),
        "the next call waited only {waited:?}"
    );
}
