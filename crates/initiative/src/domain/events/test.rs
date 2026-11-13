use macro_event_broker::Event;
use serde_json::json;
use uuid::Uuid;

use super::*;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

#[test]
fn purged_wire_shape_carries_audience_routing() {
    let event = Event::with_event_id(
        Uuid::nil(),
        InitiativeTopicEvent::Purged {
            initiative_id: InitiativeId::from_uuid(Uuid::nil()),
            audience_user_ids: vec![user("macro|owner@example.com")],
        },
    );

    assert_eq!(
        serde_json::to_value(&event).expect("serializable"),
        json!({
            "event_id": "00000000-0000-0000-0000-000000000000",
            "schema_version": 1,
            "event_type": "initiative.purged",
            "metadata": {
                "initiative_id": "00000000-0000-0000-0000-000000000000",
                "audience_user_ids": ["macro|owner@example.com"],
            },
        })
    );
}

#[test]
fn purged_published_before_audience_routing_decodes_empty() {
    let payload = json!({
        "event_id": "00000000-0000-0000-0000-000000000000",
        "schema_version": 1,
        "event_type": "initiative.purged",
        "metadata": { "initiative_id": "00000000-0000-0000-0000-000000000000" },
    });

    let event: Event<InitiativeTopicEvent> =
        serde_json::from_value(payload).expect("old payload decodes");

    assert_eq!(
        event.event,
        InitiativeTopicEvent::Purged {
            initiative_id: InitiativeId::from_uuid(Uuid::nil()),
            audience_user_ids: Vec::new(),
        }
    );
}

mod exposure {
    use super::*;
    use macro_event_broker::exposure::{Audience, EntityType, Exposure, PublicEvent, Stage};

    fn initiative_id() -> InitiativeId {
        InitiativeId::from_uuid(Uuid::nil())
    }

    fn change() -> InitiativeChange {
        InitiativeChange {
            initiative_id: initiative_id(),
            attribution: Some(InitiativeEventActor {
                actor: Actor::new_from_user(user("macro|owner@example.com")),
                on_behalf_of: None,
            }),
            occurred_at: "2026-11-13T00:00:00Z".parse().unwrap(),
        }
    }

    fn public(event: &InitiativeTopicEvent) -> PublicEvent<'_, InitiativePublicEvent> {
        match event.exposure().unwrap() {
            Exposure::Public(public) => public,
            Exposure::Internal(reason) => panic!("expected public, got {reason}"),
        }
    }

    #[test]
    fn lifecycle_events_reach_the_initiative_audience_in_preview() {
        let events = [
            InitiativeTopicEvent::Created(change()),
            InitiativeTopicEvent::Updated(change()),
            InitiativeTopicEvent::AppearanceChanged {
                change: change(),
                appearance: activity::AppearanceChange {
                    from: None,
                    to: None,
                },
            },
        ];
        for event in &events {
            let public = public(event);
            assert_eq!(
                public.audience,
                Audience::Entity {
                    entity_type: EntityType::Initiative,
                    entity_id: Uuid::nil().to_string(),
                }
            );
            assert_eq!(public.stage, Stage::Preview);
            assert_eq!(
                serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
                public.name
            );
        }
    }

    #[test]
    fn appearance_change_payload_is_attribution_only() {
        let event = InitiativeTopicEvent::AppearanceChanged {
            change: change(),
            appearance: activity::AppearanceChange {
                from: None,
                to: None,
            },
        };
        assert_eq!(
            serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
            json!({
                "event_type": "initiative.appearance_changed",
                "metadata": {
                    "initiative_id": "00000000-0000-0000-0000-000000000000",
                    "actor": "macro|owner@example.com",
                    "on_behalf_of": null,
                    "occurred_at": "2026-11-13T00:00:00Z",
                },
            })
        );
    }

    #[test]
    fn purge_reaches_the_captured_audience_without_carrying_it() {
        let event = InitiativeTopicEvent::Purged {
            initiative_id: initiative_id(),
            audience_user_ids: vec![
                user("macro|owner@example.com"),
                user("macro|viewer@example.com"),
            ],
        };
        let public = public(&event);

        assert_eq!(
            public.audience,
            Audience::Snapshot {
                user_ids: vec![
                    user("macro|owner@example.com"),
                    user("macro|viewer@example.com"),
                ],
            }
        );
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap(),
            json!({
                "event_type": "initiative.purged",
                "metadata": {"initiative_id": "00000000-0000-0000-0000-000000000000"},
            })
        );
    }

    #[test]
    fn purge_without_a_captured_audience_stays_internal() {
        let event = InitiativeTopicEvent::Purged {
            initiative_id: initiative_id(),
            audience_user_ids: Vec::new(),
        };
        assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
    }

    #[cfg(feature = "inbound")]
    #[test]
    fn public_payload_has_a_schema() {
        use utoipa::ToSchema as _;
        assert_eq!(InitiativePublicEvent::name(), "InitiativePublicEvent");
    }
}
