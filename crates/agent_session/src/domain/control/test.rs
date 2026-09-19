use super::*;
use entity_access::domain::models::{AccessLevel, Entity, EntityPermission, EntityType};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("editor@example.com").unwrap()
}

fn access(level: AccessLevel) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(),
        Entity {
            entity_id: "session".into(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .unwrap()
}

fn answers() -> [AgentAction; 2] {
    [
        serde_json::from_value(serde_json::json!({
            "type": "respondToPermission", "requestId": "permission",
            "answer": { "kind": "selected", "optionId": "allow" }
        }))
        .unwrap(),
        serde_json::from_value(serde_json::json!({
            "type": "respondElicitation", "requestId": 0, "action": "accept"
        }))
        .unwrap(),
    ]
}

#[test]
fn editors_and_owners_can_answer_both_interaction_kinds() {
    for level in [AccessLevel::Edit, AccessLevel::Owner] {
        for action in answers() {
            let event =
                ControlEvent::authorized(action, None, ControlPrincipal::User, access(level))
                    .unwrap();
            assert_eq!(event.actor, Some(user()));
        }
    }
}

#[test]
fn runtimes_cannot_answer_even_when_forwarding_an_owner_or_editor() {
    for level in [AccessLevel::Edit, AccessLevel::Owner] {
        for actor in [None, Some(user())] {
            for action in answers() {
                assert!(matches!(
                    ControlEvent::authorized(
                        action,
                        None,
                        ControlPrincipal::Runtime(actor.clone()),
                        access(level)
                    ),
                    Err(AgentSessionError::Forbidden)
                ));
            }
            let event = ControlEvent::authorized(
                AgentAction::prompt("hello"),
                None,
                ControlPrincipal::Runtime(actor.clone()),
                access(level),
            )
            .expect("runtimes still forward ordinary prompts");
            assert_eq!(event.actor, actor);
        }
    }
}
