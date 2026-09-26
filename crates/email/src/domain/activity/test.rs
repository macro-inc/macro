use ::activity::Action;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use macro_event_broker::Event;

use super::*;
use crate::domain::events::{
    MessageSentMetadata, ThreadArchivedMetadata, ThreadSpamChangedMetadata, ThreadStarredMetadata,
    ThreadTrashedMetadata,
};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

fn envelope(event: EmailTopicEvent) -> Event<EmailTopicEvent> {
    Event::with_event_id(Uuid::now_v7(), event)
}

const THREAD_ID: Uuid = Uuid::from_u128(9);

fn sent(actor: Option<MacroUserIdStr<'static>>) -> MessageSentMetadata {
    sent_with_origin(actor, EmailEventOrigin::UserAction)
}

fn sent_with_origin(
    actor: Option<MacroUserIdStr<'static>>,
    origin: EmailEventOrigin,
) -> MessageSentMetadata {
    MessageSentMetadata {
        link_id: Uuid::from_u128(1),
        owner: user("macro|owner@example.com"),
        actor,
        message_id: Uuid::from_u128(2),
        provider_message_id: "pm".to_string(),
        thread_id: THREAD_ID,
        provider_thread_id: "pt".to_string(),
        subject: None,
        to_emails: vec![],
        cc_emails: vec![],
        sent_at: Utc::now(),
        origin,
    }
}

#[test]
fn user_sent_message_maps_to_sent_activity() {
    let event = envelope(EmailTopicEvent::MessageSent(sent(Some(user(
        "macro|teo@example.com",
    )))));
    let Ingest::Insert(activities) = event.event.ingest(event.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Sent);
    assert_eq!(activities[0].entity_type, EntityType::EmailThread);
    assert_eq!(activities[0].entity_id, THREAD_ID.to_string());
}

#[test]
fn provider_synced_send_is_dropped_even_with_an_actor() {
    let event = envelope(EmailTopicEvent::MessageSent(sent_with_origin(
        Some(user("macro|teo@example.com")),
        EmailEventOrigin::ProviderSync,
    )));
    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}

/// Marking a thread done is triage: it must not become the user's latest
/// touch of the thread, or the own-touch feed carries it back into Home.
#[test]
fn archiving_a_thread_is_not_activity() {
    let archive = |archived, origin| {
        envelope(EmailTopicEvent::ThreadArchived(ThreadArchivedMetadata {
            link_id: Uuid::from_u128(1),
            owner: user("macro|owner@example.com"),
            actor: Some(user("macro|owner@example.com")),
            thread_id: THREAD_ID,
            archived,
            origin,
        }))
    };

    for archived in [true, false] {
        for origin in [EmailEventOrigin::UserAction, EmailEventOrigin::ProviderSync] {
            let event = archive(archived, origin);
            assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
        }
    }
}

#[test]
fn trashing_a_thread_is_not_activity() {
    let event = envelope(EmailTopicEvent::ThreadTrashed(ThreadTrashedMetadata {
        link_id: Uuid::from_u128(1),
        owner: user("macro|owner@example.com"),
        actor: Some(user("macro|owner@example.com")),
        thread_id: THREAD_ID,
        trashed: true,
        origin: EmailEventOrigin::UserAction,
    }));
    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}

#[test]
fn marking_a_thread_spam_is_not_activity() {
    let event = envelope(EmailTopicEvent::ThreadSpamChanged(
        ThreadSpamChangedMetadata {
            link_id: Uuid::from_u128(1),
            owner: user("macro|owner@example.com"),
            actor: Some(user("macro|owner@example.com")),
            thread_id: THREAD_ID,
            spam: true,
            origin: EmailEventOrigin::UserAction,
        },
    ));
    assert_eq!(event.event.ingest(event.event_id), Ingest::Ignore);
}

#[test]
fn provider_sync_star_is_dropped_but_user_star_maps() {
    let star = |origin| {
        envelope(EmailTopicEvent::ThreadStarred(ThreadStarredMetadata {
            link_id: Uuid::from_u128(1),
            owner: user("macro|owner@example.com"),
            actor: Some(user("macro|owner@example.com")),
            thread_id: THREAD_ID,
            starred: true,
            origin,
        }))
    };

    let user_action = star(EmailEventOrigin::UserAction);
    let Ingest::Insert(activities) = user_action.event.ingest(user_action.event_id) else {
        panic!("expected activities");
    };
    assert_eq!(activities[0].action, Action::Edited);

    let provider = star(EmailEventOrigin::ProviderSync);
    assert_eq!(provider.event.ingest(provider.event_id), Ingest::Ignore);
}
