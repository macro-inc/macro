//! A give-up whose cause can pass ends on a sign of life: the agent reporting
//! online, or (unless the agent is what never started) macrod connecting.
//! A give-up whose cause can't pass stays failed until a retry.

use super::first_start::{agent_setting_up, apply, setting_up};
use super::*;

fn power_refused() -> Event {
    Event::EffectFailed {
        failure: Failure::Power,
        reason: "host control plane unreachable".to_owned(),
    }
}

fn gave_up_with(failure: Failure) -> ComputerState {
    ComputerState {
        failure: Some(failure),
        ..billed(Phase::Crashed {
            restarts: 0,
            retry: None,
        })
    }
}

#[test]
fn an_agent_that_reports_online_after_its_deadline_recovers_its_computer() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);
    let (failed, _) = apply(&connected, Event::AgentStartDue);
    assert_eq!(failed.failure, Some(Failure::AgentNotStarted));

    let (online, effects) = apply(&failed, Event::AgentOnline);

    assert_eq!(online.phase, Phase::Running);
    assert_eq!(online.failure, None);
    assert!(!online.awaiting_agent);
    assert!(online.macrod_connected);
    assert!(!online.first_start());
    assert!(!effects.iter().any(|effect| matches!(
        effect,
        Effect::NotifySetup { .. } | Effect::PageOperator { .. }
    )));
}

#[test]
fn a_giving_up_computer_keeps_its_live_macrod_connection() {
    let running = ComputerState {
        macrod_connected: true,
        ..billed(Phase::Running)
    };

    let (failed, _) = apply(&running, power_refused());

    assert!(matches!(failed.phase, Phase::Crashed { retry: None, .. }));
    assert!(failed.macrod_connected);
}

#[test]
fn macrod_reconnecting_recovers_a_computer_whose_power_effect_gave_up() {
    let (failed, _) = apply(&billed(Phase::Running), power_refused());

    let (recovered, effects) = apply(&failed, Event::MacrodConnected);

    assert_eq!(recovered.phase, Phase::Running);
    assert_eq!(recovered.failure, None);
    assert!(recovered.macrod_connected);
    assert_eq!(effects, vec![]);
}

#[test]
fn macrod_reconnecting_recovers_a_computer_that_kept_crashing() {
    let crashing = ComputerState {
        recent_crashes: vec![now() - Duration::minutes(4), now() - Duration::minutes(2)],
        ..billed(Phase::Running)
    };
    let (failed, _) = apply(&crashing, Event::VmCrashed);
    assert_eq!(failed.failure, Some(Failure::KeptCrashing));

    let (recovered, effects) = apply(&failed, Event::MacrodConnected);

    assert_eq!(recovered.phase, Phase::Running);
    assert_eq!(recovered.failure, None);
    assert!(recovered.recent_crashes.is_empty());
    assert_eq!(effects, vec![]);
}

/// A recovery during first setup ends it the way a first connection does.
#[test]
fn macrod_connecting_after_a_setup_give_up_finishes_setup() {
    let (failed, _) = apply(&setting_up(), power_refused());

    let (ready, effects) = apply(&failed, Event::MacrodConnected);

    assert_eq!(ready.phase, Phase::Running);
    assert!(ready.setup.as_ref().unwrap().complete());
    assert!(effects.contains(&Effect::NotifySetup {
        outcome: SetupOutcome::Ready,
    }));
}

/// The agent's computer gave up for a passing reason before the agent was
/// handed over: macrod connecting resumes the first start, deadline and all.
#[test]
fn macrod_connecting_after_a_setup_give_up_hands_the_agent_over() {
    let (failed, _) = apply(&agent_setting_up(), power_refused());

    let (resumed, effects) = apply(&failed, Event::MacrodConnected);

    assert_eq!(resumed.phase, Phase::Running);
    assert!(resumed.awaiting_agent);
    assert!(effects.contains(&Effect::DeliverAgent));
    assert!(effects.contains(&Effect::ScheduleTimer {
        kind: TimerKind::AgentStartDue,
        at: now() + AGENT_START_DEADLINE,
    }));
}

/// Macrod was connected when the agent missed its deadline: it connecting
/// again says nothing about the agent, so only a retry or the agent's own
/// online report ends the give-up.
#[test]
fn macrod_reconnecting_does_not_recover_an_agent_that_never_started() {
    let (connected, _) = apply(&agent_setting_up(), Event::MacrodConnected);
    let (failed, _) = apply(&connected, Event::AgentStartDue);
    let (dropped, _) = apply(&failed, Event::MacrodDisconnected);

    let (reconnected, _) = apply(&dropped, Event::MacrodConnected);

    assert!(matches!(
        reconnected.phase,
        Phase::Crashed { retry: None, .. }
    ));
    assert_eq!(reconnected.failure, Some(Failure::AgentNotStarted));
}

#[test]
fn give_ups_whose_cause_cannot_pass_ignore_signs_of_life() {
    for failure in [
        Failure::AgentUnsupported,
        Failure::SetupExhausted,
        Failure::Create,
        Failure::HostLost,
    ] {
        let failed = gave_up_with(failure);
        for event in [Event::MacrodConnected, Event::AgentOnline] {
            let (after, _) = apply(&failed, event.clone());
            assert!(
                matches!(after.phase, Phase::Crashed { retry: None, .. }),
                "{failure:?} after {event:?}"
            );
            assert_eq!(after.failure, Some(failure), "{failure:?} after {event:?}");
        }
    }
}

/// A computer turned off while it was failed is not turned back on by its
/// guest answering.
#[test]
fn a_computer_turned_off_stays_failed_when_macrod_connects() {
    let off = ComputerState {
        power: Power::Off,
        ..gave_up_with(Failure::Power)
    };

    let (after, _) = apply(&off, Event::MacrodConnected);

    assert!(matches!(after.phase, Phase::Crashed { retry: None, .. }));
}

/// A macrod that can't take an agent is no recovery for an agent's computer:
/// handing it the agent would only miss the deadline again and release it.
#[test]
fn a_macrod_that_cannot_take_an_agent_fails_the_give_up_it_would_have_ended() {
    let (failed, _) = apply(&agent_setting_up(), power_refused());

    let (after, effects) = apply(&failed, Event::MacrodConnectedWithoutAgentHandOff);

    assert!(matches!(after.phase, Phase::Crashed { retry: None, .. }));
    assert_eq!(after.failure, Some(Failure::AgentUnsupported));
    assert!(!effects.contains(&Effect::DeliverAgent));
    assert_eq!(after.first_start_failures, failed.first_start_failures);
}

#[test]
fn a_macrod_that_cannot_take_an_agent_still_recovers_a_person_computer() {
    let (failed, _) = apply(&billed(Phase::Running), power_refused());

    let (after, _) = apply(&failed, Event::MacrodConnectedWithoutAgentHandOff);

    assert_eq!(after.phase, Phase::Running);
    assert_eq!(after.failure, None);
}
