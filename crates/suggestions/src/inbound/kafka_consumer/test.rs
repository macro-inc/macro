use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use rdkafka::message::{OwnedMessage, Timestamp};
use serde_json::{Value, json};

use super::*;
use crate::domain::model::SuggestionError;
use crate::domain::resolution::Resolved;

const OWNER: &str = "macro|suggestions-consumer@macro.com";
const THREAD: &str = "01900000-0000-7000-8000-0000000000a1";
const CHANNEL: &str = "01900000-0000-7000-8000-0000000000c1";
const MESSAGE: &str = "01900000-0000-7000-8000-0000000000d1";
const ROOT: &str = "01900000-0000-7000-8000-0000000000e1";

fn record(topic: &str, offset: i64, payload: &Value) -> OwnedMessage {
    OwnedMessage::new(
        Some(serde_json::to_vec(payload).unwrap()),
        Some(b"key".to_vec()),
        topic.to_owned(),
        Timestamp::NotAvailable,
        0,
        offset,
        None,
    )
}

fn decoded(topic: &str, payload: &Value) -> Option<ResolutionEvent> {
    let message = MessageWrapper::<_, SuggestionEvent>::new(record(topic, 0, payload));
    resolution_event(&message.decode_payload().unwrap())
}

fn envelope(event_type: &str, metadata: Value) -> Value {
    json!({
        "event_id": "01900000-0000-7000-8000-000000000003",
        "schema_version": 1,
        "event_type": event_type,
        "metadata": metadata,
    })
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap()
}

fn posted(sender: &str, thread_id: Option<&str>) -> Value {
    envelope(
        "message.posted",
        json!({
            "parent": { "type": "channel", "id": CHANNEL },
            "message_id": MESSAGE,
            "thread_id": thread_id,
            "root_id": thread_id.unwrap_or(MESSAGE),
            "sender": sender,
            "triggered_by": null,
            "content": "On it.",
            "mentions": [],
            "attachments": [],
            "created_at": "2026-11-09T12:00:00Z",
        }),
    )
}

/// A sent email answers its thread for whoever sent it: the actor, or the
/// inbox's owner when it was sent from another client.
#[test]
fn a_sent_email_is_a_reply_on_its_thread() {
    let event = decoded(
        "macro.email",
        &envelope(
            "email.message_sent",
            json!({
                "link_id": "01900000-0000-7000-8000-0000000000b1",
                "owner": OWNER,
                "actor": null,
                "message_id": MESSAGE,
                "provider_message_id": "p-1",
                "thread_id": THREAD,
                "provider_thread_id": "pt-1",
                "subject": null,
                "to_emails": [],
                "cc_emails": [],
                "origin": "provider_sync",
                "sent_at": "2026-11-09T12:00:00Z",
            }),
        ),
    );

    assert_eq!(
        event,
        Some(ResolutionEvent::Replied {
            user: owner(),
            item: Item {
                entity_type: EntityType::EmailThread,
                entity_id: THREAD.to_owned(),
            },
            thread: None,
            at: "2026-11-09T12:00:00Z".parse().unwrap(),
        })
    );
}

/// A person's reply in a channel thread names that thread; a bot's post is
/// no reply of the person's.
#[test]
fn a_posted_message_is_a_reply_only_from_a_person() {
    let event = decoded("macro.messages", &posted(OWNER, Some(ROOT)));
    assert_eq!(
        event,
        Some(ResolutionEvent::Replied {
            user: owner(),
            item: Item {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            },
            thread: Some(ROOT.to_owned()),
            at: "2026-11-09T12:00:00Z".parse().unwrap(),
        })
    );

    let bot = decoded(
        "macro.messages",
        &posted("bot|01900000-0000-7000-8000-0000000000f1", None),
    );
    assert_eq!(bot, None);
}

/// Removing people from a channel asks whether those people lost access.
#[test]
fn a_participant_removal_is_an_access_change_for_those_people() {
    let event = decoded(
        "macro.channels",
        &envelope(
            "channel.participant_removed",
            json!({
                "channel_id": CHANNEL,
                "channel_type": "private",
                "removed_by": OWNER,
                "removed_user_ids": [OWNER],
            }),
        ),
    );

    assert_eq!(
        event,
        Some(ResolutionEvent::AccessChanged {
            item: Item {
                entity_type: EntityType::Channel,
                entity_id: CHANNEL.to_owned(),
            },
            users: Some(vec![owner()]),
        })
    );
}

#[derive(Default)]
struct State {
    messages: VecDeque<OwnedMessage>,
    committed: Vec<i64>,
    resolved: Vec<ResolutionEvent>,
}

#[derive(Clone, Default)]
struct Fake {
    state: Arc<Mutex<State>>,
    done: tokio_util::sync::CancellationToken,
}

impl EventConsumer<SuggestionEvent> for Fake {
    type MessageType<'a> = OwnedMessage;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, SuggestionEvent>, Report> {
        let message = self.state.lock().unwrap().messages.pop_front();
        match message {
            Some(message) => Ok(MessageWrapper::new(message)),
            None => std::future::pending().await,
        }
    }
}

impl CommittingConsumer for Fake {
    fn commit(&self, message: &OwnedMessage) -> Result<(), Report> {
        let mut state = self.state.lock().unwrap();
        state.committed.push(message.offset());
        if state.messages.is_empty() {
            self.done.cancel();
        }
        Ok(())
    }
}

/// Fails every time.
impl ResolveSuggestions for Fake {
    async fn resolve(&self, event: &ResolutionEvent) -> Result<Resolved, SuggestionError> {
        self.state.lock().unwrap().resolved.push(event.clone());
        Err(SuggestionError::NotFound)
    }
}

/// An undecodable record, and one that keeps failing, are both committed and
/// the next record still handled.
#[tokio::test(start_paused = true)]
async fn bad_records_never_stall_the_partition() {
    let fake = Fake::default();
    {
        let mut state = fake.state.lock().unwrap();
        state.messages.push_back(record(
            "macro.messages",
            1,
            &json!({ "event_type": "message.posted", "metadata": "nonsense" }),
        ));
        state
            .messages
            .push_back(record("macro.messages", 2, &posted(OWNER, None)));
        state
            .messages
            .push_back(record("macro.messages", 3, &posted(OWNER, Some(ROOT))));
    }

    consume(
        fake.clone(),
        fake.clone(),
        fake.done.clone().cancelled_owned(),
        Duration::from_secs(1),
    )
    .await
    .unwrap();

    let state = fake.state.lock().unwrap();
    assert_eq!(state.committed, vec![1, 2, 3]);
    assert_eq!(state.resolved.len(), usize::from(MAX_ATTEMPTS) * 2);
}
