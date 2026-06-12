use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use channels::domain::models::{
    AttachmentEntityReference, ChannelAttachmentType, ChannelContextMessage, ChannelMessageFilters,
    ChannelParticipant, MessagePageDirection, MutatedMessage, PostMessageResponse,
    ResolvedChannelMessage, Sender, ThreadReply,
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
    thread_replies: Vec<ThreadReply>,
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
        // Record only the wide context fetch; the thread-parent lookup uses
        // a zero-width window.
        if before > 0 || after > 0 {
            *self.around_args.lock().unwrap() = Some((channel_id, message_id, before, after));
        }
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
        let replies = self.thread_replies.clone();
        async move { Ok(replies) }
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

/// Channel service fake for the post-thinking-then-patch flow. Posting always
/// succeeds; patching either records the content or reports the message as
/// missing (deleted while the agent ran).
struct MutationChannelService {
    thinking_deleted: bool,
    patched: Mutex<Vec<String>>,
}

impl MutationChannelService {
    fn new(thinking_deleted: bool) -> Self {
        Self {
            thinking_deleted,
            patched: Mutex::new(Vec::new()),
        }
    }
}

impl ChannelService for MutationChannelService {
    fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
        _notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> impl Future<Output = Result<ChannelAttachmentsPage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn get_message_context(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _before: i64,
        _after: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>, ChannelMessagesErr>> + Send {
        async move { Ok(Vec::new()) }
    }

    fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, ChannelMessagesErr>> + Send
    {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReply>, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn resolve_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<ResolvedChannelMessage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for mutation tests") }
    }

    fn post_message(
        &self,
        _actor: Sender,
        _channel_id: Uuid,
        _req: PostMessageRequest,
    ) -> impl Future<Output = Result<PostMessageResponse, ChannelMutationErr>> + Send {
        async move {
            Ok(PostMessageResponse {
                id: Uuid::new_v4().to_string(),
                nonce: None,
            })
        }
    }

    fn patch_message(
        &self,
        _actor: Sender,
        _actor_role: ParticipantRole,
        _channel_id: Uuid,
        _message_id: Uuid,
        req: PatchMessageRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        if !self.thinking_deleted {
            self.patched
                .lock()
                .unwrap()
                .extend(req.content.clone().into_iter());
        }
        let thinking_deleted = self.thinking_deleted;
        async move {
            if thinking_deleted {
                return Err(ChannelMutationErr::NotFound(
                    "message not found".to_string(),
                ));
            }
            Ok(())
        }
    }
}

struct FixedResponder(&'static str);

#[async_trait]
impl AgentResponder for FixedResponder {
    async fn respond(&self, _user_id: &str, _prompt: String) -> anyhow::Result<String> {
        Ok(self.0.to_string())
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

fn thread_reply(id: Uuid, sender_id: &str, content: &str) -> ThreadReply {
    let now = Utc::now();
    ThreadReply {
        id,
        sender_id: sender_id.to_string(),
        bot_profile: None,
        content: content.to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        reactions: Vec::new(),
        attachments: Vec::new(),
    }
}

fn mention_event(
    channel_id: Uuid,
    trigger_id: Uuid,
    thread_id: Option<Uuid>,
    sender_email: &str,
    content: &str,
) -> BotEvent {
    BotEvent {
        trigger: BotTrigger::Mention,
        channel_id,
        message: MutatedMessage {
            id: trigger_id,
            channel_id,
            thread_id,
            sender_id: Sender::User(user_id(sender_email)),
            content: content.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            edited_at: None,
            deleted_at: None,
        },
        reply_thread_id: thread_id.unwrap_or(trigger_id),
        requesting_user: user_id(sender_email),
    }
}

#[tokio::test]
async fn handle_patches_thinking_message_with_reply() {
    let channel_id = Uuid::new_v4();
    let channels = Arc::new(MutationChannelService::new(false));
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(FixedResponder("the answer")));

    handler
        .handle(&mention_event(
            channel_id,
            Uuid::new_v4(),
            None,
            "teo@example.com",
            "@macro help",
        ))
        .await
        .unwrap();

    assert_eq!(
        channels.patched.lock().unwrap().clone(),
        vec!["the answer".to_string()]
    );
}

#[tokio::test]
async fn handle_drops_reply_when_thinking_message_was_deleted() {
    let channel_id = Uuid::new_v4();
    let channels = Arc::new(MutationChannelService::new(true));
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(FixedResponder("the answer")));

    handler
        .handle(&mention_event(
            channel_id,
            Uuid::new_v4(),
            None,
            "teo@example.com",
            "@macro help",
        ))
        .await
        .unwrap();

    assert!(channels.patched.lock().unwrap().is_empty());
}

#[tokio::test]
async fn top_level_prompt_marks_trigger_inline_in_channel_context() {
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
        thread_replies: Vec::new(),
    });
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(TestResponder));
    let event = mention_event(
        channel_id,
        trigger_id,
        None,
        "teo@example.com",
        "@macro help",
    );

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
    assert!(prompt.contains("mentioned you (@macro) in a channel."));
    assert!(prompt.contains("<channel_context>"));
    assert!(prompt.contains("</channel_context>"));
    assert!(prompt.contains("alice: before"));
    assert!(prompt.contains("bob: after"));
    assert!(prompt.contains("teo [this message mentioned you]: @macro help"));
    // The trigger appears once, inline, not repeated at the end.
    assert_eq!(prompt.matches("@macro help").count(), 1);
    assert!(!prompt.contains("<thread>"));
    assert!(prompt.ends_with("Reply to teo."));
}

