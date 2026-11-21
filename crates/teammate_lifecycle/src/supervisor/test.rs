use std::time::Duration;

use chrono::{DateTime, Utc};

use super::*;
use crate::boot::{self, BootInput, BootState, BootStep, CodeFacts, CommitId};

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

fn exited(code: u8) -> ExitEvent {
    ExitEvent {
        code: Some(code),
        requested: false,
    }
}

#[test]
fn a_restart_after_a_land_starts_at_once() {
    let mut policy = PolicyState::default();
    assert_eq!(policy.started(at(0)), PreviousExit::Unknown);
    assert_eq!(
        policy.exited(exited(75), at(30)),
        Action::Start {
            after: Duration::ZERO,
            previous: PreviousExit::Exited { code: 75 },
        }
    );
    assert_eq!(policy.started(at(30)), PreviousExit::Exited { code: 75 });
}

#[test]
fn a_requested_stop_is_stopped_whatever_its_code() {
    let mut policy = PolicyState::default();
    policy.started(at(0));
    let stop = ExitEvent {
        code: Some(143),
        requested: true,
    };
    assert_eq!(policy.exited(stop, at(10)), Action::Stopped);
    // The next start (a replacement image) sees a clean stop.
    assert_eq!(policy.started(at(11)), PreviousExit::Exited { code: 0 });
}

#[test]
fn an_unrequested_0_waits_2_s_then_the_rate_cap_slows_it_to_60_s() {
    let mut policy = PolicyState::default();
    let mut now = 0;
    let mut delays = Vec::new();
    for _ in 0..12 {
        policy.started(at(now));
        now += 1;
        let Action::Start { after, .. } = policy.exited(exited(0), at(now)) else {
            panic!("not started again");
        };
        delays.push(after.as_secs());
        now += i64::try_from(after.as_secs()).unwrap();
    }
    assert_eq!(delays, [2, 2, 2, 2, 2, 2, 2, 2, 2, 60, 60, 60]);
}

#[test]
fn crashes_back_off_from_2_to_60_s_and_forget_after_10_minutes() {
    let mut policy = PolicyState::default();
    let mut delays = Vec::new();
    let mut now = 0;
    for _ in 0..7 {
        policy.started(at(now));
        let Action::Start { after, previous } = policy.exited(exited(1), at(now)) else {
            panic!("not started again");
        };
        assert_eq!(previous, PreviousExit::Exited { code: 1 });
        delays.push(after.as_secs());
        now += i64::try_from(after.as_secs()).unwrap();
    }
    assert_eq!(delays, [2, 4, 8, 16, 32, 60, 60]);

    // Quiet for over 10 minutes: the next crash starts over.
    now += 11 * 60;
    policy.started(at(now));
    assert_eq!(
        policy.exited(exited(1), at(now + 3600)),
        Action::Start {
            after: Duration::from_secs(2),
            previous: PreviousExit::Exited { code: 1 },
        }
    );
}

#[test]
fn a_bad_setting_backs_off_like_a_crash() {
    let mut policy = PolicyState::default();
    policy.started(at(0));
    assert_eq!(
        policy.exited(exited(78), at(5)),
        Action::Start {
            after: Duration::from_secs(2),
            previous: PreviousExit::Exited { code: 78 },
        }
    );
}

#[test]
fn the_terminal_codes_are_not_restarted_until_a_new_delivery() {
    let mut policy = PolicyState::default();
    policy.started(at(0));
    assert_eq!(
        policy.exited(exited(79), at(5)),
        Action::Failed(Terminal::IncompatibleRuntime)
    );
    assert_eq!(policy.resume(false, at(6)), Action::Nothing);
    assert_eq!(
        policy.redelivered(at(7)),
        Action::Start {
            after: Duration::ZERO,
            previous: PreviousExit::Exited { code: 79 },
        }
    );

    policy.started(at(7));
    assert_eq!(
        policy.exited(exited(77), at(9)),
        Action::Failed(Terminal::BadConfiguration)
    );
}

#[test]
fn macrod_restarting_adopts_a_running_container() {
    let mut policy = PolicyState::default();
    policy.started(at(0));
    assert_eq!(policy.resume(true, at(100)), Action::Adopt);
    // Its exit is then seen, and counted once.
    assert_eq!(
        policy.exited(exited(1), at(200)),
        Action::Start {
            after: Duration::from_secs(2),
            previous: PreviousExit::Exited { code: 1 },
        }
    );
}

