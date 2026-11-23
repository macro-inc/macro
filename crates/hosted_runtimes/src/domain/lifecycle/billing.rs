//! The billing half of [`super::transition`]: what cancelling, restoring,
//! releasing, payment and a purchase's charge do to a computer.

use chrono::{DateTime, Utc};

use super::{
    Billing, BillingPolicy, Charger, ComputerState, Context, DeclineSeen, Effect, Event, Failure,
    HostId, LandedCharge, Phase, Power, Rejected, SetupOutcome, TimerKind, deliver_agent, destroy,
    gave_up, power_down,
};

/// Apply a billing or charging event to `next`. [`super::transition`] sends
/// only those events here; any other changes nothing.
pub(super) fn transition(
    state: &ComputerState,
    event: &Event,
    context: Context,
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
) -> Result<(), Rejected> {
    let now = context.now;
    let host = context.host;
    let policy = context.policy;
    match event {
        Event::CancelAtPeriodEnd { at } => match &state.billing {
            Billing::Active { subscription_item } => {
                effects.push(Effect::RemoveBillingItem {
                    subscription_item: subscription_item.clone(),
                });
                if *at > now {
                    next.billing = Billing::EndsAt { at: *at };
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::BillingEnds,
                        at: *at,
                    });
                } else {
                    end_billing(next, effects, host, now, policy);
                }
            }
            // An unpaid period is not owed any more running time.
            Billing::PastDue {
                subscription_item, ..
            } => {
                effects.push(Effect::RemoveBillingItem {
                    subscription_item: subscription_item.clone(),
                });
                end_billing(next, effects, host, now, policy);
            }
            Billing::Comped { .. } => end_billing(next, effects, host, now, policy),
            Billing::EndsAt { .. } => return Err(Rejected::AlreadyCanceled),
            Billing::Charging { .. } => return Err(Rejected::PaymentPending),
        },

        Event::UndoCancel { subscription_item } => {
            undo_allowed(state, now)?;
            next.billing = Billing::Active {
                subscription_item: subscription_item.clone(),
            };
        }

        Event::Restore { billing } => {
            restore_allowed(state, now)?;
            match billing {
                Billing::Active { .. } | Billing::Comped { .. } => next.billing = billing.clone(),
                Billing::PastDue { .. } | Billing::EndsAt { .. } | Billing::Charging { .. } => {
                    return Err(Rejected::InvalidRestore);
                }
            }
        }

        Event::ReleaseNow => {
            if let Some(subscription_item) = state.billing.subscription_item() {
                effects.push(Effect::RemoveBillingItem {
                    subscription_item: subscription_item.clone(),
                });
            }
            if state.billing.is_charging() {
                effects.push(Effect::SettleCharge {
                    landed: LandedCharge::Remove,
                });
            }
            // A released computer is never billed again.
            if !matches!(state.billing, Billing::EndsAt { at } if at <= now) {
                next.billing = Billing::EndsAt { at: now };
            }
            destroy(next, effects, host);
        }

        Event::PaymentLapsed { observed_at } => {
            if let Billing::Active { subscription_item } = &state.billing
                && *observed_at >= state.billing_changed_at
            {
                next.billing = Billing::PastDue {
                    since: now,
                    subscription_item: subscription_item.clone(),
                };
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::PastDueGrace,
                    at: now + policy.past_due_grace,
                });
            }
        }

        Event::PaymentRecovered { observed_at } => {
            if let Billing::PastDue {
                subscription_item, ..
            } = &state.billing
                && *observed_at >= state.billing_changed_at
            {
                next.billing = Billing::Active {
                    subscription_item: subscription_item.clone(),
                };
            }
        }

        Event::BillingItemMissing { observed_at } => {
            if state.billing.subscription_item().is_some()
                && *observed_at >= state.billing_changed_at
            {
                end_billing(next, effects, host, now, policy);
            }
        }

        Event::BillingItemMoved {
            subscription_item,
            observed_at,
        } => {
            if *observed_at >= state.billing_changed_at {
                match &state.billing {
                    Billing::Active { .. } => {
                        next.billing = Billing::Active {
                            subscription_item: subscription_item.clone(),
                        };
                    }
                    Billing::PastDue { since, .. } => {
                        next.billing = Billing::PastDue {
                            since: *since,
                            subscription_item: subscription_item.clone(),
                        };
                    }
                    Billing::EndsAt { .. } | Billing::Comped { .. } | Billing::Charging { .. } => {}
                }
            }
        }

        Event::BillingEnds => {
            if let Billing::EndsAt { at } = state.billing
                && now >= at
            {
                end_billing(next, effects, host, at, policy);
            }
        }

        Event::PastDueGrace => {
            if state.past_due_expired(now, policy) {
                next.power = Power::Off;
                power_down(next, effects, host);
            }
        }

        Event::RetentionExpired => {
            if let Billing::EndsAt { at } = state.billing
                && now >= at + policy.retention
            {
                destroy(next, effects, host);
            }
        }

        Event::ChargeSucceeded { subscription_item } => {
            if state.billing.is_charging() {
                next.billing = Billing::Active {
                    subscription_item: subscription_item.clone(),
                };
                // macrod connected before the charge settled: hand the agent
                // over now.
                if state.awaiting_agent && state.macrod_connected && !gave_up(&state.phase) {
                    deliver_agent(effects, now);
                }
            }
        }

        Event::ChargeUnsettled => {
            if let Billing::Charging {
                extra_items,
                charger: Charger::Request,
            } = &state.billing
            {
                next.billing = Billing::Charging {
                    extra_items: extra_items.clone(),
                    charger: Charger::Worker,
                };
                effects.push(Effect::Charge);
            }
        }

        // Nothing was charged, so there is no item to remove.
        Event::ChargeFailed { seen } => {
            if state.billing.is_charging() {
                next.billing = Billing::EndsAt { at: now };
                next.failure = Some(Failure::Payment);
                next.power = Power::Off;
                next.awaiting_agent = false;
                destroy(next, effects, host);
                match seen {
                    DeclineSeen::ByBuyer => {}
                    DeclineSeen::Later => {
                        effects.push(Effect::UndoAgentInvite);
                        effects.push(Effect::NotifySetup {
                            outcome: SetupOutcome::Failed {
                                failure: Failure::Payment,
                                failed_at: now,
                            },
                        });
                    }
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Whether a cancellation can still be undone at `now`: before its paid
/// period ends. Callers check this before re-adding a billing item.
pub fn undo_allowed(state: &ComputerState, now: DateTime<Utc>) -> Result<(), Rejected> {
    match state.billing {
        _ if state.phase == Phase::Destroying => Err(Rejected::Released),
        Billing::EndsAt { at } if now < at => Ok(()),
        Billing::EndsAt { .. } => Err(Rejected::BillingEnded),
        Billing::Active { .. } | Billing::PastDue { .. } | Billing::Comped { .. } => {
            Err(Rejected::NotCanceled)
        }
        Billing::Charging { .. } => Err(Rejected::PaymentPending),
    }
}

/// Whether the computer can be restored at `now`: its paid period ended and
/// it is not destroyed yet. Callers check this before re-adding a billing item.
pub fn restore_allowed(state: &ComputerState, now: DateTime<Utc>) -> Result<(), Rejected> {
    match state.billing {
        _ if state.phase == Phase::Destroying => Err(Rejected::Released),
        Billing::EndsAt { at } if now >= at => Ok(()),
        Billing::EndsAt { .. } => Err(Rejected::BillingNotEnded),
        Billing::Active { .. } | Billing::PastDue { .. } | Billing::Comped { .. } => {
            Err(Rejected::NotCanceled)
        }
        Billing::Charging { .. } => Err(Rejected::PaymentPending),
    }
}

/// The paid period ended at `at`: turn off and keep the disk for the
/// configured retention.
fn end_billing(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    at: DateTime<Utc>,
    policy: BillingPolicy,
) {
    next.billing = Billing::EndsAt { at };
    next.power = Power::Off;
    power_down(next, effects, host);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::RetentionExpired,
        at: at + policy.retention,
    });
}
