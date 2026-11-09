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
            let event = ControlEvent::authorized(
                action,
                None,
                None,
                None,
                ControlPrincipal::User,
                access(level),
            )
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
                        None,
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
                None,
                None,
                ControlPrincipal::Runtime(actor.clone()),
                access(level),
            )
            .expect("runtimes still forward ordinary prompts");
            assert_eq!(event.actor, actor);
        }
    }
}

fn trigger() -> trigger_context::TriggerContext {
    trigger_context::TriggerContext::Requested(trigger_context::RequestedContext {
        requested_by: trigger_context::ContextPerson {
            id: "macro|owner@example.com".to_owned(),
            name: "Owner".to_owned(),
            email: Some("owner@example.com".to_owned()),
        },
        requested_at: chrono::DateTime::UNIX_EPOCH,
        repo_url: None,
    })
}

/// A runtime forwards the context it was triggered with.
#[test]
fn a_runtime_forwards_trigger_context_with_a_prompt() {
    let event = ControlEvent::authorized(
        AgentAction::prompt("hello"),
        None,
        Some(trigger()),
        None,
        ControlPrincipal::Runtime(Some(user())),
        access(AccessLevel::Edit),
    )
    .unwrap();
    assert_eq!(event.context, Some(trigger()));
}

/// A user could otherwise tell an owner's agent that the owner asked for
/// something.
#[test]
fn a_user_cannot_supply_trigger_context() {
    assert!(matches!(
        ControlEvent::authorized(
            AgentAction::prompt("hello"),
            None,
            Some(trigger()),
            None,
            ControlPrincipal::User,
            access(AccessLevel::Owner),
        ),
        Err(AgentSessionError::Forbidden)
    ));
}

#[test]
fn public_controls_cannot_supply_internal_review_context() {
    for principal in [
        ControlPrincipal::User,
        ControlPrincipal::Runtime(Some(user())),
    ] {
        assert!(matches!(
            ControlEvent::authorized(
                AgentAction::notification(Vec::new()),
                None,
                None,
                None,
                principal,
                access(AccessLevel::Owner),
            ),
            Err(AgentSessionError::Forbidden)
        ));
    }
}

#[test]
fn a_person_names_the_tab_they_typed_in() {
    let tab = crate::domain::model::UiClientId::from_uuid(macro_uuid::Uuid::from_u128(0xc1));

    let event = ControlEvent::authorized(
        AgentAction::prompt("open the plan"),
        None,
        None,
        Some(tab),
        ControlPrincipal::User,
        access(AccessLevel::Edit),
    )
    .unwrap();

    assert_eq!(event.client, Some(tab));
}

#[test]
fn a_runtime_cannot_name_a_tab() {
    let tab = crate::domain::model::UiClientId::from_uuid(macro_uuid::Uuid::from_u128(0xc1));

    let result = ControlEvent::authorized(
        AgentAction::prompt("open the plan"),
        None,
        None,
        Some(tab),
        ControlPrincipal::Runtime(Some(user())),
        access(AccessLevel::Edit),
    );

    assert!(matches!(result, Err(AgentSessionError::Forbidden)));
}
