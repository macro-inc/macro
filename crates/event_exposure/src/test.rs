use super::*;
use macro_user_id::cowlike::CowLike as _;

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

#[test]
fn audiences_round_trip_through_their_wire_shape() {
    let user = MacroUserIdStr::parse_from_str("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let audience = Audience::Any(vec![
        Audience::Entity {
            entity_type: EntityType::AgentSession,
            entity_id: "s".to_owned(),
        },
        Audience::Owner {
            user_id: user.clone(),
        },
        Audience::Team {
            team_id: Uuid::nil(),
            min_role: MinTeamRole::Admin,
        },
        Audience::GithubInstallation {
            installation_id: "42".to_owned(),
        },
        Audience::Snapshot {
            user_ids: vec![user],
        },
    ]);
    let wire = serde_json::json!({
        "class": "any",
        "rule": [
            {"class": "entity", "rule": {"entity_type": "agent_session", "entity_id": "s"}},
            {"class": "owner", "rule": {"user_id": "macro|owner@example.com"}},
            {"class": "team", "rule": {"team_id": "00000000-0000-0000-0000-000000000000", "min_role": "admin"}},
            {"class": "github_installation", "rule": {"installation_id": "42"}},
            {"class": "snapshot", "rule": {"user_ids": ["macro|owner@example.com"]}},
        ],
    });

    assert_eq!(serde_json::to_value(&audience).unwrap(), wire);
    assert_eq!(serde_json::from_value::<Audience>(wire).unwrap(), audience);
    assert_eq!(serde_json::to_value(Stage::Preview).unwrap(), "preview");
}
