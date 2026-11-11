use hosted_runtimes::domain::models::ComputerStatusKind;

use super::*;

#[test]
fn an_attached_computer_maps_to_the_agents_state() {
    for (kind, state) in [
        (ComputerStatusKind::SettingUp, ComputerState::SettingUp),
        (ComputerStatusKind::Ready, ComputerState::Ready),
        (
            ComputerStatusKind::WaitingForCapacity,
            ComputerState::Paused,
        ),
        (ComputerStatusKind::Starting, ComputerState::Paused),
        (ComputerStatusKind::Stopping, ComputerState::Paused),
        (ComputerStatusKind::Stopped, ComputerState::Paused),
        (ComputerStatusKind::NeedsAttention, ComputerState::Failed),
        (ComputerStatusKind::Failed, ComputerState::Failed),
        (ComputerStatusKind::Released, ComputerState::Released),
        (ComputerStatusKind::Purchasing, ComputerState::Purchasing),
    ] {
        assert_eq!(
            computer_state(kind, FleetAttachment::Attached),
            state,
            "{kind:?}"
        );
    }
}

#[test]
fn without_a_fleet_a_live_computer_is_paused_but_terminal_ones_stay() {
    assert_eq!(
        computer_state(ComputerStatusKind::Ready, FleetAttachment::Detached),
        ComputerState::Paused
    );
    assert_eq!(
        computer_state(ComputerStatusKind::Failed, FleetAttachment::Detached),
        ComputerState::Failed
    );
    assert_eq!(
        computer_state(ComputerStatusKind::Released, FleetAttachment::Detached),
        ComputerState::Released
    );
}
