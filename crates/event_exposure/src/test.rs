use super::*;

#[test]
fn public_entity_types_use_entity_wire_names() {
    assert_eq!(
        PublicEntityType::from(EntityType::AgentSession).as_str(),
        "agent_session"
    );
    assert_eq!(
        PublicEntityType::from(EntityType::CrmCompany).as_str(),
        "crm_company"
    );
    assert_eq!(PublicEntityType::Bot.as_str(), "bot");
    assert_eq!(PublicEntityType::Webhook.as_str(), "webhook");
}

#[test]
fn internal_reasons_name_their_phase() {
    assert_eq!(
        InternalReason::ByDesign("cache patches").to_string(),
        "internal by design: cache patches"
    );
    assert_eq!(
        InternalReason::PendingFamily {
            phase: PendingPhase::ProducerChange,
            note: "needs an audience snapshot",
        }
        .to_string(),
        "pending public family: phase 7: needs an audience snapshot"
    );
}
