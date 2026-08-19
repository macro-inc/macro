use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;

use super::*;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

#[test]
fn every_action_maps_to_stable_columns() {
    let participant = Actor::new_from_user(user("macro|sarah@example.com"));
    // Every variant, pinned: these strings and payload shapes are the
    // durable storage contract and must never change for existing tags.
    let cases: Vec<(Action, &str, Option<serde_json::Value>)> = vec![
        (Action::Created, "created", None),
        (Action::Edited, "edited", None),
        (Action::Opened, "opened", None),
        (Action::Deleted, "deleted", None),
        (Action::Messaged, "messaged", None),
        (Action::Sent, "sent", None),
        (
            Action::PropertyChanged(PropertyChange {
                property: "prop-1".to_string(),
                from: None,
                to: Some(json!("Done")),
            }),
            "property_changed",
            Some(json!({ "property": "prop-1", "from": null, "to": "Done" })),
        ),
        (
            Action::ParticipantAdded(ParticipantChange {
                participant: participant.clone(),
            }),
            "participant_added",
            Some(json!({ "participant": "macro|sarah@example.com" })),
        ),
        (
            Action::ParticipantRemoved(ParticipantChange { participant }),
            "participant_removed",
            Some(json!({ "participant": "macro|sarah@example.com" })),
        ),
        (
            Action::CallStarted(CallStart {
                call_id: "call-1".to_string(),
            }),
            "call_started",
            Some(json!({ "call_id": "call-1" })),
        ),
    ];

    for (action, expected_tag, expected_payload) in cases {
        let (tag, payload) = action.to_columns();
        assert_eq!(tag, expected_tag, "tag for {action:?}");
        assert_eq!(payload, expected_payload, "payload for {action:?}");
        // VIEW_ACTION_TAGS is the SQL-side mirror of is_view: every variant
        // must agree so tag-filtering queries classify rows identically.
        assert_eq!(
            VIEW_ACTION_TAGS.contains(&tag),
            action.is_view(),
            "VIEW_ACTION_TAGS disagrees with is_view for {action:?}"
        );

        // The read codec is the exact inverse: every stored pair decodes
        // back to the action that produced it.
        let decoded = Action::from_columns(tag, payload.as_ref())
            .unwrap_or_else(|e| panic!("decode {tag}: {e}"));
        assert_eq!(decoded, action, "round-trip for {tag}");
    }
}

#[test]
fn unknown_tags_decode_to_recorded_unknown_preserving_the_row() {
    let payload = Some(json!({ "novel": true }));

    let (recorded, error) = RecordedAction::from_columns("renamed".to_string(), payload.clone());

    assert_eq!(
        recorded,
        RecordedAction::Unknown {
            tag: "renamed".to_string(),
            payload,
        }
    );
    assert!(matches!(error, Some(ActionDecodeError::UnknownTag)));
}

#[test]
fn undecodable_payload_on_a_known_tag_degrades_to_unknown() {
    let garbage = Some(json!({ "property": 42 }));

    let (recorded, error) =
        RecordedAction::from_columns("property_changed".to_string(), garbage.clone());

    assert_eq!(
        recorded,
        RecordedAction::Unknown {
            tag: "property_changed".to_string(),
            payload: garbage,
        }
    );
    assert!(matches!(error, Some(ActionDecodeError::InvalidPayload(_))));
}

#[test]
fn missing_payload_on_a_payload_tag_is_an_explicit_error() {
    assert!(matches!(
        Action::from_columns("call_started", None),
        Err(ActionDecodeError::MissingPayload)
    ));
}

#[test]
fn extra_payload_on_a_payload_free_tag_is_ignored() {
    // A newer writer may start attaching payloads to today's payload-free
    // tags; old readers must keep decoding the tag they know.
    let decoded = Action::from_columns("edited", Some(&json!({ "future": 1 }))).unwrap();
    assert_eq!(decoded, Action::Edited);
}

#[test]
fn only_opened_is_a_view() {
    assert!(Action::Opened.is_view());
    assert!(!Action::Created.is_view());
    assert!(!Action::Edited.is_view());
    assert!(!Action::Deleted.is_view());
}

#[test]
fn activity_ids_are_deterministic_per_event_and_ordinal() {
    let event_id = Uuid::from_u128(7);

    assert_eq!(activity_id(event_id, 0), activity_id(event_id, 0));
    assert_ne!(activity_id(event_id, 0), activity_id(event_id, 1));
    assert_ne!(activity_id(event_id, 0), activity_id(Uuid::from_u128(8), 0));
}

#[test]
fn subject_is_the_actor_unless_delegated() {
    let direct = Activity::common(
        Uuid::from_u128(1),
        0,
        Actor::new_from_user(user("macro|teo@example.com")),
        None,
        EntityType::Document,
        "doc-1",
        CommonAction::Edited,
        Utc::now(),
    );
    assert_eq!(direct.subject_id, "macro|teo@example.com");
    assert_eq!(direct.actor.as_ref(), "macro|teo@example.com");

    let delegated = Activity::common(
        Uuid::from_u128(2),
        0,
        Actor::new_from_user(user("macro|other@example.com")),
        Some(user("macro|teo@example.com")),
        EntityType::Document,
        "doc-1",
        CommonAction::Edited,
        Utc::now(),
    );
    assert_eq!(delegated.subject_id, "macro|teo@example.com");
    assert_eq!(delegated.actor.as_ref(), "macro|other@example.com");
}

#[test]
fn from_domain_projects_the_owning_kind_and_action() {
    struct FixtureActivity {
        id: String,
    }
    impl DomainActivity for FixtureActivity {
        const ENTITY_TYPE: EntityType = EntityType::Channel;
        fn entity_id(&self) -> &str {
            &self.id
        }
        fn into_action(self) -> Action {
            Action::Messaged
        }
    }

    let activity = Activity::from_domain(
        Uuid::from_u128(3),
        0,
        Actor::new_from_user(user("macro|teo@example.com")),
        None,
        FixtureActivity {
            id: "chan-1".to_string(),
        },
        Utc::now(),
    );
    assert_eq!(activity.entity_type, EntityType::Channel);
    assert_eq!(activity.entity_id, "chan-1");
    assert_eq!(activity.action, Action::Messaged);
}
