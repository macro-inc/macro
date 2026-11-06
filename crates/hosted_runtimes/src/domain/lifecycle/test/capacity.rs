use super::*;

#[test]
fn capacity_retry_backs_off_and_does_not_repeat_room_requests() {
    let mut state = ComputerState {
        phase: Phase::Stopped { host: HOST },
        payment: PaymentOutcome::Paid,
        ..ComputerState::reserved(HOST, now())
    };
    for (event, seconds, make_room, retry_seconds) in [
        (Event::PowerOn, 0, true, Some(20)),
        (Event::PromptArrived, 1, false, None),
        (Event::WakeRetry, 20, false, Some(40)),
        (Event::PowerOn, 21, false, None),
        (Event::WakeRetry, 60, false, Some(80)),
        (Event::WakeRetry, 140, false, Some(160)),
        (Event::WakeRetry, 300, false, Some(320)),
        (Event::WakeRetry, 620, false, Some(600)),
        (Event::WakeRetry, 1220, false, Some(600)),
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
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::MakeRoom { .. })),
            make_room,
            "{event:?} at {seconds}"
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
fn capacity_changes_rearm_room_requests_and_wake_without_waiting_for_backoff() {
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
    let (unavailable, effects) = transition(&waiting, &Event::RoomUnavailable, context);
    assert!(effects.is_empty());
    assert!(unavailable.capacity_wait.as_ref().unwrap().room_unavailable);
    for (room, expected_phase, expected_start, expected_make_room) in [
        (false, Phase::Stopped { host: HOST }, false, true),
        (true, Phase::Booting { host: HOST }, true, false),
    ] {
        let (next, effects) = transition(
            &unavailable,
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
        assert_eq!(
            effects
                .iter()
                .any(|effect| matches!(effect, Effect::MakeRoom { .. })),
            expected_make_room
        );
    }
}

proptest! {
    #[test]
    fn a_waiter_never_requests_room_twice_without_a_capacity_change(
        events in proptest::collection::vec((0_u8..5, 0_i64..660), 1..100)
    ) {
        let mut state = ComputerState {
            phase: Phase::Stopped { host: HOST }, payment: PaymentOutcome::Paid,
            ..ComputerState::reserved(HOST, now())
        };
        let mut at = now();
        let mut room_requested = false;
        for (event, seconds) in events {
            at += Duration::seconds(seconds);
            let event = match event {
                0 => Event::PowerOn, 1 => Event::PromptArrived, 2 => Event::WakeRetry,
                3 => Event::RoomUnavailable, _ => Event::CapacityChanged,
            };
            if event == Event::CapacityChanged { room_requested = false; }
            let (next, effects) = transition(&state, &event, Context {
                now: at, host_has_room: false, enrollment_generation: EnrollmentGeneration::new(0),
            });
            for effect in effects {
                if matches!(effect, Effect::MakeRoom { .. }) {
                    prop_assert!(!room_requested);
                    room_requested = true;
                }
                if let Effect::ScheduleTimer { kind: TimerKind::WakeRetry, at: retry_at } = effect {
                    prop_assert!((Duration::seconds(20)..=Duration::seconds(600)).contains(&(retry_at-at)));
                }
            }
            state = next;
        }
    }
}
