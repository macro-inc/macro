use std::time::{Duration, Instant};

use super::{Activity, ActivitySettings, ActivityTracker};

const SAMPLE: Duration = Duration::from_secs(10);

/// Microseconds of CPU a computer uses over one sample at `cores`.
fn used(cores: f64) -> u64 {
    (SAMPLE.as_secs_f64() * cores * 1_000_000.0) as u64
}

/// Feed `samples` samples at `cores` each; returns the class after each.
fn run(
    tracker: &mut ActivityTracker,
    clock: &mut (Instant, u64),
    cores: f64,
    samples: u32,
) -> Vec<Activity> {
    let settings = ActivitySettings::default();
    (0..samples)
        .map(|_| {
            clock.0 += SAMPLE;
            clock.1 += used(cores);
            tracker.observe(clock.1, clock.0, &settings);
            tracker.activity()
        })
        .collect()
}

fn start() -> (ActivityTracker, (Instant, u64)) {
    let now = Instant::now();
    (ActivityTracker::new(0, now), (now, 0))
}

#[test]
fn a_started_computer_is_active_and_settles_to_idle_through_background() {
    let (mut tracker, mut clock) = start();
    assert_eq!(tracker.activity(), Activity::Active);

    // Idle macro-box: 0.037 cores.
    let classes = run(&mut tracker, &mut clock, 0.037, 60);
    assert_eq!(classes[4], Activity::Active, "lingers 60 s");
    assert_eq!(classes[5], Activity::Background);
    assert_eq!(classes[58], Activity::Background);
    assert_eq!(classes[59], Activity::Idle, "idle after 10 min");
}

#[test]
fn a_burst_lifts_an_idle_computer_at_once() {
    let (mut tracker, mut clock) = start();
    run(&mut tracker, &mut clock, 0.0, 60);
    assert_eq!(tracker.activity(), Activity::Idle);

    let classes = run(&mut tracker, &mut clock, 1.5, 1);
    assert_eq!(classes, vec![Activity::Active]);
    assert_eq!(tracker.quiet_for(clock.0), Duration::ZERO);
}

#[test]
fn busy_without_a_break_turns_background_and_a_pause_makes_it_active_again() {
    let (mut tracker, mut clock) = start();
    let classes = run(&mut tracker, &mut clock, 4.0, 13);
    assert_eq!(classes[11], Activity::Active, "110 s of a build");
    assert_eq!(classes[12], Activity::Background, "120 s: sustained");

    // A quiet sample ends the run; the next burst is interactive again.
    run(&mut tracker, &mut clock, 0.0, 1);
    let classes = run(&mut tracker, &mut clock, 0.8, 1);
    assert_eq!(classes, vec![Activity::Active]);
}

#[test]
fn typing_pauses_shorter_than_the_linger_keep_it_active() {
    let (mut tracker, mut clock) = start();
    for _ in 0..30 {
        run(&mut tracker, &mut clock, 0.6, 1);
        let classes = run(&mut tracker, &mut clock, 0.01, 4);
        assert!(classes.iter().all(|class| *class == Activity::Active));
    }
}

#[test]
fn a_counter_that_went_back_counts_as_no_use() {
    let (mut tracker, mut clock) = start();
    run(&mut tracker, &mut clock, 0.0, 60);
    let settings = ActivitySettings::default();
    clock.0 += SAMPLE;
    assert_eq!(tracker.observe(0, clock.0, &settings), None);
    assert_eq!(tracker.activity(), Activity::Idle);
}

#[test]
fn weights_follow_the_density_measurements() {
    assert_eq!(Activity::Active.cpu_weight(), 1000);
    assert_eq!(Activity::Background.cpu_weight(), 100);
    assert_eq!(Activity::Idle.cpu_weight(), 20);
}
