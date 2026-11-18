use super::*;

fn comped(phase: Phase) -> ComputerState {
    ComputerState {
        provision_traceparent: None,
        setup: None,
        phase,
        billing: Billing::Comped {
            reason: "internal team".to_owned(),
        },
        billing_changed_at: now() - Duration::days(30),
        power: Power::On,
        macrod_connected: true,
        macrod_misses: 0,
        recent_crashes: vec![],
        power_on_requested: false,
        capacity_wait: None,
        retried_by_team: false,
        failure: None,
    }
}

#[test]
fn comped_cancel_stops_at_once_and_starts_retention_without_billing() {
    let (next, effects) = transition(
        &comped(Phase::Running),
        &Event::CancelAtPeriodEnd { at: now() },
        context(true),
    )
    .unwrap();

    assert_eq!(next.billing, Billing::EndsAt { at: now() });
    assert_eq!(next.power, Power::Off);
    assert_eq!(next.phase, Phase::Stopping);
    assert_eq!(
        effects,
        vec![
            Effect::Stop { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::RetentionExpired,
                at: now() + Duration::days(14),
            },
        ]
    );
}

#[test]
fn comped_computers_never_remove_subscription_items() {
    for event in [
        Event::ReleaseNow,
        Event::CancelAtPeriodEnd { at: now() },
        Event::BillingItemMissing { observed_at: now() },
        Event::PaymentLapsed { observed_at: now() },
        Event::RetentionExpired,
    ] {
        let (next, effects) = transition(&comped(Phase::Running), &event, context(true)).unwrap();
        assert!(
            !effects
                .iter()
                .any(|effect| matches!(effect, Effect::RemoveBillingItem { .. })),
            "{event:?}"
        );
        if !matches!(event, Event::ReleaseNow | Event::CancelAtPeriodEnd { .. }) {
            assert_eq!(next, comped(Phase::Running), "{event:?}");
        }
    }
}

#[test]
fn a_comped_computer_in_retention_is_restored_comped() {
    let mut state = comped(Phase::Stopped);
    state.billing = Billing::EndsAt {
        at: now() - Duration::days(1),
    };
    state.power = Power::Off;

    let (next, effects) = transition(
        &state,
        &Event::Restore {
            billing: Billing::Comped {
                reason: "internal team".to_owned(),
            },
        },
        context(true),
    )
    .unwrap();

    assert_eq!(
        next.billing,
        Billing::Comped {
            reason: "internal team".to_owned()
        }
    );
    assert_eq!(next.phase, Phase::Stopped);
    assert_eq!(next.billing_changed_at, now());
    assert!(effects.is_empty());
}
