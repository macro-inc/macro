use macro_event_broker::exposure::{
    Audience, EntityType, Exposure, MinAccessLevel, PublicEvent, Stage,
};
use serde_json::json;
use uuid::Uuid;

use super::*;

const FORM_ID: &str = "00000000-0000-0000-0000-000000000001";

fn form_id() -> FormId {
    FormId::from_uuid(Uuid::from_u128(1))
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn public(event: &FormTopicEvent) -> PublicEvent<'_, FormPublicEvent> {
    match event.exposure().unwrap() {
        Exposure::Public(public) => public,
        Exposure::Internal(reason) => panic!("expected public, got {reason}"),
    }
}

fn changed() -> FormChangedMetadata {
    FormChangedMetadata {
        form_id: form_id(),
        attribution: Some(Attribution::user(owner())),
    }
}

fn response_submitted() -> FormTopicEvent {
    FormTopicEvent::ResponseSubmitted(FormResponseSubmittedMetadata {
        form_id: form_id(),
        response_id: FormResponseId::from_uuid(Uuid::from_u128(2)),
        respondent: Some(owner()),
        row_id: Some(RowId::from_uuid(Uuid::from_u128(3))),
        submitted_at: "2026-11-13T00:00:00Z".parse().unwrap(),
    })
}

#[test]
fn form_events_reach_the_form_audience_in_preview() {
    let events = [
        FormTopicEvent::Created(FormCreatedMetadata {
            form_id: form_id(),
            database_id: DatabaseId::from_uuid(Uuid::from_u128(4)),
            owner: owner(),
            name: "Survey".to_owned(),
            created_at: "2026-11-13T00:00:00Z".parse().unwrap(),
            attribution: Attribution::user(owner()),
        }),
        FormTopicEvent::Renamed(FormRenamedMetadata {
            form_id: form_id(),
            attribution: None,
            name: "Renamed".to_owned(),
        }),
        FormTopicEvent::Trashed(changed()),
        FormTopicEvent::Restored(changed()),
        FormTopicEvent::SharingChanged(changed()),
        FormTopicEvent::AppearanceChanged {
            form_id: form_id(),
            attribution: None,
            change: activity::AppearanceChange {
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
                entity_type: EntityType::Form,
                entity_id: FORM_ID.to_owned(),
            },
            "{}",
            public.name
        );
        assert_eq!(public.stage, Stage::Preview);
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap()["event_type"],
            public.name
        );
    }
}

#[test]
fn responses_reach_editors_only_without_the_respondent() {
    let event = response_submitted();
    let public = public(&event);

    assert_eq!(
        public.audience,
        Audience::EntityAtLeast {
            entity_type: EntityType::Form,
            entity_id: FORM_ID.to_owned(),
            min_level: MinAccessLevel::Edit,
        }
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "form.response_submitted",
            "metadata": {
                "form_id": FORM_ID,
                "response_id": "00000000-0000-0000-0000-000000000002",
                "row_id": "00000000-0000-0000-0000-000000000003",
                "submitted_at": "2026-11-13T00:00:00Z",
            },
        })
    );
}

#[test]
fn created_payload_omits_the_name() {
    let event = FormTopicEvent::Created(FormCreatedMetadata {
        form_id: form_id(),
        database_id: DatabaseId::from_uuid(Uuid::from_u128(4)),
        owner: owner(),
        name: "Survey".to_owned(),
        created_at: "2026-11-13T00:00:00Z".parse().unwrap(),
        attribution: Attribution::user(owner()),
    });
    assert_eq!(
        serde_json::to_value(public(&event).payload.as_ref()).unwrap(),
        json!({
            "event_type": "form.created",
            "metadata": {
                "form_id": FORM_ID,
                "actor": "macro|owner@example.com",
                "on_behalf_of": null,
                "database_id": "00000000-0000-0000-0000-000000000004",
                "created_at": "2026-11-13T00:00:00Z",
            },
        })
    );
}

#[test]
fn purge_stays_internal() {
    let event = FormTopicEvent::Purged(FormPurgedMetadata { form_id: form_id() });
    assert!(matches!(event.exposure().unwrap(), Exposure::Internal(_)));
}

#[cfg(feature = "inbound")]
#[test]
fn public_payload_has_a_schema() {
    use utoipa::ToSchema as _;
    assert_eq!(FormPublicEvent::name(), "FormPublicEvent");
}
