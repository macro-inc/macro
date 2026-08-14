use super::*;

#[tokio::test(start_paused = true)]
async fn fires_in_deadline_order_regardless_of_arm_order() {
    let mut wheel = TimerWheel::new();
    wheel.arm(TimerToken(1), 5_000);
    wheel.arm(TimerToken(2), 1_000);
    wheel.arm(TimerToken(3), 3_000);

    assert_eq!(wheel.fired().await, TimerToken(2));
    assert_eq!(wheel.fired().await, TimerToken(3));
    assert_eq!(wheel.fired().await, TimerToken(1));
}

#[tokio::test(start_paused = true)]
async fn pends_while_empty_instead_of_firing() {
    let mut wheel = TimerWheel::new();
    let raced = tokio::select! {
        token = wheel.fired() => Some(token),
        _ = tokio::time::sleep(Duration::from_secs(3600)) => None,
    };
    assert_eq!(raced, None);
}

#[tokio::test(start_paused = true)]
async fn cancelled_wait_leaves_the_timer_armed() {
    let mut wheel = TimerWheel::new();
    wheel.arm(TimerToken(7), 2_000);

    // A racing branch wins before the deadline; the timer must survive.
    tokio::select! {
        _ = wheel.fired() => panic!("not due yet"),
        _ = tokio::time::sleep(Duration::from_millis(500)) => {}
    }
    assert_eq!(wheel.fired().await, TimerToken(7));
}
