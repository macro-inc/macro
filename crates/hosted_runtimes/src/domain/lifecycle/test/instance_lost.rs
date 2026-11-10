use super::*;

#[test]
fn loss_recreates_every_paid_phase_according_to_power_and_capacity() {
    for phase in [
        Phase::Running { host: HOST },
        Phase::Booting { host: HOST },
        Phase::Restarting { host: HOST },
        Phase::Stopped { host: HOST },
        Phase::Stopping { host: HOST },
        Phase::Failed { host: HOST },
        Phase::Provisioning {
            host: HOST,
            start: true,
        },
        Phase::Provisioning {
            host: HOST,
            start: false,
        },
    ] {
        for power in [Power::On, Power::Off] {
            for host_has_room in [true, false] {
                for billing in [Billing::Active, Billing::CancelAtPeriodEnd { at: now() }] {
                    let state = ComputerState {
                        phase: phase.clone(),
                        payment: PaymentOutcome::Paid,
                        comp_reason: None,
                        power,
                        billing,
                        macrod_connected: true,
                        macrod_misses: 0,
                        wake_requested: true,
                        ..ComputerState::reserved(HOST, now())
                    };
                    let (next, effects) = transition(
                        &state,
                        &Event::InstanceLost,
                        Context {
                            enrollment_generation:
                                crate::domain::enrollment::EnrollmentGeneration::new(0),
                            now: now(),
                            host_has_room,
                        },
                    );
                    let start = power == Power::On && host_has_room;
                    assert_eq!(next.phase, Phase::Provisioning { host: HOST, start });
                    assert_eq!(next.wake_requested, power == Power::On && !host_has_room);
                    assert!(!next.macrod_connected);
                    assert_eq!(
                        effects,
                        vec![Effect::Create {
                            host: HOST,
                            start,
                            generation: crate::domain::enrollment::EnrollmentGeneration::new(1)
                        }]
                    );
                }
            }
        }
        let state = ComputerState {
            phase,
            payment: PaymentOutcome::Paid,
            comp_reason: None,
            billing: Billing::Canceled {
                retained_until: now() + RETENTION,
            },
            power: Power::Off,
            ..ComputerState::reserved(HOST, now())
        };
        let (next, effects) = transition(
            &state,
            &Event::InstanceLost,
            Context {
                enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(0),
                now: now(),
                host_has_room: true,
            },
        );
        assert_eq!(next.phase, Phase::Destroyed);
        assert_eq!(effects, vec![Effect::RevokeHarness]);
        assert!(!next.macrod_connected);
        assert!(!next.wake_requested);
    }
}

#[test]
fn loss_is_ignored_before_payment_and_after_destruction() {
    for phase in [
        Phase::PendingPayment {
            host: HOST,
            since: now(),
        },
        Phase::PaymentFailed,
        Phase::Destroyed,
    ] {
        let state = ComputerState {
            phase,
            ..ComputerState::reserved(HOST, now())
        };
        let (next, effects) = transition(
            &state,
            &Event::InstanceLost,
            Context {
                enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(0),
                now: now(),
                host_has_room: true,
            },
        );
        assert_eq!(next, state);
        assert!(effects.is_empty());
    }
}
