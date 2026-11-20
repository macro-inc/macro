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

/// The OpenAPI schema names each `computer` field as serde reads it, so a
/// client generated from the schema sends a body the route accepts.
#[cfg(feature = "inbound")]
#[test]
fn every_invite_computer_field_the_schema_names_deserializes() {
    use utoipa::PartialSchema;
    let schema = serde_json::to_value(InviteComputer::schema()).unwrap();
    let variants = schema["oneOf"].as_array().unwrap();
    let field = |kind: &str| {
        let variant = variants
            .iter()
            .find(|variant| variant["properties"]["kind"]["enum"][0] == kind)
            .unwrap_or_else(|| panic!("no {kind} variant in {schema:#}"));
        variant["properties"]
            .as_object()
            .unwrap()
            .keys()
            .find(|name| *name != "kind")
            .unwrap()
            .clone()
    };
    let own: InviteComputer = serde_json::from_value(serde_json::json!({
        "kind": "own",
        field("own"): "0193a1b2-0000-7000-8000-000000000001",
    }))
    .unwrap();
    assert_eq!(field("own"), "harnessId");
    assert!(matches!(own, InviteComputer::Own { .. }));
    let new: InviteComputer = serde_json::from_value(serde_json::json!({
        "kind": "new",
        field("new"): "standard",
    }))
    .unwrap();
    assert!(matches!(new, InviteComputer::New { .. }));
}
