use super::*;

/// Edge case (b): a past-due subscription turns the computer off after the
/// grace, never destroys it, and a recovered payment lets it run again.
#[test]
fn past_due_subscription_stops_the_computer_after_grace_and_never_destroys_it() {
    let running = ComputerState {
        macrod_connected: true,
        ..billed(Phase::Running)
    };

    let (past_due, effects) = transition(
        &running,
        &Event::PaymentLapsed { observed_at: now() },
        context(true),
    )
    .unwrap();
    assert_eq!(
        past_due.billing,
        Billing::PastDue {
            since: now(),
            subscription_item: item(),
        }
    );
    assert_eq!(past_due.phase, Phase::Running);
    assert_eq!(
        effects,
        vec![Effect::ScheduleTimer {
            kind: TimerKind::PastDueGrace,
            at: now() + Duration::days(7),
        }]
    );

    let early = Context {
        now: now() + Duration::days(6),
        ..context(true)
    };
    let (still_running, effects) = transition(&past_due, &Event::PastDueGrace, early).unwrap();
    assert_eq!(still_running, past_due);
    assert!(effects.is_empty());

    let grace_over = Context {
        now: now() + Duration::days(7),
        ..context(true)
    };
    let (stopped, effects) = transition(&past_due, &Event::PastDueGrace, grace_over).unwrap();
    assert_eq!(stopped.phase, Phase::Stopping);
    assert_eq!(stopped.power, Power::Off);
    assert_eq!(effects, vec![Effect::Stop { host: HOST }]);
    assert_eq!(
        transition(&stopped, &Event::PowerOn, grace_over),
        Err(Rejected::PastDue)
    );

    let (recovered, effects) = transition(
        &stopped,
        &Event::PaymentRecovered {
            observed_at: now() + Duration::days(8),
        },
        Context {
            now: now() + Duration::days(8),
            ..context(true)
        },
    )
    .unwrap();
    assert_eq!(
        recovered.billing,
        Billing::Active {
            subscription_item: item(),
        }
    );
    assert!(effects.is_empty());
    let (on, _) = transition(
        &recovered,
        &Event::PowerOn,
        Context {
            now: now() + Duration::days(8),
            ..context(true)
        },
    )
    .unwrap();
    assert_eq!(on.power, Power::On);
}

/// Edge case (f): cancel removes the item at once, without proration, so a
/// period-end timer that fires late (after the renewal) never bills again.
#[test]
fn cancel_removes_the_item_at_once_so_a_late_period_end_bills_nothing() {
    let at = now() + Duration::days(9);
    let (canceled, effects) = transition(
        &billed(Phase::Running),
        &Event::CancelAtPeriodEnd { at },
        context(true),
    )
    .unwrap();
    assert_eq!(
        effects,
        vec![
            Effect::RemoveBillingItem {
                subscription_item: item(),
            },
            Effect::ScheduleTimer {
                kind: TimerKind::BillingEnds,
                at,
            },
        ]
    );

    let late = Context {
        now: at + Duration::days(2),
        ..context(true)
    };
    let (ended, effects) = transition(&canceled, &Event::BillingEnds, late).unwrap();
    assert_eq!(ended.billing, Billing::EndsAt { at });
    assert_eq!(ended.power, Power::Off);
    assert_eq!(
        effects,
        vec![
            Effect::Stop { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::RetentionExpired,
                at: at + Duration::days(14),
            },
        ]
    );
}

/// Edge case (g): restoring during retention bills the computer again and
/// keeps its stopped guest and disk.
#[test]
fn restore_during_retention_bills_again_and_keeps_the_stopped_guest() {
    let at = now() - Duration::days(3);
    let retained = ComputerState {
        power: Power::Off,
        billing: Billing::EndsAt { at },
        ..billed(Phase::Stopped)
    };
    let restored_item: SubscriptionItemId = "si_restored".parse().unwrap();

    let (restored, effects) = transition(
        &retained,
        &Event::Restore {
            billing: Billing::Active {
                subscription_item: restored_item.clone(),
            },
        },
        context(true),
    )
    .unwrap();
    assert_eq!(
        restored.billing,
        Billing::Active {
            subscription_item: restored_item,
        }
    );
    assert_eq!(restored.phase, Phase::Stopped);
    assert_eq!(restored.power, Power::Off);
    assert!(effects.is_empty());

    let (unchanged, effects) = transition(
        &restored,
        &Event::RetentionExpired,
        Context {
            now: at + Duration::days(14),
            ..context(true)
        },
    )
    .unwrap();
    assert_eq!(unchanged, restored);
    assert!(effects.is_empty());
}

#[test]
fn restore_is_only_for_a_computer_whose_paid_period_ended() {
    let ending = ComputerState {
        billing: Billing::EndsAt {
            at: now() + Duration::days(1),
        },
        ..billed(Phase::Running)
    };
    let restore = Event::Restore {
        billing: Billing::Active {
            subscription_item: item(),
        },
    };
    assert_eq!(
        transition(&ending, &restore, context(true)),
        Err(Rejected::BillingNotEnded)
    );
    assert_eq!(
        transition(&billed(Phase::Running), &restore, context(true)),
        Err(Rejected::NotCanceled)
    );
    let released = ComputerState {
        billing: Billing::EndsAt {
            at: now() - Duration::days(1),
        },
        ..billed(Phase::Destroying)
    };
    assert_eq!(
        transition(&released, &restore, context(true)),
        Err(Rejected::Released)
    );
}

/// Edge case (d), lifecycle side: a subscription snapshot read before the
/// computer's billing changed (a concurrent purchase, undo or restore)
/// never cancels it.
#[test]
fn a_snapshot_older_than_the_billing_never_cancels_it() {
    let just_billed = ComputerState {
        billing_changed_at: now(),
        ..billed(Phase::Running)
    };

    let (unchanged, effects) = transition(
        &just_billed,
        &Event::BillingItemMissing {
            observed_at: now() - Duration::seconds(1),
        },
        context(true),
    )
    .unwrap();
    assert_eq!(unchanged, just_billed);
    assert!(effects.is_empty());

    let (ended, effects) = transition(
        &just_billed,
        &Event::BillingItemMissing { observed_at: now() },
        context(true),
    )
    .unwrap();
    assert_eq!(ended.billing, Billing::EndsAt { at: now() });
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
fn an_item_moved_by_the_provider_keeps_billing_on_the_new_item() {
    let moved: SubscriptionItemId = "si_moved".parse().unwrap();
    let (next, effects) = transition(
        &billed(Phase::Running),
        &Event::BillingItemMoved {
            subscription_item: moved.clone(),
            observed_at: now(),
        },
        context(true),
    )
    .unwrap();
    assert_eq!(
        next.billing,
        Billing::Active {
            subscription_item: moved,
        }
    );
    assert!(effects.is_empty());
}

#[test]
fn cancel_while_past_due_ends_billing_at_once() {
    let past_due = ComputerState {
        billing: Billing::PastDue {
            since: now() - Duration::days(2),
            subscription_item: item(),
        },
        ..billed(Phase::Running)
    };
    let (next, effects) = transition(
        &past_due,
        &Event::CancelAtPeriodEnd {
            at: now() + Duration::days(20),
        },
        context(true),
    )
    .unwrap();
    assert_eq!(next.billing, Billing::EndsAt { at: now() });
    assert_eq!(
        effects,
        vec![
            Effect::RemoveBillingItem {
                subscription_item: item(),
            },
            Effect::Stop { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::RetentionExpired,
                at: now() + Duration::days(14),
            },
        ]
    );
}
