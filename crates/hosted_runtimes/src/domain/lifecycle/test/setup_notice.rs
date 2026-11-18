use super::*;
use crate::domain::setup::SetupTimeline;

/// A billed computer booting for the first time: paid, booting, macrod not
/// connected yet.
fn setting_up() -> ComputerState {
    ComputerState {
        setup: Some(SetupTimeline {
            reserved_at: now() - Duration::minutes(5),
            paid_at: Some(now() - Duration::minutes(4)),
            booting_at: Some(now() - Duration::minutes(2)),
            connected_at: None,
            waited_for_capacity: false,
        }),
        ..billed(Phase::Booting)
    }
}

/// Apply `event` at `at` and latch setup milestones as the repository does
/// after every transition.
fn apply(state: &ComputerState, event: Event, at: DateTime<Utc>) -> (ComputerState, Vec<Effect>) {
    let (mut next, effects) = transition(
        state,
        &event,
        Context {
            now: at,
            ..context(true)
        },
    )
    .unwrap();
    let (phase, connected, waiting) = (
        next.phase.clone(),
        next.macrod_connected,
        next.waiting_for_capacity(),
    );
    if let Some(setup) = next.setup.as_mut() {
        setup.advance(&phase, connected, waiting, at);
    }
    (next, effects)
}

fn setup_notices(effects: &[Effect]) -> Vec<&SetupOutcome> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            Effect::NotifySetup { outcome } => Some(outcome),
            _ => None,
        })
        .collect()
}

#[test]
fn the_first_macrod_connection_of_setup_tells_the_buyer_it_is_ready() {
    let (ready, effects) = apply(&setting_up(), Event::MacrodConnected, now());

    assert_eq!(ready.phase, Phase::Running);
    assert_eq!(
        effects,
        vec![Effect::NotifySetup {
            outcome: SetupOutcome::Ready,
        }]
    );
}

#[test]
fn reconnecting_after_setup_tells_nobody() {
    let (ready, _) = apply(&setting_up(), Event::MacrodConnected, now());
    assert!(ready.setup.as_ref().unwrap().complete());

    let (dropped, effects) = apply(&ready, Event::MacrodDisconnected, now());
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
    let (reconnected, effects) = apply(&dropped, Event::MacrodConnected, now());
    assert_eq!(reconnected.phase, Phase::Running);
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());

    // Power cycle: off, stopped, on, booted again.
    let (stopping, _) = apply(&reconnected, Event::PowerOff, now());
    let (stopped, _) = apply(&stopping, Event::InstanceStopped, now());
    let (booting, _) = apply(&stopped, Event::PowerOn, now());
    assert_eq!(booting.phase, Phase::Booting);
    let (running, effects) = apply(&booting, Event::MacrodConnected, now());
    assert_eq!(running.phase, Phase::Running);
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
}

#[test]
fn setup_that_gives_up_tells_the_buyer_why_once() {
    let (failed, effects) = apply(
        &setting_up(),
        Event::EffectFailed {
            failure: Failure::Power,
            reason: "start refused".to_owned(),
        },
        now(),
    );

    assert_eq!(
        failed.phase,
        Phase::Crashed {
            restarts: 0,
            retry: None,
        }
    );
    assert_eq!(
        effects,
        vec![
            Effect::PageOperator {
                reason: "start refused".to_owned(),
            },
            Effect::NotifySetup {
                outcome: SetupOutcome::Failed {
                    failure: Failure::Power,
                    failed_at: now(),
                },
            },
        ]
    );

    // A failed computer that fails again (another effect, a lost host) has
    // already told the buyer.
    let (_, effects) = apply(&failed, Event::HostLost, now() + Duration::minutes(1));
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
}

#[test]
fn setup_that_keeps_crashing_tells_the_buyer_when_it_gives_up() {
    let mut state = setting_up();
    let mut notices = Vec::new();
    let mut at = now();
    for _ in 0..MAX_CRASHES {
        let (next, effects) = apply(&state, Event::VmCrashed, at);
        notices.extend(setup_notices(&effects).into_iter().cloned());
        state = next;
        if let Phase::Crashed {
            retry: Some(retry), ..
        } = state.phase
        {
            at = retry.next_at;
            let (booting, effects) = apply(&state, Event::RestartDue, at);
            notices.extend(setup_notices(&effects).into_iter().cloned());
            state = booting;
        }
    }

    assert_eq!(state.failure, Some(Failure::KeptCrashing));
    assert_eq!(notices.len(), 1);
    assert!(matches!(
        notices[0],
        SetupOutcome::Failed {
            failure: Failure::KeptCrashing,
            ..
        }
    ));
}

#[test]
fn a_set_up_computer_that_fails_tells_nobody() {
    let (ready, _) = apply(&setting_up(), Event::MacrodConnected, now());

    let (failed, effects) = apply(&ready, Event::HostLost, now() + Duration::days(3));

    assert_eq!(failed.failure, Some(Failure::HostLost));
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
}

#[test]
fn a_retried_setup_that_fails_again_tells_the_buyer_again() {
    let first_at = now();
    let (failed, effects) = apply(
        &setting_up(),
        Event::EffectFailed {
            failure: Failure::Create,
            reason: "create failed".to_owned(),
        },
        first_at,
    );
    let first = setup_notices(&effects)[0].clone();

    let (retried, effects) = apply(&failed, Event::TeamRetry, first_at + Duration::minutes(5));
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
    let second_at = first_at + Duration::minutes(6);
    let (_, effects) = apply(
        &retried,
        Event::EffectFailed {
            failure: Failure::Power,
            reason: "start refused".to_owned(),
        },
        second_at,
    );

    assert_eq!(
        setup_notices(&effects),
        vec![&SetupOutcome::Failed {
            failure: Failure::Power,
            failed_at: second_at,
        }]
    );
    assert_ne!(&first, setup_notices(&effects)[0]);
}

#[test]
fn a_computer_from_before_setup_timelines_tells_nobody() {
    let (_, effects) = apply(&billed(Phase::Booting), Event::MacrodConnected, now());
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());

    let (_, effects) = apply(&billed(Phase::Booting), Event::HostLost, now());
    assert_eq!(setup_notices(&effects), Vec::<&SetupOutcome>::new());
}

#[test]
fn a_setup_notice_round_trips_through_the_outbox() {
    let effect = Effect::NotifySetup {
        outcome: SetupOutcome::Failed {
            failure: Failure::KeptCrashing,
            failed_at: now(),
        },
    };

    let stored = serde_json::to_value(&effect).unwrap();

    assert_eq!(
        stored,
        serde_json::json!({
            "effect": "notify_setup",
            "outcome": {
                "outcome": "failed",
                "failure": "kept_crashing",
                "failed_at": "2026-11-04T12:00:00Z",
            },
        })
    );
    assert_eq!(serde_json::from_value::<Effect>(stored).unwrap(), effect);
    assert_eq!(effect.worker(), EffectWorker::Fleet);
}