#[tokio::test]
async fn thread_prompt_puts_thread_first_and_demotes_channel_noise() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let trigger_id = Uuid::new_v4();
    let unrelated_id = Uuid::new_v4();

    let mut trigger_context = context_message(
        channel_id,
        trigger_id,
        "macro|austin@example.com",
        "@macro can you make a task out of this?",
    );
    trigger_context.thread_id = Some(parent_id);

    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: vec![
            context_message(
                channel_id,
                parent_id,
                "macro|peter@example.com",
                "We stopped persisting filter/sort across refresh",
            ),
            context_message(
                channel_id,
                unrelated_id,
                "macro|carol@example.com",
                "unrelated tasks view chatter",
            ),
            trigger_context,
        ],
        thread_replies: vec![thread_reply(
            trigger_id,
            "macro|austin@example.com",
            "@macro can you make a task out of this?",
        )],
    });
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(TestResponder));
    let event = mention_event(
        channel_id,
        trigger_id,
        Some(parent_id),
        "austin@example.com",
        "@macro can you make a task out of this?",
    );

    let prompt = handler.build_prompt(&event).await;

    assert!(prompt.contains("austin mentioned you (@macro) in a channel thread."));

    // Thread block comes first and contains parent + marked trigger.
    let thread_start = prompt.find("<thread>").expect("thread block");
    let thread_end = prompt.find("</thread>").expect("thread block end");
    let thread_block = &prompt[thread_start..thread_end];
    assert!(thread_block.contains("peter: We stopped persisting filter/sort across refresh"));
    assert!(
        thread_block.contains(
            "austin [this message mentioned you]: @macro can you make a task out of this?"
        )
    );
    assert!(!thread_block.contains("carol"));

    // Channel noise is demoted to the background block, with thread messages excluded.
    let background_start = prompt
        .find("<channel_background>")
        .expect("background block");
    assert!(background_start > thread_end);
    let background_end = prompt
        .find("</channel_background>")
        .expect("background end");
    let background_block = &prompt[background_start..background_end];
    assert!(background_block.contains("carol: unrelated tasks view chatter"));
    assert!(!background_block.contains("peter:"));
    assert!(!background_block.contains("austin"));

    // The trigger appears exactly once across the whole prompt.
    assert_eq!(
        prompt
            .matches("@macro can you make a task out of this?")
            .count(),
        1
    );
    assert!(prompt.ends_with("Reply to austin."));
}

#[tokio::test]
async fn thread_prompt_includes_trigger_when_reply_fetch_fails_to_return_it() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let trigger_id = Uuid::new_v4();

    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: vec![context_message(
            channel_id,
            parent_id,
            "macro|peter@example.com",
            "parent message",
        )],
        thread_replies: Vec::new(),
    });
    let handler = MacroAiHandler::new(channels.clone(), Arc::new(TestResponder));
    let event = mention_event(
        channel_id,
        trigger_id,
        Some(parent_id),
        "austin@example.com",
        "@macro help with this",
    );

    let prompt = handler.build_prompt(&event).await;

    assert!(prompt.contains("peter: parent message"));
    assert!(prompt.contains("austin [this message mentioned you]: @macro help with this"));
}
