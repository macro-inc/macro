//! A charged purchase provisions while its purchase request charges it:
//! the outcome bills the computer, releases it, or hands the charge to the
//! billing worker.

use super::*;
use crate::domain::models::SubscriptionItem;
use crate::domain::setup::SetupTimeline;

fn seat() -> SubscriptionItem {
    SubscriptionItem {
        price_id: "price_seat".parse().unwrap(),
        quantity: 1,
    }
}

fn charging_by(charger: Charger) -> Billing {
    Billing::Charging {
        extra_items: vec![seat()],
        charger,
    }
}

/// A just-bought computer whose purchase request is still charging it.
fn charging(phase: Phase) -> ComputerState {
    ComputerState {
        billing: charging_by(Charger::Request),
        billing_changed_at: now() - Duration::seconds(10),
        ..billed(phase)
    }
}

#[test]
fn a_charged_purchase_provisions_at_once_and_arms_the_takeover() {
    let (state, effects) = provision(
        charging_by(Charger::Request),
        SetupTimeline::started(now() - Duration::seconds(1)),
        None,
        false,
        context(true),
    );

    assert_eq!(
        state,
        ComputerState {
            provision_traceparent: None,
            setup: Some(SetupTimeline::started(now() - Duration::seconds(1))),
            phase: Phase::Provisioning { start: true },
            billing: charging_by(Charger::Request),
            billing_changed_at: now(),
            power: Power::On,
            macrod_connected: false,
            macrod_misses: 0,
            recent_crashes: vec![],
            power_on_requested: false,
            capacity_wait: None,
            retried_by_team: false,
            failure: None,
            awaiting_agent: false,
            first_start_failures: 0,
            refund: None,
        }
    );
    // The request charges it; the billing worker only takes over a
    // request that never answered.
    assert_eq!(
        effects,
        vec![
            Effect::Create {
                host: HOST,
                start: true,
                generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
            },
            Effect::ScheduleTimer {
                kind: TimerKind::ChargeUnsettled,
                at: now() + CHARGE_TAKEOVER,
            },
        ]
    );
}

#[test]
fn a_comped_purchase_provisions_without_a_charge() {
    let (state, effects) = provision(
        Billing::Comped {
            reason: "staff".to_owned(),
        },
        SetupTimeline::started(now()),
        None,
        false,
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
    for charger in [Charger::Request, Charger::Worker] {
        for phase in [
            Phase::Provisioning { start: true },
            Phase::Booting,
            Phase::Running,
        ] {
            let state = ComputerState {
                billing: charging_by(charger),
                ..charging(phase.clone())
            };

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
                "{charger:?} {phase:?}"
            );
            assert_eq!(effects, vec![], "{charger:?} {phase:?}");
        }
    }
}

#[test]
fn a_decline_the_buyer_was_answered_releases_the_computer_quietly() {
    for (phase, connected) in [
        (Phase::Provisioning { start: true }, false),
        (Phase::Provisioning { start: false }, false),
        (Phase::Booting, false),
        (Phase::Running, true),
        (Phase::Stopped, false),
    ] {
        let state = ComputerState {
            macrod_connected: connected,
            awaiting_agent: true,
            ..charging(phase.clone())
        };

        let (next, effects) = transition(
            &state,
            &Event::ChargeFailed {
                seen: DeclineSeen::ByBuyer,
            },
            context(true),
        )
        .unwrap();

        assert_eq!(
            next,
            ComputerState {
                phase: Phase::Destroying,
                billing: Billing::EndsAt { at: now() },
                billing_changed_at: now(),
                power: Power::Off,
                macrod_connected: false,
                failure: Some(Failure::Payment),
                awaiting_agent: false,
                ..state
            },
            "{phase:?}"
        );
        assert!(!next.is_live(), "{phase:?}: its units are freed");
        assert!(next.declined(), "{phase:?}");
        // The buyer got the 402 and its caller undoes the agent invite.
        assert_eq!(
            effects,
            vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness],
            "{phase:?}"
        );
    }
}

#[test]
fn a_decline_found_later_tells_the_buyer_and_takes_back_the_agent() {
    let state = ComputerState {
        billing: charging_by(Charger::Worker),
        awaiting_agent: true,
        ..charging(Phase::Booting)
    };

    let (next, effects) = transition(
        &state,
        &Event::ChargeFailed {
            seen: DeclineSeen::Later,
        },
        context(true),
    )
    .unwrap();

    assert!(next.declined());
    assert_eq!(
        effects,
        vec![
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
            Effect::UndoAgentInvite,
            Effect::NotifySetup {
                outcome: SetupOutcome::Failed {
                    failure: Failure::Payment,
                    failed_at: now(),
                },
            },
        ]
    );
}

