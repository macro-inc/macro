use std::sync::{Arc, Mutex};

use agent::types::Role;
use attachment::{AttachmentContent, AttachmentPart, Attachments};
use chrono::Utc;
use macro_event_broker::{EventBrokerError, MacroEvent};
use model::chat::{ChatMessageWithAttachments, NewAttachment};
use serde_json::json;

use super::*;
use crate::domain::models::{PatchChatMessageArgs, WebCitation};

const CHAT_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const MESSAGE_ID: &str = "7d2c1e5a-4b3f-4c6d-8e9f-0a1b2c3d4e5f";

fn test_user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|sender@acme.com")
        .expect("valid user id")
        .into_owned()
}

fn new_message(role: Role, attachments: Option<Vec<NewAttachment>>) -> NewChatMessage {
    let now = Utc::now();
    NewChatMessage {
        id: None,
        content: ChatMessageContent::Text("hello".to_string()),
        role,
        attachments,
        model: "gpt-test".to_string(),
        created_at: now,
        updated_at: now,
    }
}

fn document_attachment(attachment_id: &str) -> NewAttachment {
    NewAttachment {
        attachment_type: AttachmentType::Document,
        attachment_id: attachment_id.to_string(),
    }
}

// -- Stubs --

#[derive(Clone, Default)]
struct StubMessageRepo {
    fail_create: bool,
}

impl StubMessageRepo {
    fn failing() -> Self {
        Self { fail_create: true }
    }
}

impl MessageRepo for StubMessageRepo {
    async fn create(&self, _chat_id: &str, _message: NewChatMessage) -> Result<String> {
        if self.fail_create {
            return Err(ChatErr::BadRequest(
                "intentional create failure".to_string(),
            ));
        }
        Ok(MESSAGE_ID.to_string())
    }

    async fn delete(&self, _message_id: &str) -> Result<()> {
        unimplemented!("not used in these tests")
    }

    async fn get_messages(&self, _chat_id: &str) -> Result<Vec<ChatMessageWithAttachments>> {
        unimplemented!("not used in these tests")
    }

    async fn get_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> Result<ChatMessageContent> {
        unimplemented!("not used in these tests")
    }

    async fn update_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _content: &ChatMessageContent,
    ) -> Result<()> {
        unimplemented!("not used in these tests")
    }

    async fn patch_message(&self, _chat_id: &str, _args: PatchChatMessageArgs) -> Result<()> {
        unimplemented!("not used in these tests")
    }

    async fn copy_messages(&self, _source_chat_id: &str, _dest_chat_id: &str) -> Result<()> {
        unimplemented!("not used in these tests")
    }

    async fn get_web_citations(&self, _chat_id: &str) -> Result<Vec<(String, Vec<WebCitation>)>> {
        unimplemented!("not used in these tests")
    }

    async fn store_resolved_message(
        &self,
        _message_id: &str,
        _parts: FormattedParts,
    ) -> Result<()> {
        Ok(())
    }

    async fn get_resolved_message(&self, _message_id: &str) -> Result<FormattedParts> {
        unimplemented!("not used in these tests")
    }
}

#[derive(Clone, Default)]
struct StubAttachmentService;

impl AttachmentService for StubAttachmentService {
    async fn resolve_attachments<'a>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let results = ids
            .iter()
            .map(|entity| {
                Ok(AttachmentContent {
                    reference: (*entity).clone(),
                    name: None,
                    content: NonEmpty::one(AttachmentPart::Content("stub content".to_string())),
                })
            })
            .collect();
        Attachments::new(NonEmpty::new(results).expect("ids was non-empty"))
    }
}

