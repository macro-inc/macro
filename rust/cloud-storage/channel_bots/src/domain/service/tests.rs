use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use channels::domain::models::{
    AttachmentEntityReference, ChannelAttachmentType, ChannelContextMessage, ChannelMessageFilters,
    ChannelParticipant, MessagePageDirection, MutatedMessage, ResolvedChannelMessage, Sender,
    ThreadReply,
};
use channels::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesQueryResult, ChannelService,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{BotEvent, BotTrigger},
    ports::AgentResponder,
};

struct TestChannelService {
    around_args: Mutex<Option<(Uuid, Uuid, i64, i64)>>,
    around_messages: Vec<ChannelContextMessage>,
}

impl ChannelService for TestChannelService {
    fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
        _notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> impl Future<Output = Result<ChannelAttachmentsPage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn get_message_context(
        &self,
        channel_id: Uuid,
        message_id: Uuid,
        before: i64,
        after: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>, ChannelMessagesErr>> + Send {
        *self.around_args.lock().unwrap() = Some((channel_id, message_id, before, after));
        let messages = self.around_messages.clone();
        async move { Ok(messages) }
    }

    fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, ChannelMessagesErr>> + Send
    {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReply>, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }

    fn resolve_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<ResolvedChannelMessage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for prompt tests") }
    }
}

struct TestResponder;

#[async_trait]
impl AgentResponder for TestResponder {
    async fn respond(&self, _user_id: &str, _prompt: String) -> anyhow::Result<String> {
        unimplemented!("not needed for prompt tests")
    }
}

fn user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

fn context_message(
    channel_id: Uuid,
    id: Uuid,
    sender_id: &str,
    content: &str,
) -> ChannelContextMessage {
    let now = Utc::now();
    ChannelContextMessage {
        id,
        channel_id,
        thread_id: None,
        sender_id: sender_id.to_string(),
        content: content.to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
        bot_profile: None,
    }
}

#[tokio::test]
async fn prompt_uses_local_context_around_trigger() {
    let channel_id = Uuid::new_v4();
    let trigger_id = Uuid::new_v4();
    let before_id = Uuid::new_v4();
    let after_id = Uuid::new_v4();
    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: vec![
            context_message(channel_id, before_id, "macro|alice@example.com", "before"),
            context_message(
                channel_id,
                trigger_id,
                "macro|teo@example.com",
                "@macro help",
            ),
            context_message(channel_id, after_id, "macro|bob@example.com", "after"),
        ],
    });
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(TestResponder));
    let event = BotEvent {
        trigger: BotTrigger::Mention,
        channel_id,
        message: MutatedMessage {
            id: trigger_id,
            channel_id,
            thread_id: None,
            sender_id: Sender::User(user_id("teo@example.com")),
            content: "@macro help".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            edited_at: None,
            deleted_at: None,
        },
        reply_thread_id: trigger_id,
        requesting_user: user_id("teo@example.com"),
    };

    let prompt = handler.build_prompt(&event).await;

    assert_eq!(
        *channels.around_args.lock().unwrap(),
        Some((
            channel_id,
            trigger_id,
            CONTEXT_MESSAGES_BEFORE,
            CONTEXT_MESSAGES_AFTER
        ))
    );
    assert!(prompt.contains("Channel messages around the mention"));
    assert!(prompt.contains("alice: before"));
    assert!(prompt.contains("bob: after"));
    assert!(!prompt.contains("teo: @macro help"));
    assert!(prompt.contains("teo said:\n@macro help"));
    assert!(!prompt.contains("Recent channel messages"));
    assert!(!prompt.contains("Messages in the thread"));
}
