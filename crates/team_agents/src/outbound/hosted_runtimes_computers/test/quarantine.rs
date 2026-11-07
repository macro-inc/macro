use super::*;
use hosted_runtimes::domain::models::{ComputerDisplayMetadata, SanitizedReason};

#[test]
fn quarantined_payment_never_becomes_an_actionable_agent_payment() {
    let computer = ComputerRecord::NeedsAttention {
        id: ComputerId::new_from_uuid(Uuid::from_u128(0xc0de)),
        team_id: TEAM,
        host_id: Some(HOST),
        reason: SanitizedReason::new("persona config contains reserved credential keys"),
        display: ComputerDisplayMetadata {
            name: "Agent".to_owned(),
            size: "standard".to_owned(),
            vcpus: 4,
            memory_gib: 8,
            disk_gib: 100,
            catalog_entry: "fixture-v1".to_owned(),
            created_at: now(),
        },
    };
    let status = computer.status();
    assert_eq!(status.payment, None);
    assert!(matches!(
        super::super::computer_status(status),
        Err(agent::TeamAgentError::ComputerUnavailable(reason))
            if reason.contains("needs attention")
    ));
}