#[derive(Clone, Debug, PartialEq)]
struct PublishedChatEvent {
    topic: &'static str,
    key: String,
    envelope: serde_json::Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
    events: Arc<Mutex<Vec<PublishedChatEvent>>>,
    fail_scheduling: bool,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_scheduling: true,
            ..Self::default()
        }
    }

    fn events(&self) -> Vec<PublishedChatEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> std::result::Result<
        tokio::task::JoinHandle<std::result::Result<(), EventBrokerError>>,
        EventBrokerError,
    > {
        if self.fail_scheduling {
            return Err(EventBrokerError::Publish(
                "intentional scheduling failure".to_string(),
            ));
        }

        self.events.lock().unwrap().push(PublishedChatEvent {
            topic: event.topic(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn service_with_broker(
    repo: StubMessageRepo,
    broker: RecordingEventBroker,
) -> MessageServiceImpl<StubMessageRepo, StubAttachmentService, RecordingEventBroker> {
    MessageServiceImpl::new(repo, StubAttachmentService).with_event_broker(broker)
}

// -- Tests --

#[tokio::test]
async fn create_publishes_user_message_sent_keyed_by_chat_id() {
    let broker = RecordingEventBroker::default();
    let service = service_with_broker(StubMessageRepo::default(), broker.clone());
    let attachments = vec![document_attachment("doc-1"), document_attachment("doc-2")];

    let resolved = service
        .create(
            &test_user_id(),
            CHAT_ID,
            new_message(Role::User, Some(attachments)),
        )
        .await
        .expect("create succeeds");
    assert_eq!(resolved.message_id, MESSAGE_ID);

    let events = broker.events();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.topic, "macro.chats");
    assert_eq!(event.key, CHAT_ID);
    assert_eq!(event.envelope["event_type"], "chat.message_sent");
    assert_eq!(
        event.envelope["metadata"],
        json!({
            "chat_id": CHAT_ID,
            "message_id": MESSAGE_ID,
            "role": "user",
            "model": "gpt-test",
            "actor_user_id": "macro|sender@acme.com",
            "attachment_count": 2
        })
    );
}

#[tokio::test]
async fn create_without_attachments_publishes_zero_attachment_count() {
    let broker = RecordingEventBroker::default();
    let service = service_with_broker(StubMessageRepo::default(), broker.clone());

    service
        .create(&test_user_id(), CHAT_ID, new_message(Role::User, None))
        .await
        .expect("create succeeds");

    let events = broker.events();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].envelope["metadata"]["attachment_count"], 0);
    assert_eq!(events[0].envelope["metadata"]["role"], "user");
}

#[tokio::test]
async fn store_publishes_assistant_message_sent_without_actor() {
    let broker = RecordingEventBroker::default();
    let service = service_with_broker(StubMessageRepo::default(), broker.clone());

    let message_id = service
        .store(CHAT_ID, new_message(Role::Assistant, None))
        .await
        .expect("store succeeds");
    assert_eq!(message_id, MESSAGE_ID);

    let events = broker.events();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.topic, "macro.chats");
    assert_eq!(event.key, CHAT_ID);
    assert_eq!(event.envelope["event_type"], "chat.message_sent");
    assert_eq!(
        event.envelope["metadata"],
        json!({
            "chat_id": CHAT_ID,
            "message_id": MESSAGE_ID,
            "role": "assistant",
            "model": "gpt-test",
            "actor_user_id": null,
            "attachment_count": 0
        })
    );
}

#[tokio::test]
async fn failed_create_publishes_no_event() {
    let broker = RecordingEventBroker::default();
    let service = service_with_broker(StubMessageRepo::failing(), broker.clone());

    let create_result = service
        .create(&test_user_id(), CHAT_ID, new_message(Role::User, None))
        .await;
    assert!(create_result.is_err());

    let store_result = service
        .store(CHAT_ID, new_message(Role::Assistant, None))
        .await;
    assert!(store_result.is_err());

    assert!(broker.events().is_empty());
}

#[tokio::test]
async fn broker_scheduling_failure_does_not_fail_the_call() {
    let service = service_with_broker(StubMessageRepo::default(), RecordingEventBroker::failing());

    let resolved = service
        .create(&test_user_id(), CHAT_ID, new_message(Role::User, None))
        .await
        .expect("create succeeds despite broker failure");
    assert_eq!(resolved.message_id, MESSAGE_ID);

    let message_id = service
        .store(CHAT_ID, new_message(Role::Assistant, None))
        .await
        .expect("store succeeds despite broker failure");
    assert_eq!(message_id, MESSAGE_ID);
}
