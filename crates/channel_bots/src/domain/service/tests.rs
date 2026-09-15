use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use channels::domain::models::{
    AttachmentEntityReference, ChannelAttachmentType, ChannelContextMessage, ChannelMessageFilters,
    ChannelParticipant, MessagePageDirection, MutatedMessage, PatchMessageRequest,
    PostMessageRequest, PostMessageResponse, ResolvedChannelMessage, Sender, ThreadReply,
};
use channels::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesQueryResult, ChannelMutationErr,
    ChannelService,
};
use chrono::{TimeZone as _, Utc};
use entity_access::domain::models::{
    BotReceiptScope, Entity, EntityAccessReceipt, EntityPermission, EntityType, ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::{PatchMessageNotificationPolicy, PostMessageNotificationPolicy};
use messages::domain::{
    models::{Message, MessageParent, ThreadPatch, ThreadState},
    ports::{MessageError, MessagePatch},
    service::MessageWrite,
};
use models_pagination::{CreatedAt, Query};
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{BotEvent, BotTrigger},
    ports::{AgentResponder, ConversationAccess, UserTimeZones},
};

/// Mints Macro AI write capabilities for whichever user asked.
struct GrantingAccess;

#[async_trait]
impl ConversationAccess for GrantingAccess {
    async fn bot_write(
        &self,
        user: &MacroUserIdStr<'static>,
        parent: &MessageParent,
    ) -> Result<EntityAccessReceipt<MessageWrite>, rootcause::Report> {
        Ok(EntityAccessReceipt::try_new_bot(
            bot_id::MACRO_AI_BOT_ID.into_storage_id(),
            BotReceiptScope::User {
                acting_user: user.clone(),
            },
            Entity {
                entity_id: parent.entity_id(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )?)
    }
}

/// Records the shared message writes the handler makes.
struct RecordingMessages {
    thinking_deleted: bool,
    posted: Mutex<Vec<(EntityAccessReceipt<MessageWrite>, PostMessage)>>,
    patched: Mutex<Vec<(EntityAccessReceipt<MessageWrite>, Uuid, MessagePatch)>>,
}

impl RecordingMessages {
    fn new(thinking_deleted: bool) -> Self {
        Self {
            thinking_deleted,
            posted: Mutex::new(Vec::new()),
            patched: Mutex::new(Vec::new()),
        }
    }

    fn posted_policies(&self) -> Vec<PostMessageNotificationPolicy> {
        self.posted
            .lock()
            .unwrap()
            .iter()
            .map(|(_, input)| input.notification_policy)
            .collect()
    }

    fn patched_contents(&self) -> Vec<String> {
        self.patched
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(_, _, patch)| patch.content.clone())
            .collect()
    }

    fn patched_policies(&self) -> Vec<PatchMessageNotificationPolicy> {
        self.patched
            .lock()
            .unwrap()
            .iter()
            .map(|(_, _, patch)| patch.notification_policy)
            .collect()
    }
}

fn shared_message(access: &EntityAccessReceipt<MessageWrite>, content: &str) -> Message {
    Message {
        id: Uuid::new_v4(),
        parent: MessageParent::parse("channel", &access.entity().entity_id).unwrap(),
        thread_id: None,
        sender_id: Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
        imported_author: None,
        bot_profile: None,
        mentions: Vec::new(),
        triggered_by: access
            .acting_user_id()
            .map(|user| user.as_ref().to_string()),
        content: content.to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        edited_at: None,
        deleted_at: None,
        attachments: Vec::new(),
        reactions: Vec::new(),
    }
}

#[async_trait]
impl MessageCommands for RecordingMessages {
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError> {
        let message = shared_message(&access, &input.content);
        self.posted.lock().unwrap().push((access, input));
        Ok(message)
    }
    async fn patch(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        input: MessagePatch,
    ) -> Result<Message, MessageError> {
        if self.thinking_deleted {
            return Err(MessageError::NotFound);
        }
        let message = shared_message(&access, input.content.as_deref().unwrap_or_default());
        self.patched.lock().unwrap().push((access, id, input));
        Ok(message)
    }
    async fn delete(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Uuid,
        _: Option<String>,
    ) -> Result<Message, MessageError> {
        unimplemented!()
    }
    async fn react(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Uuid,
        _: String,
        _: bool,
        _: Option<String>,
    ) -> Result<Message, MessageError> {
        unimplemented!()
    }
    async fn typing(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Option<Uuid>,
        _: bool,
        _: Option<String>,
    ) -> Result<(), MessageError> {
        unimplemented!()
    }
    async fn patch_thread(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Uuid,
        _: ThreadPatch,
    ) -> Result<ThreadState, MessageError> {
        unimplemented!()
    }
    async fn delete_thread(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Uuid,
        _: Option<String>,
    ) -> Result<ThreadState, MessageError> {
        unimplemented!()
    }
}

/// Time zone fake with a fixed answer.
struct FixedTimeZones(Option<&'static str>);

#[async_trait]
impl UserTimeZones for FixedTimeZones {
    async fn primary_time_zone(&self, _user_id: &str) -> Option<String> {
        self.0.map(str::to_string)
    }
}

fn eastern_time_zones() -> Arc<FixedTimeZones> {
    Arc::new(FixedTimeZones(Some("America/New_York")))
}

struct TestChannelService {
    around_args: Mutex<Option<(Uuid, Uuid, i64, i64)>>,
    around_messages: Vec<ChannelContextMessage>,
    thread_replies: Vec<ThreadReply>,
}

impl ChannelService for TestChannelService {
    async fn set_channel_picture(
        &self,
        _access: channels::domain::ports::ChannelPictureAccess,
        _picture_id: Option<uuid::Uuid>,
    ) -> Result<(), channels::domain::ports::ChannelMutationErr> {
        unimplemented!("picture mutation is not used by this fixture")
    }

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

/// Channel service fake for the post-thinking-then-patch flow: reads return no
/// context and the legacy write methods are never reached.
struct MutationChannelService;

impl ChannelService for MutationChannelService {
    async fn set_channel_picture(
        &self,
        _access: channels::domain::ports::ChannelPictureAccess,
        _picture_id: Option<uuid::Uuid>,
    ) -> Result<(), channels::domain::ports::ChannelMutationErr> {
        unimplemented!("picture mutation is not used by this fixture")
    }

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
        async move { unimplemented!("replies go through the shared message commands") }
    }

    fn patch_message(
        &self,
        _actor: Sender,
        _actor_role: channels::domain::models::ParticipantRole,
        _channel_id: Uuid,
        _message_id: Uuid,
        _req: PatchMessageRequest,
    ) -> impl Future<Output = Result<(), ChannelMutationErr>> + Send {
        async move { unimplemented!("replies go through the shared message commands") }
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
        triggered_by: None,
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
        triggered_by: None,
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
    bot_event(
        BotTrigger::Mention,
        channel_id,
        trigger_id,
        thread_id,
        sender_email,
        content,
    )
}

fn bot_event(
    trigger: BotTrigger,
    channel_id: Uuid,
    trigger_id: Uuid,
    thread_id: Option<Uuid>,
    sender_email: &str,
    content: &str,
) -> BotEvent {
    BotEvent {
        trigger,
        channel_id,
        message: MutatedMessage {
            id: trigger_id,
            channel_id,
            thread_id,
            sender_id: Sender::new_from_user(user_id(sender_email)),
            content: content.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            edited_at: None,
            deleted_at: None,
            triggered_by: None,
        },
        reply_thread_id: thread_id.unwrap_or(trigger_id),
        requesting_user: user_id(sender_email),
    }
}

#[tokio::test]
async fn handle_patches_thinking_message_with_reply() {
    let channel_id = Uuid::new_v4();
    let channels = Arc::new(MutationChannelService);
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(FixedResponder("the answer")),
        eastern_time_zones(),
    );

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
        messages.posted_policies(),
        vec![PostMessageNotificationPolicy::Silent]
    );
    let posted = messages.posted.lock().unwrap();
    assert_eq!(
        posted[0].0.acting_user_id().map(|user| user.as_ref()),
        Some("macro|teo@example.com")
    );
    assert_eq!(posted[0].0.entity().entity_id, channel_id.to_string());
    assert_eq!(
        posted[0].1.attribution,
        messages::domain::models::MessageAttribution::ActingUser
    );
    drop(posted);
    assert_eq!(messages.patched_contents(), vec!["the answer".to_string()]);
    assert_eq!(
        messages.patched_policies(),
        vec![PatchMessageNotificationPolicy::NotifyAsPostedMessage]
    );
}

#[tokio::test]
async fn handle_drops_reply_when_thinking_message_was_deleted() {
    let channel_id = Uuid::new_v4();
    let channels = Arc::new(MutationChannelService);
    let messages = Arc::new(RecordingMessages::new(true));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(FixedResponder("the answer")),
        eastern_time_zones(),
    );

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