#[test]
fn an_unsettled_charge_goes_to_the_billing_worker_once() {
    let (next, effects) = transition(
        &charging(Phase::Booting),
        &Event::ChargeUnsettled,
        context(true),
    )
    .unwrap();

    assert_eq!(
        next,
        ComputerState {
            billing: charging_by(Charger::Worker),
            billing_changed_at: now(),
            ..charging(Phase::Booting)
        }
    );
    assert_eq!(effects, vec![Effect::Charge]);
    assert_eq!(Effect::Charge.worker(), EffectWorker::Billing);

    // The takeover timer firing after the request already handed it over
    // queues no second charge.
    let (again, effects) = transition(&next, &Event::ChargeUnsettled, context(true)).unwrap();
    assert_eq!(again, next);
    assert_eq!(effects, vec![]);
    assert_eq!(
        TimerKind::ChargeUnsettled.event(None),
        Event::ChargeUnsettled
    );
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
            Event::ChargeFailed {
                seen: DeclineSeen::ByBuyer,
            },
            Event::ChargeFailed {
                seen: DeclineSeen::Later,
            },
            Event::ChargeUnsettled,
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
fn releasing_a_charging_computer_destroys_it_and_fences_the_charge() {
    for charger in [Charger::Request, Charger::Worker] {
        let state = ComputerState {
            billing: charging_by(charger),
            ..charging(Phase::Running)
        };

        let (next, effects) = transition(&state, &Event::ReleaseNow, context(true)).unwrap();

        assert_eq!(next.phase, Phase::Destroying, "{charger:?}");
        assert_eq!(next.billing, Billing::EndsAt { at: now() }, "{charger:?}");
        assert!(!next.declined(), "{charger:?}: released, not declined");
        assert_eq!(
            effects,
            vec![
                Effect::SettleCharge {
                    landed: LandedCharge::Remove,
                },
                Effect::Destroy { host: HOST },
                Effect::RevokeHarness,
            ],
            "{charger:?}"
        );
    }
}

#[test]
fn a_second_failed_first_start_while_charging_fences_the_charge_for_a_refund() {
    let state = ComputerState {
        setup: Some(SetupTimeline::started(now() - Duration::seconds(5))),
        awaiting_agent: true,
        first_start_failures: MAX_FIRST_START_FAILURES - 1,
        ..charging(Phase::Booting)
    };

    let (next, effects) = transition(
        &state,
        &Event::EffectFailed {
            failure: Failure::Create,
            reason: "create refused".to_owned(),
        },
        context(true),
    )
    .unwrap();

    assert_eq!(next.phase, Phase::Destroying);
    assert_eq!(next.billing, Billing::EndsAt { at: now() });
    assert_eq!(
        effects,
        vec![
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
            Effect::SettleCharge {
                landed: LandedCharge::Refund,
            },
            Effect::UndoAgentInvite,
            Effect::NotifySetup {
                outcome: SetupOutcome::Released {
                    failure: Failure::Create,
                    failed_at: now(),
                },
            },
        ]
    );
}

#[test]
fn an_agent_connecting_before_its_charge_settles_gets_its_credentials_after() {
    let state = ComputerState {
        awaiting_agent: true,
        ..charging(Phase::Booting)
    };

    let (connected, effects) = transition(&state, &Event::MacrodConnected, context(true)).unwrap();
    assert!(connected.macrod_connected);
    assert_eq!(connected.phase, Phase::Running);
    assert_eq!(effects, vec![], "no credentials before the charge settles");

    let (paid, effects) = transition(
        &connected,
        &Event::ChargeSucceeded {
            subscription_item: item(),
        },
        context(true),
    )
    .unwrap();
    assert_eq!(
        paid.billing,
        Billing::Active {
            subscription_item: item()
        }
    );
    assert_eq!(
        effects,
        vec![
            Effect::DeliverAgent,
            Effect::ScheduleTimer {
                kind: TimerKind::AgentStartDue,
                at: now() + AGENT_START_DEADLINE,
            },
            Effect::ScheduleTimer {
                kind: TimerKind::AgentRedeliver,
                at: now() + AGENT_REDELIVERY,
            },
        ]
    );
}

#[test]
fn an_agent_whose_charge_settles_before_macrod_connects_gets_them_on_connection() {
    let state = ComputerState {
        awaiting_agent: true,
        ..charging(Phase::Booting)
    };

    let (paid, effects) = transition(
        &state,
        &Event::ChargeSucceeded {
            subscription_item: item(),
        },
        context(true),
    )
    .unwrap();
    assert_eq!(effects, vec![], "macrod isn't there to take the agent");

    let (_, effects) = transition(&paid, &Event::MacrodConnected, context(true)).unwrap();
    assert_eq!(
        effects,
        vec![
            Effect::DeliverAgent,
            Effect::ScheduleTimer {
                kind: TimerKind::AgentStartDue,
                at: now() + AGENT_START_DEADLINE,
            },
            Effect::ScheduleTimer {
                kind: TimerKind::AgentRedeliver,
                at: now() + AGENT_REDELIVERY,
            },
        ]
    );
}

#[test]
fn a_charging_computer_is_not_billed_on_an_item() {
    assert_eq!(charging_by(Charger::Request).subscription_item(), None);
}

#[test]
fn a_charging_state_round_trips() {
    let state = charging(Phase::Booting);
    let json = serde_json::to_value(&state).unwrap();
    assert_eq!(
        json["billing"],
        serde_json::json!({
            "billing": "charging",
            "extra_items": [{ "priceId": "price_seat", "quantity": 1 }],
            "charger": "request",
        })
    );
    assert_eq!(
        serde_json::from_value::<ComputerState>(json).unwrap(),
        state
    );
}
