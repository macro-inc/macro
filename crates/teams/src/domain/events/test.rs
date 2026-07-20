use macro_event_broker::{Event, MacroEvent};
use macro_event_topics::Topic;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

const TEAM_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const INVITE_ID: &str = "0197f776-6e7b-7c69-a251-780ae754d3e4";
const EVENT_ID: &str = "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f";

fn team_id() -> Uuid {
    Uuid::parse_str(TEAM_ID).expect("valid team id")
}

fn invite_id() -> Uuid {
    Uuid::parse_str(INVITE_ID).expect("valid invite id")
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn topic_events() -> Vec<(TeamTopicEvent, Value)> {
    vec![
        (
            TeamTopicEvent::Created(TeamCreatedMetadata {
                team_id: team_id(),
                name: "Acme".to_string(),
                slug: "acme".to_string(),
                owner: user_id("macro|owner@acme.com"),
                enterprise: true,
                paid: true,
                auto_join_domain: Some("acme.com".to_string()),
            }),
            json!({
                "event_type": "team.created",
                "metadata": {
                    "team_id": TEAM_ID,
                    "name": "Acme",
                    "slug": "acme",
                    "owner": "macro|owner@acme.com",
                    "enterprise": true,
                    "paid": true,
                    "auto_join_domain": "acme.com"
                }
            }),
        ),
        (
            TeamTopicEvent::Updated(TeamUpdatedMetadata {
                team_id: team_id(),
                actor_user_id: user_id("macro|admin@acme.com"),
                name: Some("Acme Inc".to_string()),
                slug: None,
            }),
            json!({
                "event_type": "team.updated",
                "metadata": {
                    "team_id": TEAM_ID,
                    "actor_user_id": "macro|admin@acme.com",
                    "name": "Acme Inc",
                    "slug": null
                }
            }),
        ),
        (
            TeamTopicEvent::Deleted(TeamDeletedMetadata {
                team_id: team_id(),
                actor_user_id: user_id("macro|owner@acme.com"),
                member_user_ids: vec![
                    user_id("macro|owner@acme.com"),
                    user_id("macro|member@acme.com"),
                ],
            }),
            json!({
                "event_type": "team.deleted",
                "metadata": {
                    "team_id": TEAM_ID,
                    "actor_user_id": "macro|owner@acme.com",
                    "member_user_ids": ["macro|owner@acme.com", "macro|member@acme.com"]
                }
            }),
        ),
        (
            TeamTopicEvent::InviteCreated(TeamInviteCreatedMetadata {
                team_id: team_id(),
                invite_id: invite_id(),
                email: "invitee@acme.com".to_string(),
                invited_by: user_id("macro|admin@acme.com"),
                team_name: Some("Acme".to_string()),
            }),
            json!({
                "event_type": "team.invite_created",
                "metadata": {
                    "team_id": TEAM_ID,
                    "invite_id": INVITE_ID,
                    "email": "invitee@acme.com",
                    "invited_by": "macro|admin@acme.com",
                    "team_name": "Acme"
                }
            }),
        ),
        (
            TeamTopicEvent::InviteRejected(TeamInviteRejectedMetadata {
                team_id: team_id(),
                invite_id: invite_id(),
                email: "invitee@acme.com".to_string(),
                actor_user_id: user_id("macro|invitee@acme.com"),
            }),
            json!({
                "event_type": "team.invite_rejected",
                "metadata": {
                    "team_id": TEAM_ID,
                    "invite_id": INVITE_ID,
                    "email": "invitee@acme.com",
                    "actor_user_id": "macro|invitee@acme.com"
                }
            }),
        ),
        (
            TeamTopicEvent::InviteRevoked(TeamInviteRevokedMetadata {
                team_id: team_id(),
                invite_id: invite_id(),
                email: "invitee@acme.com".to_string(),
                actor_user_id: user_id("macro|admin@acme.com"),
            }),
            json!({
                "event_type": "team.invite_revoked",
                "metadata": {
                    "team_id": TEAM_ID,
                    "invite_id": INVITE_ID,
                    "email": "invitee@acme.com",
                    "actor_user_id": "macro|admin@acme.com"
                }
            }),
        ),
        (
            TeamTopicEvent::MemberJoined(TeamMemberJoinedMetadata {
                team_id: team_id(),
                member_id: user_id("macro|member@acme.com"),
                role: TeamRole::Member,
                join_method: TeamJoinMethod::InviteAccepted {
                    invite_id: invite_id(),
                    invited_by: user_id("macro|admin@acme.com"),
                },
            }),
            json!({
                "event_type": "team.member_joined",
                "metadata": {
                    "team_id": TEAM_ID,
                    "member_id": "macro|member@acme.com",
                    "role": "member",
                    "join_method": {
                        "type": "invite_accepted",
                        "invite_id": INVITE_ID,
                        "invited_by": "macro|admin@acme.com"
                    }
                }
            }),
        ),
        (
            TeamTopicEvent::MemberRemoved(TeamMemberRemovedMetadata {
                team_id: team_id(),
                member_id: user_id("macro|member@acme.com"),
                removed_by: user_id("macro|admin@acme.com"),
                role: TeamRole::Admin,
            }),
            json!({
                "event_type": "team.member_removed",
                "metadata": {
                    "team_id": TEAM_ID,
                    "member_id": "macro|member@acme.com",
                    "removed_by": "macro|admin@acme.com",
                    "role": "admin"
                }
            }),
        ),
        (
            TeamTopicEvent::MemberRoleChanged(TeamMemberRoleChangedMetadata {
                team_id: team_id(),
                actor_user_id: user_id("macro|owner@acme.com"),
                member_id: user_id("macro|member@acme.com"),
                role: TeamRole::Admin,
                previous_role: Some(TeamRole::Member),
            }),
            json!({
                "event_type": "team.member_role_changed",
                "metadata": {
                    "team_id": TEAM_ID,
                    "actor_user_id": "macro|owner@acme.com",
                    "member_id": "macro|member@acme.com",
                    "role": "admin",
                    "previous_role": "member"
                }
            }),
        ),
        (
            TeamTopicEvent::AutoJoinDomainToggled(TeamAutoJoinDomainToggledMetadata {
                team_id: team_id(),
                actor_user_id: user_id("macro|admin@acme.com"),
                auto_join_domain: None,
            }),
            json!({
                "event_type": "team.auto_join_domain_toggled",
                "metadata": {
                    "team_id": TEAM_ID,
                    "actor_user_id": "macro|admin@acme.com",
                    "auto_join_domain": null
                }
            }),
        ),
    ]
}

fn macro_events() -> Vec<TeamMacroEvent> {
    topic_events()
        .into_iter()
        .map(|(event, _)| match event {
            TeamTopicEvent::Created(metadata) => TeamMacroEvent::created(metadata),
            TeamTopicEvent::Updated(metadata) => TeamMacroEvent::updated(metadata),
            TeamTopicEvent::Deleted(metadata) => TeamMacroEvent::deleted(metadata),
            TeamTopicEvent::InviteCreated(metadata) => TeamMacroEvent::invite_created(metadata),
            TeamTopicEvent::InviteRejected(metadata) => TeamMacroEvent::invite_rejected(metadata),
            TeamTopicEvent::InviteRevoked(metadata) => TeamMacroEvent::invite_revoked(metadata),
            TeamTopicEvent::MemberJoined(metadata) => TeamMacroEvent::member_joined(metadata),
            TeamTopicEvent::MemberRemoved(metadata) => TeamMacroEvent::member_removed(metadata),
            TeamTopicEvent::MemberRoleChanged(metadata) => {
                TeamMacroEvent::member_role_changed(metadata)
            }
            TeamTopicEvent::AutoJoinDomainToggled(metadata) => {
                TeamMacroEvent::auto_join_domain_toggled(metadata)
            }
        })
        .collect()
}

#[test]
fn every_variant_has_exact_json_envelope() {
    let event_id = Uuid::parse_str(EVENT_ID).expect("valid event id");

    for (event, expected_payload) in topic_events() {
        let mut expected = expected_payload;
        let object = expected.as_object_mut().expect("expected object");
        object.insert("event_id".to_string(), json!(EVENT_ID));
        object.insert("schema_version".to_string(), json!(1));

        assert_eq!(
            serde_json::to_value(Event::with_event_id(event_id, event))
                .expect("serializable event"),
            expected
        );
    }
}

#[test]
fn every_variant_round_trips() {
    for original in macro_events() {
        let payload = serde_json::to_vec(original.event()).expect("serializable event");
        let decoded = TeamMacroEvent::decode(original.key(), &payload).expect("decodable event");

        assert_eq!(decoded.key(), TEAM_ID);
        assert_eq!(decoded.event(), original.event());
        assert_eq!(decoded.topic().as_str(), "macro.teams");
    }
}

#[test]
fn constructors_use_teams_topic_bare_uuid_key_and_schema_version_one() {
    for event in macro_events() {
        assert_eq!(event.key(), TEAM_ID);
        assert!(!event.key().starts_with("team|"));
        assert_eq!(event.topic().as_str(), "macro.teams");
        assert_eq!(event.event().schema_version, 1);
    }
}

#[test]
fn roles_and_join_methods_serialize_lowercase() {
    let invite_join = serde_json::to_value(TeamJoinMethod::InviteAccepted {
        invite_id: invite_id(),
        invited_by: user_id("macro|admin@acme.com"),
    })
    .expect("serializable join method");
    let domain_join =
        serde_json::to_value(TeamJoinMethod::DomainAutoJoin).expect("serializable join method");

    assert_eq!(invite_join["type"], "invite_accepted");
    assert_eq!(domain_join, json!({ "type": "domain_auto_join" }));
    assert_eq!(serde_json::to_value(TeamRole::Member).unwrap(), "member");
    assert_eq!(serde_json::to_value(TeamRole::Admin).unwrap(), "admin");
    assert_eq!(serde_json::to_value(TeamRole::Owner).unwrap(), "owner");
}

#[test]
fn payloads_recursively_exclude_billing_fields() {
    let forbidden_terms = ["subscription", "customer", "stripe", "payment"];

    for event in macro_events() {
        let payload = serde_json::to_value(event.event()).expect("serializable event");
        assert_no_forbidden_fields(&payload, &forbidden_terms);
    }
}

fn assert_no_forbidden_fields(value: &Value, forbidden_terms: &[&str]) {
    match value {
        Value::Object(object) => {
            for (field, child) in object {
                let normalized_field = field.to_ascii_lowercase();
                for forbidden in forbidden_terms {
                    assert!(
                        !normalized_field.contains(forbidden),
                        "payload included forbidden field {field}"
                    );
                }
                assert_no_forbidden_fields(child, forbidden_terms);
            }
        }
        Value::Array(values) => {
            for child in values {
                assert_no_forbidden_fields(child, forbidden_terms);
            }
        }
        _ => {}
    }
}
