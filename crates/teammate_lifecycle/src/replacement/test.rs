use chrono::{DateTime, Utc};

use super::*;
use crate::supervisor::ExitEvent;

fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(1_800_000_000 + seconds, 0).unwrap()
}

fn crashed() -> ExitEvent {
    ExitEvent {
        code: Some(1),
        requested: false,
    }
}

#[test]
fn a_verified_image_up_for_120_s_replaces_the_old_one() {
    let mut update = ImageUpdate::new(Some("old"), "new");
    assert_eq!(
        update.fetched(Fetch::Verified),
        UpdateAction::Run {
            image: "new",
            status: UpdateStatus::Trying,
        }
    );
    update.started(at(0));
    assert!(!update.settle(at(119)));
    assert!(update.settle(at(120)));
    assert_eq!(update.running(), &"new");
    // Settled: a later crash is the supervisor's, not a rollback.
    assert_eq!(update.exited(crashed(), at(130)), UpdateAction::Continue);
}

#[test]
fn an_image_that_cannot_be_fetched_runs_the_previous_one() {
    for (fetch, reason) in [
        (Fetch::Unavailable, UpdateFailure::ImageUnavailable),
        (Fetch::Mismatch, UpdateFailure::ImageMismatch),
    ] {
        let mut update = ImageUpdate::new(Some("old"), "new");
        assert_eq!(
            update.fetched(fetch),
            UpdateAction::Run {
                image: "old",
                status: UpdateStatus::RolledBack(reason),
            }
        );
        assert_eq!(update.running(), &"old");
    }
}

#[test]
fn a_first_image_that_cannot_be_fetched_fails() {
    let mut update = ImageUpdate::new(None, "new");
    assert_eq!(
        update.fetched(Fetch::Unavailable),
        UpdateAction::Fail(UpdateFailure::ImageUnavailable)
    );
}

#[test]
fn a_new_image_that_dies_within_120_s_rolls_back_once() {
    let mut update = ImageUpdate::new(Some("old"), "new");
    update.fetched(Fetch::Verified);
    update.started(at(0));
    assert_eq!(
        update.exited(crashed(), at(30)),
        UpdateAction::Run {
            image: "old",
            status: UpdateStatus::RolledBack(UpdateFailure::CrashLoop),
        }
    );
    assert_eq!(update.running(), &"old");
    // The previous image crashing too is the supervisor's: no ping-pong.
    update.started(at(31));
    assert_eq!(update.exited(crashed(), at(40)), UpdateAction::Continue);
}

#[test]
fn exits_in_the_trial_that_are_not_crashes_continue() {
    for code in [0, 75, 77, 79] {
        let mut update = ImageUpdate::new(Some("old"), "new");
        update.fetched(Fetch::Verified);
        update.started(at(0));
        let exit = ExitEvent {
            code: Some(code),
            requested: false,
        };
        assert_eq!(
            update.exited(exit, at(10)),
            UpdateAction::Continue,
            "{code}"
        );
    }
    let mut update = ImageUpdate::new(Some("old"), "new");
    update.fetched(Fetch::Verified);
    update.started(at(0));
    let stop = ExitEvent {
        code: Some(1),
        requested: true,
    };
    assert_eq!(update.exited(stop, at(10)), UpdateAction::Continue);
}

#[test]
fn a_restart_in_the_trial_keeps_its_clock() {
    let mut update = ImageUpdate::new(Some("old"), "new");
    update.fetched(Fetch::Verified);
    update.started(at(0));
    let land = ExitEvent {
        code: Some(75),
        requested: false,
    };
    update.exited(land, at(100));
    update.started(at(100));
    assert!(update.settle(at(120)));
}

#[test]
fn a_lost_process_in_the_trial_rolls_back() {
    let mut update = ImageUpdate::new(Some("old"), "new");
    update.fetched(Fetch::Verified);
    update.started(at(0));
    let lost = ExitEvent {
        code: None,
        requested: false,
    };
    assert_eq!(
        update.exited(lost, at(5)),
        UpdateAction::Run {
            image: "old",
            status: UpdateStatus::RolledBack(UpdateFailure::CrashLoop),
        }
    );
}

#[test]
fn the_update_survives_a_macrod_restart() {
    let mut update = ImageUpdate::new(Some("old".to_owned()), "new".to_owned());
    update.fetched(Fetch::Verified);
    update.started(at(0));
    let stored = serde_json::to_string(&update).unwrap();
    let mut resumed: ImageUpdate<String> = serde_json::from_str(&stored).unwrap();
    assert_eq!(
        resumed.exited(crashed(), at(60)),
        UpdateAction::Run {
            image: "old".to_owned(),
            status: UpdateStatus::RolledBack(UpdateFailure::CrashLoop),
        }
    );
}

#[test]
fn a_redelivery_of_the_same_image_has_no_trial() {
    let mut update = ImageUpdate::new(Some("same"), "same");
    assert_eq!(
        update.fetched(Fetch::Verified),
        UpdateAction::Run {
            image: "same",
            status: UpdateStatus::Trying,
        }
    );
    update.started(at(0));
    assert!(update.settle(at(0)));
    assert_eq!(update.exited(crashed(), at(5)), UpdateAction::Continue);
}

#[test]
fn a_first_image_that_crashes_is_the_supervisors() {
    let mut update = ImageUpdate::new(None, "new");
    update.fetched(Fetch::Verified);
    update.started(at(0));
    assert_eq!(update.exited(crashed(), at(5)), UpdateAction::Continue);
}
