use super::*;

fn price() -> stripe::PriceId {
    "price_standard".parse().unwrap()
}

/// A booted, connected pool computer nobody bought yet.
fn pooled() -> ComputerState {
    ComputerState {
        provision_traceparent: None,
        setup: None,
        phase: Phase::Running,
        billing: Billing::Pool,
        billing_changed_at: now() - Duration::hours(1),
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
fn a_purchase_takes_a_connected_pool_computer_and_charges_it_after() {
    let (next, effects) = transition(
        &pooled(),
        &Event::Claimed {
            billing: ClaimBilling::Charge {
                price_id: price(),
                extra_items: vec![],
            },
        },
        context(true),
    )
    .unwrap();

    assert_eq!(
        next,
        ComputerState {
            provision_traceparent: None,
            setup: None,
            phase: Phase::Running,
            billing: Billing::Charging,
            billing_changed_at: now(),
            power: Power::On,
            macrod_connected: true,
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
            Effect::Charge {
                price_id: price(),
                extra_items: vec![],
            },
            Effect::JoinTeam,
        ]
    );
}

#[test]
fn a_comped_purchase_takes_a_pool_computer_without_a_charge() {
    let (next, effects) = transition(
        &pooled(),
        &Event::Claimed {
            billing: ClaimBilling::Comped {
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
    assert_eq!(effects, vec![Effect::JoinTeam]);
}

#[test]
fn only_an_up_connected_pool_computer_can_be_taken() {
    let claim = Event::Claimed {
        billing: ClaimBilling::Charge {
            price_id: price(),
            extra_items: vec![],
        },
    };
    let cases = [
        (
            "still booting",
            ComputerState {
                phase: Phase::Booting,
                macrod_connected: false,
                ..pooled()
            },
            Rejected::NotAvailable,
        ),
        (
            "macrod dropped",
            ComputerState {
                macrod_connected: false,
                ..pooled()
            },
            Rejected::NotAvailable,
        ),
        (
            "already bought",
            ComputerState {
                billing: Billing::Charging,
                ..pooled()
            },
            Rejected::NotAvailable,
        ),
        (
            "a team's computer",
            billed(Phase::Running),
            Rejected::NotAvailable,
        ),
        (
            "being destroyed",
            ComputerState {
                phase: Phase::Destroying,
                ..pooled()
            },
            Rejected::Released,
        ),
    ];
    for (case, state, rejected) in cases {
        assert_eq!(
            transition(&state, &claim, context(true)),
            Err(rejected),
            "{case}"
        );
    }
}

#[test]
fn a_settled_charge_bills_the_computer_on_its_item() {
    let charging = ComputerState {
        billing: Billing::Charging,
        ..pooled()
    };

    let (next, effects) = transition(
        &charging,
        &Event::ChargeSucceeded {
            subscription_item: item(),
        },
        context(true),
    )
    .unwrap();

    assert_eq!(
        next.billing,
        Billing::Active {
            subscription_item: item()
        }
    );
    assert_eq!(next.phase, Phase::Running);
    assert_eq!(effects, vec![]);
}

#[test]
fn a_refused_charge_releases_the_computer_with_nothing_to_remove() {
    let charging = ComputerState {
        billing: Billing::Charging,
        ..pooled()
    };

    let (next, effects) = transition(&charging, &Event::ChargeFailed, context(true)).unwrap();

    assert_eq!(next.billing, Billing::EndsAt { at: now() });
    assert_eq!(next.phase, Phase::Destroying);
    assert_eq!(
        effects,
        vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness]
    );
}

#[test]
fn charge_outcomes_change_only_a_computer_still_charging() {
    let outcomes = [
        Event::ChargeSucceeded {
            subscription_item: "si_other".parse().unwrap(),
        },
        Event::ChargeFailed,
    ];
    let states = [
        ("pool", pooled()),
        ("billed", billed(Phase::Running)),
        (
            "comped",
            ComputerState {
                billing: Billing::Comped {
                    reason: "internal team".to_owned(),
                },
                ..pooled()
            },
        ),
    ];
    for (case, state) in states {
        for event in &outcomes {
            let (next, effects) = transition(&state, event, context(true)).unwrap();
            assert_eq!(next, state, "{case}: {event:?}");
            assert_eq!(effects, vec![], "{case}: {event:?}");
        }
    }
}

#[test]
fn no_team_request_applies_to_a_pool_computer() {
    let requests = [
        Event::PowerOn,
        Event::PowerOff,
        Event::TeamRetry,
        Event::CancelAtPeriodEnd { at: now() },
        Event::UndoCancel {
            subscription_item: item(),
        },
        Event::Restore {
            billing: Billing::Active {
                subscription_item: item(),
            },
        },
        Event::ReleaseNow,
    ];
    for event in requests {
        assert_eq!(
            transition(&pooled(), &event, context(true)),
            Err(Rejected::InPool),
            "{event:?}"
        );
    }
}

#[test]
fn a_charging_computer_cannot_be_canceled_or_released_until_its_charge_settles() {
    let charging = ComputerState {
        billing: Billing::Charging,
        ..pooled()
    };
    let requests = [
        Event::CancelAtPeriodEnd { at: now() },
        Event::UndoCancel {
            subscription_item: item(),
        },
        Event::Restore {
            billing: Billing::Active {
                subscription_item: item(),
            },
        },
        Event::ReleaseNow,
    ];
    for event in requests {
        assert_eq!(
            transition(&charging, &event, context(true)),
            Err(Rejected::PaymentPending),
            "{event:?}"
        );
    }
    // The team uses it meanwhile.
    let (next, _) = transition(&charging, &Event::PowerOff, context(true)).unwrap();
    assert_eq!(next.phase, Phase::Stopping);
}

#[test]
fn draining_destroys_only_a_pool_computer() {
    let (next, effects) = transition(&pooled(), &Event::Drain, context(true)).unwrap();
    assert_eq!(next.phase, Phase::Destroying);
    assert_eq!(
        effects,
        vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness]
    );

    let charging = ComputerState {
        billing: Billing::Charging,
        ..pooled()
    };
    for (case, state) in [("charging", charging), ("billed", billed(Phase::Running))] {
        let (next, effects) = transition(&state, &Event::Drain, context(true)).unwrap();
        assert_eq!(next, state, "{case}");
        assert_eq!(effects, vec![], "{case}");
    }
}

#[test]
fn a_new_pool_computer_provisions_started_with_no_setup_timeline() {
    let (state, effects) = provision(Billing::Pool, None, None, context(true));

    assert_eq!(state.billing, Billing::Pool);
    assert_eq!(state.phase, Phase::Provisioning { start: true });
    assert_eq!(state.setup, None);
    assert_eq!(
        effects,
        vec![Effect::Create {
            host: HOST,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}
