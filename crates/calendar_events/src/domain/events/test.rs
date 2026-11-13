use macro_event_broker::TopicEvent;
use macro_event_broker::exposure::{
    Audience, EntityRef, EntityType, Exposure, ExposureError, Stage,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::json;
use uuid::Uuid;

use super::{CalendarEventMetadata, CalendarTopicEvent};

const OWNER: &str = "macro|owner@example.com";

fn metadata(owner_id: &str) -> CalendarEventMetadata {
    CalendarEventMetadata {
        event_id: Uuid::nil(),
        owner_id: owner_id.to_owned(),
    }
}

#[test]
fn calendar_events_reach_only_the_owner() {
    for (event, name) in [
        (
            CalendarTopicEvent::Created(metadata(OWNER)),
            "calendar_event.created",
        ),
        (
            CalendarTopicEvent::Updated(metadata(OWNER)),
            "calendar_event.updated",
        ),
        (
            CalendarTopicEvent::Deleted(metadata(OWNER)),
            "calendar_event.deleted",
        ),
    ] {
        let Exposure::Public(public) = event.exposure().expect("valid exposure") else {
            panic!("{name} must be public");
        };
        assert_eq!(public.name, name);
        assert_eq!(public.stage, Stage::Preview);
        assert_eq!(
            public.entity,
            EntityRef::new(EntityType::CalendarEvent, Uuid::nil().to_string())
        );
        assert_eq!(
            public.audience,
            Audience::Recipient {
                user_id: MacroUserIdStr::try_from(OWNER.to_owned()).unwrap(),
            }
        );
        assert_eq!(
            serde_json::to_value(public.payload.as_ref()).unwrap(),
            json!({
                "event_type": name,
                "metadata": { "event_id": "00000000-0000-0000-0000-000000000000" }
            })
        );
    }
}

#[test]
fn a_malformed_owner_is_rejected() {
    assert_eq!(
        CalendarTopicEvent::Created(metadata("not-a-user")).exposure(),
        Err(ExposureError::InvalidEntityId {
            entity_type: "user",
            entity_id: "not-a-user".to_owned(),
        })
    );
}
