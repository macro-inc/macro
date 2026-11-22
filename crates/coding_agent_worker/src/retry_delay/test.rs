use super::*;

const MS: Duration = Duration::from_millis(1);

#[test]
fn delays_double_from_the_first_to_the_cap() {
    let mut delays = RetryDelays::new(250 * MS, Duration::from_secs(30));
    let schedule: Vec<Duration> = (0..10).map(|_| delays.next_unjittered()).collect();
    assert_eq!(
        schedule,
        [
            250 * MS,
            500 * MS,
            1_000 * MS,
            2_000 * MS,
            4_000 * MS,
            8_000 * MS,
            16_000 * MS,
            30_000 * MS,
            30_000 * MS,
            30_000 * MS,
        ]
    );
    delays.reset();
    assert_eq!(delays.next_unjittered(), 250 * MS);
}

#[test]
fn a_fixed_interval_never_grows() {
    let mut delays = RetryDelays::every(250 * MS);
    for _ in 0..5 {
        assert_eq!(delays.next_unjittered(), 250 * MS);
    }
}

#[test]
fn jitter_spreads_a_delay_a_quarter_either_way() {
    assert_eq!(jitter(400 * MS, 0.0), 300 * MS);
    assert_eq!(jitter(400 * MS, 0.5), 400 * MS);
    assert!(jitter(400 * MS, 0.999_999) < 500 * MS);
    assert!(jitter(400 * MS, 0.999_999) > 499 * MS);
}

#[test]
fn jittered_delays_stay_in_bounds_and_differ() {
    let mut delays = RetryDelays::every(250 * MS);
    let drawn: Vec<Duration> = (0..50).map(|_| delays.next_delay()).collect();
    assert!(
        drawn
            .iter()
            .all(|delay| (187 * MS..=313 * MS).contains(delay)),
        "{drawn:?}"
    );
    assert!(
        drawn.iter().any(|delay| *delay != drawn[0]),
        "50 jittered delays were all {:?}",
        drawn[0]
    );
}
