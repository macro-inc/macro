//! What the team sees for a computer past its first connection whose macrod
//! went missing: healthy through a reconnect flap, unhealthy once a fleet
//! check found it gone, and still setting up before it ever connected.

use super::*;

fn status(
    phase: Phase,
    macrod_connected: bool,
    macrod_misses: u8,
    enrolled: bool,
) -> ComputerStatusKind {
    let mut computer = computer(
        ComputerId::new_from_uuid(Uuid::from_u128(7)),
        phase,
        BillingState::Comped {
            reason: "test".to_owned(),
        },
    );
    computer.state.macrod_connected = macrod_connected;
    computer.state.macrod_misses = macrod_misses;
    if !enrolled {
        computer.enrolled_at = None;
    }
    computer.status(0, now(), policy()).status
}

fn crashed_restarting() -> Phase {
    Phase::Crashed {
        restarts: 1,
        retry: Some(crate::domain::lifecycle::Retry::after(
            crate::domain::lifecycle::RESTART_BACKOFF,
            0,
            now(),
        )),
    }
}

#[test]
fn a_running_computer_reads_ready_until_a_check_finds_macrod_missing() {
    assert_eq!(
        status(Phase::Running, true, 0, true),
        ComputerStatusKind::Ready
    );
    assert_eq!(
        status(Phase::Running, false, 0, true),
        ComputerStatusKind::Ready
    );
    assert_eq!(
        status(Phase::Running, false, 1, true),
        ComputerStatusKind::Unhealthy
    );
    assert_eq!(
        status(Phase::Running, false, 3, true),
        ComputerStatusKind::Unhealthy
    );
}

#[test]
fn a_crashed_computer_restarting_reads_unhealthy_after_setup() {
    assert_eq!(
        status(crashed_restarting(), false, 0, true),
        ComputerStatusKind::Unhealthy
    );
    assert_eq!(
        status(crashed_restarting(), false, 0, false),
        ComputerStatusKind::SettingUp
    );
}

#[test]
fn a_computer_that_gave_up_reads_failed() {
    assert_eq!(
        status(
            Phase::Crashed {
                restarts: 0,
                retry: None
            },
            false,
            0,
            true
        ),
        ComputerStatusKind::Failed
    );
}

/// Relief hibernated it: its macrod is gone and fleet checks count misses,
/// but a prompt wakes it, so the team sees it ready, as before.
#[test]
fn a_hibernated_computer_without_macrod_reads_ready_where_an_awake_one_is_unhealthy() {
    let mut computer = computer(
        ComputerId::new_from_uuid(Uuid::from_u128(7)),
        Phase::Running,
        BillingState::Comped {
            reason: "test".to_owned(),
        },
    );
    computer.state.macrod_connected = false;
    computer.state.macrod_misses = crate::domain::lifecycle::MAX_MACROD_MISSES;
    assert_eq!(
        computer.status(0, now(), policy()).status,
        ComputerStatusKind::Unhealthy
    );

    computer.hibernated_at = Some(now() - chrono::Duration::minutes(30));

    assert_eq!(
        computer.status(0, now(), policy()).status,
        ComputerStatusKind::Ready
    );
}

fn booting_with(recent_crashes: Vec<DateTime<Utc>>, macrod_misses: u8) -> ComputerStatusKind {
    let mut computer = computer(
        ComputerId::new_from_uuid(Uuid::from_u128(7)),
        Phase::Booting,
        BillingState::Comped {
            reason: "test".to_owned(),
        },
    );
    computer.state.recent_crashes = recent_crashes;
    computer.state.macrod_misses = macrod_misses;
    computer.status(0, now(), policy()).status
}

/// The restart a crash schedules boots the guest again: still unhealthy
/// until macrod connects, not Starting (which the agent shows as Paused).
#[test]
fn a_computer_booting_again_after_a_crash_reads_unhealthy() {
    assert_eq!(
        booting_with(vec![now() - chrono::Duration::minutes(1)], 0),
        ComputerStatusKind::Unhealthy
    );
}

/// A boot whose macrod never dials only counts misses: it reads unhealthy
/// from the first one instead of Starting forever.
#[test]
fn a_boot_whose_macrod_missed_a_check_reads_unhealthy() {
    assert_eq!(booting_with(vec![], 1), ComputerStatusKind::Unhealthy);
}

/// A power-on or a move with no crash inside the window, or a retry (which
/// clears the crashes), boots with no miss and reads Starting.
#[test]
fn a_computer_booting_after_a_power_on_reads_starting() {
    assert_eq!(booting_with(vec![], 0), ComputerStatusKind::Starting);
    assert_eq!(
        booting_with(
            vec![now() - crate::domain::lifecycle::CRASH_WINDOW - chrono::Duration::minutes(1)],
            0
        ),
        ComputerStatusKind::Starting
    );
}
