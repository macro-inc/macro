use super::*;

#[test]
fn capacity_retry_backs_off_and_a_repeated_power_on_keeps_the_deadline() {
    let mut state = ComputerState {
        phase: Phase::Stopped { host: HOST },
        payment: PaymentOutcome::Paid,
        ..ComputerState::reserved(HOST, now())
    };
    for (event, seconds, retry_seconds) in [
        (Event::PowerOn, 0, Some(20)),
        (Event::WakeRetry, 1, None),
        (Event::WakeRetry, 20, Some(40)),
        (Event::PowerOn, 21, None),
        (Event::WakeRetry, 60, Some(80)),
        (Event::WakeRetry, 140, Some(160)),
        (Event::WakeRetry, 300, Some(320)),
        (Event::WakeRetry, 620, Some(600)),
        (Event::WakeRetry, 1220, Some(600)),
    ] {
        let at = now() + Duration::seconds(seconds);
        let (next, effects) = transition(
            &state,
            &event,
            Context {
                now: at,
                host_has_room: false,
                enrollment_generation: EnrollmentGeneration::new(0),
            },
        );
        assert_eq!(
            effects.iter().find_map(|effect| match effect {
                Effect::ScheduleTimer {
                    kind: TimerKind::WakeRetry,
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
        now: now(),
        host_has_room: false,
        enrollment_generation: EnrollmentGeneration::new(0),
    };
    let state = ComputerState {
        phase: Phase::Stopped { host: HOST },
        payment: PaymentOutcome::Paid,
        ..ComputerState::reserved(HOST, now())
    };
    let (waiting, _) = transition(&state, &Event::PowerOn, context);
    for (room, expected_phase, expected_start) in [
        (false, Phase::Stopped { host: HOST }, false),
        (true, Phase::Booting { host: HOST }, true),
    ] {
        let (next, effects) = transition(
            &waiting,
            &Event::CapacityChanged,
            Context {
                now: now() + Duration::seconds(1),
                host_has_room: room,
                ..context
            },
        );
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
            phase: Phase::Stopped { host: HOST }, payment: PaymentOutcome::Paid,
            ..ComputerState::reserved(HOST, now())
        };
        let mut at = now();
        for (event, seconds) in events {
            at += Duration::seconds(seconds);
            let event = match event {
                0 => Event::PowerOn, 1 => Event::WakeRetry, _ => Event::CapacityChanged,
            };
            let (next, effects) = transition(&state, &event, Context {
                now: at, host_has_room: false, enrollment_generation: EnrollmentGeneration::new(0),
            });
            for effect in effects {
                if let Effect::ScheduleTimer { kind: TimerKind::WakeRetry, at: retry_at } = effect {
                    prop_assert!((Duration::seconds(20)..=Duration::seconds(600)).contains(&(retry_at-at)));
                }
            }
            state = next;
        }
    }
}
