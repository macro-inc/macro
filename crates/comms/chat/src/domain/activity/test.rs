use ::activity::Action;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{
    ChatCreatedMetadata, ChatMessageSentMetadata, ChatPermanentlyDeletedMetadata,
};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: ChatTopicEvent) -> Event<ChatTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

fn message(role: ChatMessageRole, actor: Option<MacroUserIdStr<'static>>) -> ChatTopicEvent {
    ChatTopicEvent::MessageSent(ChatMessageSentMetadata {
        chat_id: "chat-1".to_string(),
        message_id: "msg-1".to_string(),
        role,
        model: "test".to_string(),
        actor_user_id: actor,
        attachment_count: 0,
    })
}

#[test]
fn created_and_user_message_map_to_activities() {
    let created = envelope(ChatTopicEvent::Created(ChatCreatedMetadata {
        chat_id: "chat-1".to_string(),
        owner: Owner::User(user("macro|owner@example.com")),
        name: "planning".to_string(),
        project_id: None,
    }));
    let Ingest::Insert(activities) = created.event.ingest(created.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Created);
    assert_eq!(activities[0].entity_type, EntityType::Chat);

    let sent = envelope(message(
        ChatMessageRole::User,
        Some(user("macro|owner@example.com")),
    ));
    let Ingest::Insert(activities) = sent.event.ingest(sent.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Messaged);
}

#[test]
fn created_derives_an_actor_for_every_owner_kind() {
    let user = user("macro|owner@example.com");
    let bot = bot_id::MACRO_AI_BOT_ID;
    for (owner, expected_actor) in [
        (Owner::User(user.clone()), Actor::new_from_user(user)),
        (Owner::Bot(bot), Actor::new_from_bot(bot)),
        (
            Owner::Team(Uuid::from_u128(1)),
            Actor::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        ),
    ] {
        let event = envelope(ChatTopicEvent::Created(ChatCreatedMetadata {
            chat_id: "chat-1".to_string(),
            owner,
            name: "planning".to_string(),
            project_id: None,
        }));
        let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
            panic!("expected a creation activity");
        };
        assert_eq!(activities.len(), 1);
        assert_eq!(activities[0].actor, expected_actor);
        assert_eq!(activities[0].subject_id, expected_actor.as_ref());
        assert_eq!(activities[0].action, Action::Created);
    }
}

#[test]
fn assistant_and_actorless_messages_are_dropped() {
    let assistant = envelope(message(
        ChatMessageRole::Assistant,
        Some(user("macro|owner@example.com")),
    ));
    assert_eq!(assistant.event.ingest(assistant.event_id), Ingest::Ignore);

    let actorless = envelope(message(ChatMessageRole::User, None));
    assert_eq!(actorless.event.ingest(actorless.event_id), Ingest::Ignore);
}

#[test]
fn permanent_delete_purges() {
    let purged = envelope(ChatTopicEvent::PermanentlyDeleted(
        ChatPermanentlyDeletedMetadata {
            chat_id: "chat-1".to_string(),
            actor_user_id: None,
            project_id: None,
        },
    ));
    assert_eq!(
        purged.event.ingest(purged.event_id),
        Ingest::Purge(vec![(EntityType::Chat, "chat-1".to_string())])
    );
}
