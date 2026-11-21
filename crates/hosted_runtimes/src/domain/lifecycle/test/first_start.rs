//! A computer that fails its first start twice is taken back: released, its
//! purchase refunded, and an agent teammate it was bought for uninvited. One
//! failure leaves it for the team to retry, with no new charge.

use super::*;
use crate::domain::setup::SetupTimeline;

/// A billed computer booting for the first time.
pub(super) fn setting_up() -> ComputerState {
    ComputerState {
        setup: Some(SetupTimeline {
            reserved_at: now() - Duration::minutes(5),
            provisioned_at: None,
            paid_at: Some(now() - Duration::minutes(4)),
            booting_at: Some(now() - Duration::minutes(2)),
            connected_at: None,
            waited_for_capacity: false,
            agent_delivered_at: None,
            agent_online_at: None,
        }),
        ..billed(Phase::Booting)
    }
}

/// [`setting_up`], bought for an agent teammate that hasn't reported online.
pub(super) fn agent_setting_up() -> ComputerState {
    ComputerState {
        awaiting_agent: true,
        ..setting_up()
    }
}

/// Apply `event` and latch setup milestones as the repository does.
pub(super) fn apply(state: &ComputerState, event: Event) -> (ComputerState, Vec<Effect>) {
    let (mut next, effects) = transition(state, &event, context(true)).unwrap();
    let (phase, connected, waiting) = (
        next.phase.clone(),
        next.macrod_connected,
        next.waiting_for_capacity(),
    );
    if let Some(setup) = next.setup.as_mut() {
        setup.advance(
            &phase,
            connected,
            waiting,
            crate::domain::setup::PaymentProgress::Settled,
            now(),
        );
    }
    (next, effects)
}

fn create_refused() -> Event {
    Event::EffectFailed {
        failure: Failure::Create,
        reason: "create refused".to_owned(),
    }
}

