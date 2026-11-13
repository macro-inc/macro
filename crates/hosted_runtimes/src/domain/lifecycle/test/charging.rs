use super::*;
use crate::domain::models::SubscriptionItem;
use crate::domain::setup::SetupTimeline;

fn price() -> stripe::PriceId {
    "price_computer_small".parse().unwrap()
}

/// A just-bought computer whose charge has not settled, in `phase`.
fn charging(phase: Phase) -> ComputerState {
    ComputerState {
        billing: Billing::Charging,
        billing_changed_at: now() - Duration::seconds(10),
        ..billed(phase)
    }
}

#[test]
fn a_charged_purchase_provisions_at_once_and_charges_beside_it() {
    let (state, effects) = provision(
        Payment::Charge {
            price_id: price(),
            extra_items: vec![SubscriptionItem {
                price_id: "price_seat".parse().unwrap(),
                quantity: 1,
            }],
        },
        SetupTimeline::started(now() - Duration::seconds(1)),
        None,
        context(true),
    );

    assert_eq!(
        state,
        ComputerState {
            provision_traceparent: None,
            setup: Some(SetupTimeline::started(now() - Duration::seconds(1))),
            phase: Phase::Provisioning { start: true },
            billing: Billing::Charging,
            billing_changed_at: now(),
            power: Power::On,
            macrod_connected: false,
            macrod_misses: 0,
            recent_crashes: vec![],
            power_on_requested: false,
            capacity_wait: None,
            retried_by_team: false,
            failure: None,
        }
    );
    assert_eq!(
        effects,
        vec![
            Effect::Create {
                host: HOST,
                start: true,
                generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
            },
            Effect::Charge {
                price_id: price(),
                extra_items: vec![SubscriptionItem {
                    price_id: "price_seat".parse().unwrap(),
                    quantity: 1,
                }],
            },
        ]
    );
    assert_eq!(
        Effect::Charge {
            price_id: price(),
            extra_items: vec![]
        }
        .worker(),
        EffectWorker::Billing
    );
}

#[test]
fn a_comped_purchase_provisions_without_a_charge() {
    let (state, effects) = provision(
        Payment::Comped {
            reason: "staff".to_owned(),
        },
        SetupTimeline::started(now()),
        None,
        context(true),
    );

    assert_eq!(
        state.billing,
        Billing::Comped {
            reason: "staff".to_owned()
        }
    );
    assert_eq!(
        effects,
        vec![Effect::Create {
            host: HOST,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}

#[test]
fn a_settled_charge_bills_the_computer_on_its_item() {
    for phase in [
        Phase::Provisioning { start: true },
        Phase::Booting,
        Phase::Running,
    ] {
        let state = charging(phase.clone());

        let (next, effects) = transition(
            &state,
            &Event::ChargeSucceeded {
                subscription_item: item(),
            },
            context(true),
        )
        .unwrap();

        assert_eq!(
            next,
            ComputerState {
                billing: Billing::Active {
                    subscription_item: item()
                },
                billing_changed_at: now(),
                ..state
            },
            "{phase:?}"
        );
        assert_eq!(effects, vec![], "{phase:?}");
    }
}

#[test]
fn a_failed_charge_releases_the_computer_and_tells_the_buyer() {
    for (phase, connected) in [
        (Phase::Provisioning { start: true }, false),
        (Phase::Provisioning { start: false }, false),
        (Phase::Booting, false),
        (Phase::Running, true),
        (Phase::Stopped, false),
    ] {
        let state = ComputerState {
            macrod_connected: connected,
            ..charging(phase.clone())
        };

        let (next, effects) = transition(&state, &Event::ChargeFailed, context(true)).unwrap();

        assert_eq!(next.phase, Phase::Destroying, "{phase:?}");
        assert_eq!(next.billing, Billing::EndsAt { at: now() }, "{phase:?}");
        assert_eq!(next.failure, Some(Failure::Payment), "{phase:?}");
        assert!(!next.is_live(), "{phase:?}: its units are freed");
        assert_eq!(
            effects,
            vec![
                Effect::Destroy { host: HOST },
                Effect::RevokeHarness,
                Effect::NotifySetup {
                    outcome: SetupOutcome::Failed {
                        failure: Failure::Payment,
                        failed_at: now(),
                    },
                },
            ],
            "{phase:?}"
        );
    }
}

#[test]
fn a_charge_outcome_for_a_computer_no_longer_charging_changes_nothing() {
    let settled = [
        billed(Phase::Running),
        ComputerState {
            billing: Billing::Comped {
                reason: "staff".to_owned(),
            },
            ..billed(Phase::Running)
        },
        ComputerState {
            billing: Billing::EndsAt { at: now() },
            ..billed(Phase::Stopped)
        },
        charging(Phase::Destroying),
    ];
    for state in settled {
        for event in [
            Event::ChargeSucceeded {
                subscription_item: "si_other".parse().unwrap(),
            },
            Event::ChargeFailed,
        ] {
            let (next, effects) = transition(&state, &event, context(true)).unwrap();

            assert_eq!(next, state, "{event:?} on {:?}", state.billing);
            assert_eq!(effects, vec![], "{event:?} on {:?}", state.billing);
        }
    }
}

#[test]
fn billing_requests_wait_for_the_charge_to_settle() {
    for event in [
        Event::CancelAtPeriodEnd {
            at: now() + Duration::days(20),
        },
        Event::UndoCancel {
            subscription_item: item(),
        },
        Event::Restore {
            billing: Billing::Active {
                subscription_item: item(),
            },
        },
    ] {
        assert_eq!(
            transition(&charging(Phase::Running), &event, context(true)),
            Err(Rejected::PaymentPending),
            "{event:?}"
        );
    }
    assert_eq!(
        undo_allowed(&charging(Phase::Running), now()),
        Err(Rejected::PaymentPending)
    );
    assert_eq!(
        restore_allowed(&charging(Phase::Running), now()),
        Err(Rejected::PaymentPending)
    );
}

#[test]
fn releasing_a_charging_computer_destroys_it_and_removes_no_item() {
    let (next, effects) =
        transition(&charging(Phase::Running), &Event::ReleaseNow, context(true)).unwrap();

    assert_eq!(next.phase, Phase::Destroying);
    assert_eq!(next.billing, Billing::EndsAt { at: now() });
    assert_eq!(
        effects,
        vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness]
    );
}

#[test]
fn a_charging_computer_is_not_billed_on_an_item() {
    assert_eq!(Billing::Charging.subscription_item(), None);
}
