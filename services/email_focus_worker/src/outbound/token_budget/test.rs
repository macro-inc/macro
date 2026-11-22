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
async fn background_calls_spend_at_the_rate_after_a_seconds_burst() {
    let budget = Arc::new(budget());
    // 600 calls of 10,000 tokens: 6M tokens, 1 s of it on hand at the start.
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
    // 480 calls at 1,250 tokens each is 10 s of the budget, less the second
    // on hand: 48 calls a second, inside TypeSafe's 80.
    let took = started.elapsed().as_secs_f64();
    assert!((8.5..=9.5).contains(&took), "took {took} s");
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
    // The budget went 120,000 below zero; the next background call waits
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
    // Three calls at the first estimate fit in the second on hand; the
    // fourth waits.
    let mut held = Vec::new();
    for _ in 0..3 {
        held.push(budget.reserve().await.0);
    }
    let waiting = budget.reserve();
    tokio::pin!(waiting);
    tokio::select! {
        biased;
        _ = &mut waiting => panic!("a fourth call went through with three out"),
        () = tokio::time::sleep(Duration::from_millis(1)) => {}
    }
    // A call that ends without spending (it was turned away before TypeSafe
    // billed it) gives its share back to the next.
    let before = Instant::now();
    held.pop();
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
    // so only two fit in the second on hand.
    budget.spend(30_000);
    tokio::time::advance(Duration::from_secs(1)).await;
    let first = budget.reserve().await;
    let second = budget.reserve().await;
    assert_eq!((first.1, second.1), (Duration::ZERO, Duration::ZERO));
    let third = budget.reserve();
    tokio::pin!(third);
    tokio::select! {
        biased;
        _ = &mut third => panic!("a third 30,000-token call fit in a 60,000-token second"),
        () = tokio::time::sleep(Duration::from_millis(1)) => {}
    }
    drop((first, second));
    third.await;

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
