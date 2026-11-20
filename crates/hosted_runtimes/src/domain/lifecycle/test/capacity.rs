use super::*;

#[test]
fn capacity_retry_backs_off_and_a_repeated_power_on_keeps_the_deadline() {
    let mut state = ComputerState {
        phase: Phase::Stopped,
        ..billed(Phase::Stopped)
    };
    for (event, seconds, retry_seconds) in [
        (Event::PowerOn, 0, Some(20)),
        (Event::PowerOnRetry, 1, None),
        (Event::PowerOnRetry, 20, Some(40)),
        (Event::PowerOn, 21, None),
        (Event::PowerOnRetry, 60, Some(80)),
        (Event::PowerOnRetry, 140, Some(160)),
        (Event::PowerOnRetry, 300, Some(320)),
        (Event::PowerOnRetry, 620, Some(600)),
        (Event::PowerOnRetry, 1220, Some(600)),
    ] {
        let at = now() + Duration::seconds(seconds);
        let (next, effects) = transition(
            &state,
            &event,
            Context {
                host: HOST,
                policy: policy(),
                now: at,
                host_has_room: false,
                enrollment_generation: EnrollmentGeneration::new(0),
            },
        )
        .unwrap();
        assert_eq!(
            effects.iter().find_map(|effect| match effect {
                Effect::ScheduleTimer {
                    kind: TimerKind::PowerOnRetry,
                    at: retry,
                } => Some((*retry - at).num_seconds()),
                _ => None,
            }),
            retry_seconds,
            "{event:?} at {seconds}"
        );
        state = next;
    }
}

#[test]
fn capacity_changes_start_without_waiting_for_backoff() {
    let context = Context {
        host: HOST,
        policy: policy(),
        now: now(),
        host_has_room: false,
        enrollment_generation: EnrollmentGeneration::new(0),
    };
    let state = ComputerState {
        phase: Phase::Stopped,
        ..billed(Phase::Stopped)
    };
    let (waiting, _) = transition(&state, &Event::PowerOn, context).unwrap();
    for (room, expected_phase, expected_start) in
        [(false, Phase::Stopped, false), (true, Phase::Booting, true)]
    {
        let (next, effects) = transition(
            &waiting,
            &Event::CapacityChanged,
            Context {
                host: HOST,
                policy: policy(),
                now: now() + Duration::seconds(1),
                host_has_room: room,
                ..context
            },
        )
        .unwrap();
        assert_eq!(next.phase, expected_phase);
        assert_eq!(
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::Start { .. })),
            expected_start
        );
    }
}

proptest! {
    #[test]
    fn a_waiter_retries_within_the_backoff_bounds(
        events in proptest::collection::vec((0_u8..3, 0_i64..660), 1..100)
    ) {
        let mut state = ComputerState {
            phase: Phase::Stopped,
            ..billed(Phase::Stopped)
        };
        let mut at = now();
        for (event, seconds) in events {
            at += Duration::seconds(seconds);
            let event = match event {
                0 => Event::PowerOn, 1 => Event::PowerOnRetry, _ => Event::CapacityChanged,
            };
            let (next, effects) = transition(&state, &event, Context {
                host: HOST,
                policy: policy(),
                now: at, host_has_room: false, enrollment_generation: EnrollmentGeneration::new(0),
            }).unwrap();
            for effect in effects {
                if let Effect::ScheduleTimer { kind: TimerKind::PowerOnRetry, at: retry_at } = effect {
                    prop_assert!((Duration::seconds(20)..=Duration::seconds(600)).contains(&(retry_at-at)));
                }
            }
            state = next;
        }
    }
}
