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
    assert_eq!(
        PublicEntityType::GithubPullRequest.as_str(),
        "github_pull_request"
    );
    assert_eq!(PublicEntityType::EmailLink.as_str(), "email_link");
    assert_eq!(PublicEntityType::Notification.as_str(), "notification");
    assert_eq!(PublicEntityType::Property.as_str(), "property");
    assert_eq!(
        PublicEntityType::GithubInstallation.as_str(),
        "github_installation"
    );
}

#[test]
fn parse_user_id_accepts_macro_ids_and_rejects_others() {
    assert_eq!(
        parse_user_id("macro|owner@example.com").unwrap().as_ref(),
        "macro|owner@example.com"
    );
    assert_eq!(
        parse_user_id("bot|1234"),
        Err(ExposureError::InvalidEntityId {
            entity_type: "user",
            entity_id: "bot|1234".to_owned(),
        })
    );
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
        Audience::EntityAtLeast {
            entity_type: EntityType::Form,
            entity_id: "f".to_owned(),
            min_level: MinAccessLevel::Edit,
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
            {"class": "entity_at_least", "rule": {"entity_type": "form", "entity_id": "f", "min_level": "edit"}},
            {"class": "snapshot", "rule": {"user_ids": ["macro|owner@example.com"]}},
        ],
    });

    assert_eq!(serde_json::to_value(&audience).unwrap(), wire);
    assert_eq!(serde_json::from_value::<Audience>(wire).unwrap(), audience);
    assert_eq!(serde_json::to_value(Stage::Preview).unwrap(), "preview");
}
