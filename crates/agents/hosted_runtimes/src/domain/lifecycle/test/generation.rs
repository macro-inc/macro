use super::*;
use crate::domain::enrollment::EnrollmentGeneration;

#[test]
fn recreation_reserves_the_next_generation() {
    for (phase, event, previous, expected) in [
        (Phase::Running, Event::InstanceLost, 1, 2),
        (Phase::Stopped, Event::InstanceLost, 8, 9),
    ] {
        let state = ComputerState {
            phase,
            ..billed(Phase::Stopped)
        };
        let (_, effects) = transition(
            &state,
            &event,
            Context {
                host: HOST,
                policy: policy(),
                now: now(),
                host_has_room: true,
                enrollment_generation: EnrollmentGeneration::new(previous),
            },
        )
        .unwrap();
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