    assert!(messages.patched.lock().unwrap().is_empty());
    assert_eq!(messages.posted.lock().unwrap().len(), 1);
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
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        eastern_time_zones(),
    );
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
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        eastern_time_zones(),
    );
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
async fn inferred_thread_prompt_does_not_claim_a_mention() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let trigger_id = Uuid::new_v4();
    let macro_ai = bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string();

    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: vec![context_message(
            channel_id,
            parent_id,
            "macro|alice@example.com",
            "notifications are broken",
        )],
        thread_replies: vec![
            thread_reply(Uuid::new_v4(), &macro_ai, "what is broken exactly?"),
            thread_reply(trigger_id, "macro|alice@example.com", "it fires twice"),
        ],
    });
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        eastern_time_zones(),
    );
    let event = bot_event(
        BotTrigger::Inferred,
        channel_id,
        trigger_id,
        Some(parent_id),
        "alice@example.com",
        "it fires twice",
    );

    let prompt = handler.build_prompt(&event).await;

    assert!(prompt.contains("alice replied in a channel thread you are part of."));
    assert!(!prompt.contains("mentioned you (@macro)"));
    assert!(prompt.contains("alice [respond to this message]: it fires twice"));
    assert!(!prompt.contains("[this message mentioned you]"));
    assert!(prompt.ends_with("Reply to alice."));
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
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels.clone(),
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        eastern_time_zones(),
    );
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

