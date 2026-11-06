use super::*;
use crate::domain::persona_credentials::EnrollmentGeneration;

#[test]
fn create_reserves_the_next_generation_for_first_creation_and_recreation() {
    for (phase, event, previous, expected) in [
        (
            Phase::PendingPayment {
                host: HOST,
                since: now(),
            },
            Event::PaymentConfirmed,
            0,
            1,
        ),
        (Phase::Running { host: HOST }, Event::InstanceLost, 1, 2),
        (Phase::Stopped { host: HOST }, Event::InstanceLost, 8, 9),
    ] {
        let state = ComputerState {
            phase,
            ..ComputerState::reserved(HOST, now())
        };
        let (_, effects) = transition(
            &state,
            &event,
            Context {
                now: now(),
                host_has_room: true,
                enrollment_generation: EnrollmentGeneration::new(previous),
            },
        );
        assert_eq!(
            effects,
            vec![Effect::Create {
                host: HOST,
                start: true,
                generation: EnrollmentGeneration::new(expected)
            }]
        );
    }
}
