use super::*;

fn dropped(quiet_ms: u64, age_ms: u64, interval: Option<u64>) -> Outcome {
    Outcome::Drop {
        quiet_ms,
        age_ms,
        ran_interval_ms: interval,
        idling: true,
    }
}

#[test]
fn learns_from_distinct_drops_and_relaxes_after_stable_sessions() {
    let mut host = IdleState::default();
    for now in [10, 300, 30_000] {
        host.observe_at(dropped(30_000, 60_000, None), now);
        assert_eq!(host.restart_seconds(), if now < 30_000 { 180 } else { 18 });
    }
    for now in [2_000_000, 4_000_000, 6_000_000] {
        host.observe_at(
            Outcome::Stable {
                age_ms: 18_000,
                ran_interval_ms: Some(18_000),
            },
            now,
        );
    }
    assert_eq!(host.restart_seconds(), 27);
    for now in [6_040_000, 6_080_000] {
        host.observe_at(dropped(25_000, 30_000, Some(27_000)), now);
    }
    assert_eq!(host.restart_seconds(), 18);
    assert_eq!(host.relax_limit, Some(27_000));
}

#[test]
fn a_learned_short_interval_recovers_after_completed_watches() {
    let mut host = IdleState::default();
    for now in [10, 30_000] {
        host.observe_at(dropped(15_000, 15_000, None), now);
    }
    assert_eq!(host.restart_seconds(), 10);

    for now in [50_000, 65_000, 80_000] {
        host.observe_at(
            Outcome::Stable {
                age_ms: 10_000,
                ran_interval_ms: Some(10_000),
            },
            now,
        );
    }
    assert_eq!(host.restart_seconds(), 15);
}

#[test]
fn fixed_session_cap_turns_learning_off_for_a_day() {
    let mut host = IdleState::default();
    for now in [10, 30_000] {
        host.observe_at(dropped(30_000, 360_000, None), now);
    }
    for now in [400_000, 800_000] {
        host.observe_at(dropped(8_000, 360_000, Some(18_000)), now);
    }
    assert_eq!(host.restart_seconds(), 180);
    assert_eq!(host.capped_until, 800_000 + CAP_COOLDOWN);
    for now in [1_000_000, 2_000_000] {
        host.observe_at(dropped(30_000, 360_000, None), now);
    }
    assert_eq!(host.restart_seconds(), 180);
    let encoded = serde_json::to_vec(&host).unwrap();
    assert_eq!(serde_json::from_slice::<IdleState>(&encoded).unwrap(), host);
}
