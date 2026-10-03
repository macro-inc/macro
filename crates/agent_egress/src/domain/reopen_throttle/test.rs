use super::*;

fn session(n: u128) -> AgentSessionId {
    AgentSessionId::new_from_uuid(uuid::Uuid::from_u128(n))
}

#[test]
fn opens_within_the_allowance_are_not_held() {
    let mut recent = RecentReopens::default();
    let start = Instant::now();
    for index in 0..REOPENS_ALLOWED {
        let admission = recent.admit(start + Duration::from_secs(index as u64));
        assert_eq!(admission.recent, index + 1);
        assert!(!admission.is_held(), "open {index} is within the allowance");
    }
}

/// The observed storm: one open a second. The holds double from the first
/// past the allowance and settle at the ceiling.
#[test]
fn a_storm_is_held_longer_with_every_open_up_to_the_ceiling() {
    let mut recent = RecentReopens::default();
    let start = Instant::now();
    let mut holds = Vec::new();
    for index in 0..REOPENS_ALLOWED + 6 {
        holds.push(recent.admit(start + Duration::from_secs(index as u64)).hold);
    }
    let held: Vec<u64> = holds[REOPENS_ALLOWED..]
        .iter()
        .map(|hold| hold.as_secs())
        .collect();
    assert_eq!(held, vec![1, 2, 4, 8, 15, 15]);
}

#[test]
fn opens_older_than_the_window_are_forgotten() {
    let mut recent = RecentReopens::default();
    let start = Instant::now();
    for index in 0..REOPENS_ALLOWED + 2 {
        recent.admit(start + Duration::from_millis(index as u64));
    }
    assert!(recent.admit(start + Duration::from_secs(1)).is_held());
    let later = recent.admit(start + REOPEN_WINDOW + Duration::from_secs(2));
    assert_eq!(later.recent, 1, "the whole burst has aged out");
    assert!(!later.is_held());
}

#[test]
fn the_throttle_keeps_sessions_and_upstreams_apart() {
    let throttle = ReopenThrottle::default();
    let now = Instant::now();
    for _ in 0..REOPENS_ALLOWED + 1 {
        throttle.admit_at(&session(1), "datadog", now);
    }
    assert!(throttle.admit_at(&session(1), "datadog", now).is_held());
    assert!(
        !throttle.admit_at(&session(1), "linear", now).is_held(),
        "another upstream of the same session has its own allowance"
    );
    assert!(
        !throttle.admit_at(&session(2), "datadog", now).is_held(),
        "another session on the same upstream has its own allowance"
    );
}