#[tokio::test]
async fn prompt_carries_the_current_time_in_the_users_zone() {
    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: Vec::new(),
        thread_replies: Vec::new(),
    });
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels,
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        eastern_time_zones(),
    );
    let event = mention_event(
        Uuid::new_v4(),
        Uuid::new_v4(),
        None,
        "teo@example.com",
        "@macro help",
    );

    let prompt = handler.build_prompt(&event).await;

    assert!(prompt.contains("<current_time>"));
    assert!(prompt.contains("America/New_York, the time zone of the user's primary calendar"));
    assert!(prompt.ends_with("Reply to teo."));
}

#[tokio::test]
async fn prompt_says_the_time_zone_is_unknown_without_a_calendar() {
    let channels = Arc::new(TestChannelService {
        around_args: Mutex::new(None),
        around_messages: Vec::new(),
        thread_replies: Vec::new(),
    });
    let messages = Arc::new(RecordingMessages::new(false));
    let handler = MacroAiHandler::new(
        channels,
        messages.clone(),
        Arc::new(GrantingAccess),
        Arc::new(TestResponder),
        Arc::new(FixedTimeZones(None)),
    );
    let event = mention_event(
        Uuid::new_v4(),
        Uuid::new_v4(),
        None,
        "teo@example.com",
        "@macro help",
    );

    let prompt = handler.build_prompt(&event).await;

    assert!(prompt.contains("UTC; the user's own time zone is unknown"));
}

#[test]
fn current_time_block_renders_the_users_zone() {
    let now = Utc.with_ymd_and_hms(2026, 1, 6, 18, 23, 0).unwrap();
    assert_eq!(
        current_time_block(now, Some("America/New_York")),
        "\n<current_time>\nTuesday, January 6, 2026, 1:23 PM — America/New_York, the time zone \
         of the user's primary calendar\n</current_time>\n"
    );
}

#[test]
fn current_time_block_falls_back_to_utc_for_missing_or_bad_zones() {
    let now = Utc.with_ymd_and_hms(2026, 1, 6, 18, 23, 0).unwrap();
    assert_eq!(
        current_time_block(now, None),
        "\n<current_time>\nTuesday, January 6, 2026, 6:23 PM — UTC; the user's own \
         time zone is unknown (no connected calendar)\n</current_time>\n"
    );
    // An unparseable zone still means a calendar is connected, so the line
    // must not claim otherwise.
    assert_eq!(
        current_time_block(now, Some("Not/AZone")),
        "\n<current_time>\nTuesday, January 6, 2026, 6:23 PM — UTC; the user's own \
         time zone is unknown (their calendar's time zone could not be \
         interpreted)\n</current_time>\n"
    );
}