#[test]
fn a_first_start_failure_waits_for_a_retry_and_keeps_the_charge() {
    let (failed, effects) = apply(&setting_up(), create_refused());

    assert_eq!(
        failed.phase,
        Phase::Crashed {
            restarts: 0,
            retry: None,
        }
    );
    assert_eq!(failed.first_start_failures, 1);
    assert_eq!(failed.billing, setting_up().billing);
    assert!(
        !effects
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
    assert!(effects.contains(&Effect::NotifySetup {
        outcome: SetupOutcome::Failed {
            failure: Failure::Create,
            failed_at: now(),
        },
    }));
}

#[test]
fn a_second_first_start_failure_releases_refunds_and_takes_the_agent_back() {
    let (failed, _) = apply(&setting_up(), create_refused());
    let (retried, _) = apply(&failed, Event::TeamRetry);
    assert_eq!(retried.phase, Phase::Booting);

    let (released, effects) = apply(&retried, create_refused());

    assert_eq!(released.phase, Phase::Destroying);
    assert_eq!(released.billing, Billing::EndsAt { at: now() });
    assert_eq!(released.failure, Some(Failure::Create));
    assert_eq!(released.first_start_failures, 2);
    assert_eq!(
        effects,
        vec![
            Effect::Destroy { host: HOST },
            Effect::RevokeHarness,
            Effect::RefundPurchase {
                subscription_item: item(),
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
fn a_comped_computer_failing_twice_is_released_with_nothing_to_refund() {
    let comped = ComputerState {
        billing: Billing::Comped {
            reason: "design partner".to_owned(),
        },
        first_start_failures: 1,
        ..setting_up()
    };

    let (released, effects) = apply(&comped, create_refused());

    assert_eq!(released.phase, Phase::Destroying);
    assert!(
        !effects
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
    assert!(effects.contains(&Effect::UndoAgentInvite));
}

#[test]
fn a_lost_host_during_the_first_start_is_no_strike_against_the_computer() {
    let struck_once = ComputerState {
        first_start_failures: 1,
        ..setting_up()
    };

    let (gave_up, effects) = apply(&struck_once, Event::HostLost);

    assert_eq!(gave_up.first_start_failures, 1);
    assert_eq!(gave_up.failure, Some(Failure::HostLost));
    assert_ne!(gave_up.phase, Phase::Destroying);
    assert!(!effects.contains(&Effect::UndoAgentInvite));
    assert!(
        !effects
            .iter()
            .any(|effect| matches!(effect, Effect::RefundPurchase { .. }))
    );
}

#[test]
fn failures_after_the_first_start_never_release_the_computer() {
    let (running, _) = apply(&setting_up(), Event::MacrodConnected);
    assert!(running.setup.as_ref().unwrap().complete());

    let (failed, _) = apply(&running, create_refused());
    let (retried, _) = apply(&failed, Event::TeamRetry);
    let (failed_again, effects) = apply(&retried, create_refused());

    assert_eq!(failed_again.first_start_failures, 0);
    assert!(matches!(
        failed_again.phase,
        Phase::Crashed { retry: None, .. }
    ));
    assert!(!effects.contains(&Effect::UndoAgentInvite));
}

#[test]
fn an_agent_computer_gives_its_agent_a_deadline_once_macrod_connects() {
    let (connected, effects) = apply(&agent_setting_up(), Event::MacrodConnected);

    assert!(connected.awaiting_agent);
    assert!(effects.contains(&Effect::DeliverAgent));
    assert!(effects.contains(&Effect::ScheduleTimer {
        kind: TimerKind::AgentStartDue,
        at: now() + AGENT_START_DEADLINE,
    }));
}

#[test]
fn a_person_computer_sets_no_agent_deadline() {
    let (_, effects) = apply(&setting_up(), Event::MacrodConnected);

    assert!(!effects.iter().any(|effect| matches!(
        effect,
        Effect::ScheduleTimer {
            kind: TimerKind::AgentStartDue,
            ..
        }
    )));
    assert!(!effects.contains(&Effect::DeliverAgent));
}

#[test]
fn an_agent_that_reports_online_in_time_meets_its_deadline() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);
    let (online, _) = apply(&connected, Event::AgentOnline);
    assert!(!online.awaiting_agent);

    let (after, effects) = apply(&online, Event::AgentStartDue);

    assert_eq!(after, online);
    assert_eq!(effects, vec![]);
}

#[test]
fn an_agent_that_never_reports_online_fails_its_first_start() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);

    let (failed, effects) = apply(&connected, Event::AgentStartDue);

    assert!(matches!(failed.phase, Phase::Crashed { retry: None, .. }));
    assert_eq!(failed.failure, Some(Failure::AgentNotStarted));
    assert_eq!(failed.first_start_failures, 1);
    assert!(effects.contains(&Effect::NotifySetup {
        outcome: SetupOutcome::Failed {
            failure: Failure::AgentNotStarted,
            failed_at: now(),
        },
    }));
}

#[test]
fn an_agent_that_misses_its_deadline_after_a_retry_is_taken_back() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);
    let (failed, _) = apply(&connected, Event::AgentStartDue);
    let (retried, _) = apply(&failed, Event::TeamRetry);
    let (reconnected, effects) = apply(&retried, Event::MacrodConnected);
    assert!(effects.contains(&Effect::ScheduleTimer {
        kind: TimerKind::AgentStartDue,
        at: now() + AGENT_START_DEADLINE,
    }));

    let (released, effects) = apply(&reconnected, Event::AgentStartDue);

    assert_eq!(released.phase, Phase::Destroying);
    assert!(effects.contains(&Effect::RefundPurchase {
        subscription_item: item(),
    }));
    assert!(effects.contains(&Effect::UndoAgentInvite));
    assert!(effects.contains(&Effect::NotifySetup {
        outcome: SetupOutcome::Released {
            failure: Failure::AgentNotStarted,
            failed_at: now(),
        },
    }));
}

