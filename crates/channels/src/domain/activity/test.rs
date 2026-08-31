use ::activity::Action;
use ::activity::Actor;
use ::activity::EntityType;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::broker_events::{
    ChannelCreatedMetadata, ChannelMessagePostedMetadata, ChannelParticipantAddedMetadata,
};
use crate::domain::models::ChannelType;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: ChannelTopicEvent) -> Event<ChannelTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

const CHANNEL_ID: Uuid = Uuid::from_u128(7);

#[test]
fn message_posted_maps_to_messaged_with_triggered_by_as_subject() {
    let created_at = Utc::now();
    let event = envelope(ChannelTopicEvent::MessagePosted(
        ChannelMessagePostedMetadata {
            channel_id: CHANNEL_ID,
            message_id: Uuid::from_u128(8),
            thread_id: None,
            sender: Actor::new_from_user(user("macro|bot-like@example.com")),
            triggered_by: Some("macro|teo@example.com".to_string()),
            channel_type: ChannelType::Public,
            content: "hi".to_string(),
            mentions: vec![],
            attachments: vec![],
            created_at,
        },
    ));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities.len(), 1);
    assert_eq!(activities[0].action, Action::Messaged);
    // Delegation: the triggering user is the subject; the sender the actor.
    assert_eq!(activities[0].subject_id, "macro|teo@example.com");
    assert_eq!(activities[0].actor.as_ref(), "macro|bot-like@example.com");
    assert_eq!(activities[0].occurred_at, created_at);
    assert_eq!(activities[0].entity_id, CHANNEL_ID.to_string());
    assert_eq!(activities[0].entity_type, EntityType::Channel);
}

#[test]
fn participant_added_yields_one_activity_per_user_with_stable_ordinals() {
    let event = envelope(ChannelTopicEvent::ParticipantAdded(
        ChannelParticipantAddedMetadata {
            channel_id: CHANNEL_ID,
            channel_type: ChannelType::Public,
            added_by: Actor::new_from_user(user("macro|admin@example.com")),
            added_user_ids: vec![user("macro|a@example.com"), user("macro|b@example.com")],
        },
    ));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities.len(), 2);
    assert_ne!(activities[0].id, activities[1].id);
    assert!(
        activities
            .iter()
            .all(|a| a.subject_id == "macro|admin@example.com")
    );
    assert_eq!(
        activities[0].action,
        Action::ParticipantAdded(::activity::ParticipantChange {
            participant: Actor::new_from_user(user("macro|a@example.com"))
        })
    );

    // Replay derives identical ids.
    let Ingest::Insert(replayed) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].id, replayed[0].id);
    assert_eq!(activities[1].id, replayed[1].id);
}

#[test]
fn created_maps_to_created_by_the_actor() {
    let event = envelope(ChannelTopicEvent::Created(ChannelCreatedMetadata {
        channel_id: CHANNEL_ID,
        actor: Actor::new_from_user(user("macro|owner@example.com")),
        on_behalf_of: None,
        channel_type: ChannelType::Public,
        channel_name: Some("general".to_string()),
        participant_user_ids: vec![user("macro|owner@example.com")],
    }));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Created);
    assert_eq!(activities[0].actor.as_ref(), "macro|owner@example.com");
    assert_eq!(activities[0].subject_id, "macro|owner@example.com");
}

#[test]
fn created_by_system_stays_on_the_owner_feed() {
    let event = envelope(ChannelTopicEvent::Created(ChannelCreatedMetadata {
        channel_id: CHANNEL_ID,
        actor: Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        on_behalf_of: Some(user("macro|owner@example.com")),
        channel_type: ChannelType::Private,
        channel_name: Some("Macro Support x owner".to_string()),
        participant_user_ids: vec![user("macro|owner@example.com")],
    }));

    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Created);
    assert_eq!(
        activities[0].actor.as_ref(),
        Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID).as_ref()
    );
    assert_eq!(activities[0].subject_id, "macro|owner@example.com");
}
