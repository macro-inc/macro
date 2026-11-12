use super::*;

fn state(phase: Phase, power: Power, billing: Billing) -> ComputerState {
    ComputerState {
        provision_traceparent: None,
        setup: None,
        phase,
        billing,
        billing_changed_at: now() - Duration::days(30),
        power,
        macrod_connected: true,
        macrod_misses: 0,
        recent_crashes: vec![],
        power_on_requested: true,
        capacity_wait: None,
        retried_by_team: false,
    }
}

#[test]
fn loss_recreates_every_billed_phase_according_to_power_and_capacity() {
    for phase in [
        Phase::Running,
        Phase::Booting,
        Phase::Crashed {
            restarts: 1,
            retry: Some(Retry {
                attempt: 0,
                next_at: now(),
            }),
        },
        Phase::Crashed {
            restarts: 3,
            retry: None,
        },
        Phase::Stopped,
        Phase::Stopping,
        Phase::Provisioning { start: true },
        Phase::Provisioning { start: false },
    ] {
        for power in [Power::On, Power::Off] {
            for host_has_room in [true, false] {
                for billing in [
                    active(),
                    // Canceled but still inside the paid period.
                    Billing::EndsAt {
                        at: now() + Duration::days(3),
                    },
                ] {
                    let (next, effects) = transition(
                        &state(phase.clone(), power, billing),
                        &Event::InstanceLost,
                        context(host_has_room),
                    )
                    .unwrap();
                    let start = power == Power::On && host_has_room;
                    assert_eq!(next.phase, Phase::Provisioning { start });
                    assert_eq!(
                        next.power_on_requested,
                        power == Power::On && !host_has_room
                    );
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
    }
}

/// Edge case (i): a lost guest whose billing ended is destroyed through the
/// Destroy effect, so the fleet still deletes the data volume it left.
#[test]
fn instance_lost_after_billing_ended_destroys_the_data_volume() {
    let (next, effects) = transition(
        &state(
            Phase::Stopped,
            Power::Off,
            Billing::EndsAt {
                at: now() - Duration::days(2),
            },
        ),
        &Event::InstanceLost,
        context(true),
    )
    .unwrap();

    assert_eq!(next.phase, Phase::Destroying);
    assert_eq!(
        effects,
        vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness]
    );
    assert!(!next.macrod_connected);
    assert!(!next.power_on_requested);
}

#[test]
fn loss_is_ignored_after_release() {
    let released = state(Phase::Destroying, Power::Off, Billing::EndsAt { at: now() });
    let (next, effects) = transition(&released, &Event::InstanceLost, context(true)).unwrap();
    assert_eq!(next, released);
    assert!(effects.is_empty());
}