#[test]
fn macrod_restarting_after_the_agent_died_passes_unknown() {
    let mut policy = PolicyState::default();
    policy.started(at(0));
    assert_eq!(
        policy.resume(false, at(100)),
        Action::Start {
            after: Duration::from_secs(2),
            previous: PreviousExit::Unknown,
        }
    );
}

#[test]
fn a_reexec_in_the_middle_of_a_backoff_keeps_it() {
    let mut policy = PolicyState::default();
    for now in [0, 2, 6] {
        policy.started(at(now));
        policy.exited(exited(1), at(now));
    }
    // 8 s to wait from 6; macrod restarts at 10, through the store.
    let stored = serde_json::to_string(&policy).unwrap();
    let mut resumed: PolicyState = serde_json::from_str(&stored).unwrap();
    assert_eq!(
        resumed.resume(false, at(10)),
        Action::Start {
            after: Duration::from_secs(4),
            previous: PreviousExit::Exited { code: 1 },
        }
    );
    resumed.started(at(14));
    assert_eq!(
        resumed.exited(exited(1), at(14)),
        Action::Start {
            after: Duration::from_secs(16),
            previous: PreviousExit::Exited { code: 1 },
        }
    );
}

#[test]
fn the_kept_history_is_bounded() {
    let mut policy = PolicyState::default();
    for now in 0..1000 {
        policy.started(at(now));
        policy.exited(exited(75), at(now));
    }
    let stored = serde_json::to_string(&policy).unwrap();
    assert!(stored.len() < 4096, "{} bytes", stored.len());
}

/// The supervisor and `teammate-boot` together: a land whose code exits 78
/// on every start is rolled back on the fourth start, and the supervisor
/// never gives up first.
#[test]
fn a_land_that_breaks_its_settings_rolls_back_on_the_fourth_start() {
    let good = CommitId::new("a".repeat(40)).unwrap();
    let land = CommitId::new("b".repeat(40)).unwrap();
    let fits = CodeFacts {
        needs: Ok(1),
        lock_matches_image: true,
        dependencies_edited: false,
    };
    let mut boot_state = BootState {
        failed_boots: 0,
        boot_head: Some(good.clone()),
        last_good: Some(good.clone()),
    };
    let mut policy = PolicyState::default();
    let mut now = 0;
    // The healthy run of last-good that landed the change.
    policy.started(at(now));
    let Action::Start { after, .. } = policy.exited(exited(75), at(now)) else {
        panic!("a land is started again");
    };
    assert_eq!(after, Duration::ZERO);

    let mut head = land.clone();
    for start in 1..=4 {
        let previous = policy.started(at(now));
        boot_state.failed_boots = boot::count_previous(&boot_state, previous);
        assert_eq!(boot::admit(&boot_state, previous, &Ok(())), Ok(()));
        let plan = boot::plan_boot(&BootInput {
            failed_boots: boot_state.failed_boots,
            head: head.clone(),
            head_code: fits.clone(),
            last_good: Some((good.clone(), fits.clone())),
            image_level: Ok(1),
        });
        if let Some(BootStep::RollBack { .. }) = plan.steps.first() {
            assert_eq!(start, 4);
            head = good.clone();
            break;
        }
        boot_state.boot_head = Some(head.clone());
        // The land's runtime finds its settings wrong.
        let action = policy.exited(exited(78), at(now));
        let Action::Start { after, .. } = action else {
            panic!("start {start}: gave up with {action:?}");
        };
        now += i64::try_from(after.as_secs()).unwrap();
    }
    assert_eq!(head, good);
    // Last-good runs; its healthy boot resets the count.
    boot_state.boot_head = Some(good.clone());
    assert_eq!(
        boot::count_previous(&boot_state, PreviousExit::Exited { code: 1 }),
        0
    );
}

#[test]
fn a_clock_stepped_back_drops_the_times_after_it() {
    let mut policy = PolicyState::default();
    // Ten starts an hour ahead of the clock (it was wrong, then corrected).
    for second in 0..10 {
        policy.started(at(3600 + second));
        policy.exited(exited(1), at(3600 + second));
    }
    policy.started(at(0));
    // Neither the rate cap nor the backoff of those times applies, and the
    // wait is never an hour.
    assert_eq!(
        policy.exited(exited(1), at(1)),
        Action::Start {
            after: Duration::from_secs(2),
            previous: PreviousExit::Exited { code: 1 },
        }
    );
    let mut waiting = PolicyState::default();
    waiting.started(at(3600));
    waiting.exited(exited(1), at(3600));
    let Action::Start { after, .. } = waiting.resume(false, at(0)) else {
        panic!("not started");
    };
    assert!(after <= MAX_BACKOFF, "{after:?}");
}
