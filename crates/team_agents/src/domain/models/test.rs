use chrono::Duration;

use super::*;

#[test]
fn an_unhealthy_computer_makes_its_agent_unhealthy_whether_or_not_it_came_online() {
    assert_eq!(
        TeamAgentStatus::of(ComputerState::Unhealthy, true),
        TeamAgentStatus::Unhealthy
    );
    assert_eq!(
        TeamAgentStatus::of(ComputerState::Unhealthy, false),
        TeamAgentStatus::Unhealthy
    );
}

#[test]
fn an_agent_without_a_computer_is_provisioning_until_its_invite_counts_as_dead() {
    let created_at = Utc::now();
    assert_eq!(
        TeamAgentStatus::without_computer(created_at, created_at + Duration::minutes(9)),
        TeamAgentStatus::Provisioning
    );
    assert_eq!(
        TeamAgentStatus::without_computer(created_at, created_at + ORPHANED_INVITE_AFTER),
        TeamAgentStatus::Failed
    );
}
