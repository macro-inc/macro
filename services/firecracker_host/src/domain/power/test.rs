use firecracker_host_api::{Action, PowerState};

use super::{NotApplicable, Step, after, plan};

const STATES: [PowerState; 4] = [
    PowerState::Running,
    PowerState::Paused,
    PowerState::Hibernated,
    PowerState::Stopped,
];

const ACTIONS: [Action; 6] = [
    Action::Start,
    Action::Stop,
    Action::Restart,
    Action::Freeze,
    Action::Unfreeze,
    Action::Hibernate,
];

fn target(action: Action) -> PowerState {
    match action {
        Action::Start | Action::Restart | Action::Unfreeze => PowerState::Running,
        Action::Stop => PowerState::Stopped,
        Action::Freeze => PowerState::Paused,
        Action::Hibernate => PowerState::Hibernated,
    }
}

/// Which steps can run from a state: a step needing a process never runs
/// without one, and a process is never started over a live one.
fn runs_from(step: Step, state: PowerState) -> bool {
    match step {
        Step::Boot => state == PowerState::Stopped,
        Step::Wake | Step::DiscardHibernation => state == PowerState::Hibernated,
        Step::Resume | Step::Hibernate => state == PowerState::Paused,
        Step::Pause => state == PowerState::Running,
        Step::Shutdown => state == PowerState::Running,
    }
}

#[test]
fn every_plan_is_runnable_step_by_step_and_ends_at_the_action_target() {
    for state in STATES {
        for action in ACTIONS {
            let Ok(steps) = plan(state, action) else {
                continue;
            };
            let mut current = state;
            for &step in steps {
                assert!(
                    runs_from(step, current),
                    "{action:?} from {state}: {step:?} from {current}"
                );
                current = after(step);
            }
            assert_eq!(current, target(action), "{action:?} from {state}");
        }
    }
}

/// Restart reboots every time it is asked, as Incus does.
#[test]
fn repeating_an_action_other_than_restart_does_nothing_the_second_time() {
    for state in STATES {
        for action in ACTIONS {
            if action != Action::Restart && plan(state, action).is_ok() {
                assert_eq!(
                    plan(target(action), action),
                    Ok(&[][..]),
                    "{action:?} from {state}"
                );
            }
        }
    }
}

#[test]
fn freezing_or_unfreezing_a_guest_without_memory_is_refused() {
    assert_eq!(
        plan(PowerState::Stopped, Action::Freeze),
        Err(NotApplicable {
            state: PowerState::Stopped,
            action: Action::Freeze
        })
    );
    assert!(plan(PowerState::Hibernated, Action::Unfreeze).is_err());
    assert!(plan(PowerState::Stopped, Action::Hibernate).is_err());
}

#[test]
fn restart_always_ends_with_a_fresh_boot() {
    for state in STATES {
        assert_eq!(
            plan(state, Action::Restart).unwrap().last(),
            Some(&Step::Boot),
            "{state}"
        );
    }
}