#[test]
fn a_released_computer_records_its_refund() {
    let released = ComputerState {
        phase: Phase::Destroying,
        billing: Billing::EndsAt { at: now() },
        ..setting_up()
    };
    let refund = PurchaseRefund {
        credit_note: "cn_1".parse().unwrap(),
        refund: Some("re_1".parse().unwrap()),
    };

    let (recorded, effects) = apply(
        &released,
        Event::PurchaseRefunded {
            refund: refund.clone(),
        },
    );

    assert_eq!(recorded.refund, Some(refund));
    assert_eq!(effects, vec![]);
}

#[test]
fn a_state_row_written_before_first_start_tracking_still_decodes() {
    let mut row = serde_json::to_value(setting_up()).unwrap();
    let object = row.as_object_mut().unwrap();
    object.remove("awaiting_agent");
    object.remove("first_start_failures");
    object.remove("refund");

    let state: ComputerState = serde_json::from_value(row).unwrap();

    assert!(!state.awaiting_agent);
    assert_eq!(state.first_start_failures, 0);
    assert_eq!(state.refund, None);
}

/// The hand-off carries no acknowledgement, so it is sent again on a timer
/// until the agent reports online; a lost one can't fail the agent's start.
#[test]
fn an_agent_is_handed_over_again_until_it_reports_online() {
    let (connected, effects) = apply(&agent_setting_up(), Event::MacrodConnected);
    assert!(effects.contains(&Effect::ScheduleTimer {
        kind: TimerKind::AgentRedeliver,
        at: now() + AGENT_REDELIVERY,
    }));

    let (again, effects) = apply(&connected, Event::AgentRedeliver);
    assert_eq!(
        effects,
        vec![
            Effect::DeliverAgent,
            Effect::ScheduleTimer {
                kind: TimerKind::AgentRedeliver,
                at: now() + AGENT_REDELIVERY,
            },
        ]
    );

    let (online, _) = apply(&again, Event::AgentOnline);
    let (_, effects) = apply(&online, Event::AgentRedeliver);
    assert_eq!(effects, vec![]);
}

#[test]
fn an_agent_computer_whose_macrod_cannot_take_an_agent_fails_at_once() {
    let (failed, effects) = apply(
        &agent_setting_up(),
        Event::MacrodConnectedWithoutAgentHandOff,
    );

    assert!(matches!(failed.phase, Phase::Crashed { retry: None, .. }));
    assert_eq!(failed.failure, Some(Failure::AgentUnsupported));
    assert_eq!(failed.first_start_failures, 1);
    assert!(!effects.contains(&Effect::DeliverAgent));
    assert!(
        effects.contains(&Effect::PageOperator {
            reason: "macrod on this computer declared no apply-agent capability: its image \
                 predates agent hand-off"
                .to_owned(),
        })
    );
    assert!(effects.contains(&Effect::NotifySetup {
        outcome: SetupOutcome::Failed {
            failure: Failure::AgentUnsupported,
            failed_at: now(),
        },
    }));
}

#[test]
fn a_person_computer_runs_on_a_macrod_that_cannot_take_an_agent() {
    let without = apply(&setting_up(), Event::MacrodConnectedWithoutAgentHandOff);

    assert_eq!(without, apply(&setting_up(), Event::MacrodConnected));
    assert_eq!(without.0.phase, Phase::Running);
}

/// A computer that gave up waits for a retry: macrod reconnecting to it hands
/// no agent over and starts no new deadline.
#[test]
fn macrod_reconnecting_to_a_computer_that_gave_up_hands_no_agent_over() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);
    let (failed, _) = apply(&connected, Event::AgentStartDue);

    let (_, effects) = apply(&failed, Event::MacrodConnected);

    assert!(!effects.contains(&Effect::DeliverAgent));
    assert!(!effects.iter().any(|effect| matches!(
        effect,
        Effect::ScheduleTimer {
            kind: TimerKind::AgentStartDue | TimerKind::AgentRedeliver,
            ..
        }
    )));
}
