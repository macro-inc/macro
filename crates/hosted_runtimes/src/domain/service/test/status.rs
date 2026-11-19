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
