use std::sync::{Arc, Mutex};

use ai_toolset::schema::generate_validated_input_schema;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use channel_sender::ChannelSender;
use chrono::{TimeZone, Utc};
use entity_access::domain::{
    models::{
        AccessError, BotAccessScope, BotId, CallChannelInfo, Entity, EntityAccessAuth,
        EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, TeamRole,
        UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use models_permissions::share_permission::access_level::AccessLevel;
use uuid::Uuid;

use super::{
    Comment, DeleteComment, DiscussionParentType, EditComment, MessageToolContext, ReadDiscussion,
    ResolveComment,
};
use crate::domain::{
    api::{MessageCommands, MessageReader},
    models::{
        Message, MessageAttribution, MessageListItem, MessageParent, MessageThread,
        MessageThreadPreview, PostMessage, PostMessageNotificationPolicy, ThreadAnchor,
        ThreadPatch, ThreadState,
    },
    ports::{MessageError, MessagePage, MessagePatch, MessageTimelinePage, MessageTimelineQuery},
    service::{MessageView, MessageWrite},
};

const USER: &str = "macro|commenter@example.com";
const INITIATIVE: Uuid = Uuid::from_u128(0x019fd3b9_3c6c_7c05_89c2_a27f0121813b);
const THREAD: Uuid = Uuid::from_u128(7);
const REPLY: Uuid = Uuid::from_u128(8);
const CHANNEL: Uuid = Uuid::from_u128(9);
const POSTED: Uuid = Uuid::from_u128(99);

fn at() -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 23, 12, 0, 0).unwrap()
}

fn initiative() -> MessageParent {
    MessageParent::Initiative(INITIATIVE)
}

fn user_sender() -> ChannelSender<'static> {
    ChannelSender::try_from(USER.to_owned()).unwrap()
}

fn bot_sender() -> ChannelSender<'static> {
    ChannelSender::try_from(bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()).unwrap()
}

fn message(id: Uuid, thread_id: Option<Uuid>, sender: ChannelSender<'static>) -> Message {
    Message {
        id,
        parent: initiative(),
        thread_id,
        sender_id: sender,
        guest_name: None,
        imported_author: None,
        bot_profile: None,
        mentions: vec![],
        triggered_by: None,
        content: format!("comment {id}"),
        created_at: at(),
        updated_at: at(),
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

fn thread(root: Uuid, replies: Vec<Message>, anchor: Option<ThreadAnchor>) -> MessageThread {
    MessageThread {
        state: ThreadState {
            root_id: root,
            user_id: USER.to_owned(),
            resolved: false,
            anchor,
            created_at: at(),
            updated_at: at(),
            deleted_at: None,
        },
        root: message(root, None, user_sender()),
        replies,
    }
}

/// Records the writes the tools make. `parent` is what every id resolves
/// to; `thread_exists` false answers a reply as the message service does
/// for a thread not on the item.
#[derive(Clone)]
struct FakeMessages {
    parent: Option<MessageParent>,
    thread_exists: bool,
    /// Author of the stored comment `get` returns; reads panic when unset.
    comment_author: Option<ChannelSender<'static>>,
    /// Whether the stored comment is a reply rather than a thread's first comment.
    comment_is_reply: bool,
    /// Refuse every comment edit or delete as the message service refuses a non-author.
    forbid_changes: bool,
    /// Threads the timeline lists, newest first. The preview holds one
    /// reply at most, so longer threads are read in full.
    threads: Vec<MessageThread>,
    parent_lookups: Recorded<Uuid>,
    posts: Recorded<(EntityAccessReceipt<MessageWrite>, PostMessage)>,
    thread_patches: Recorded<(EntityAccessReceipt<MessageWrite>, Uuid, ThreadPatch)>,
    comment_patches: Recorded<(EntityAccessReceipt<MessageWrite>, Uuid, MessagePatch)>,
    comment_deletes: Recorded<(EntityAccessReceipt<MessageWrite>, Uuid)>,
}

/// The calls a fake records, shared with the test that inspects them.
type Recorded<T> = Arc<Mutex<Vec<T>>>;

impl Default for FakeMessages {
    fn default() -> Self {
        Self {
            parent: Some(initiative()),
            thread_exists: true,
            comment_author: None,
            comment_is_reply: false,
            forbid_changes: false,
            threads: vec![],
            parent_lookups: Arc::default(),
            posts: Arc::default(),
            thread_patches: Arc::default(),
            comment_patches: Arc::default(),
            comment_deletes: Arc::default(),
        }
    }
}

impl FakeMessages {
    fn with_comment_by(author: ChannelSender<'static>) -> Self {
        Self {
            comment_author: Some(author),
            ..Self::default()
        }
    }

    fn stored_comment(&self, id: Uuid) -> Message {
        message(
            id,
            self.comment_is_reply.then_some(THREAD),
            self.comment_author
                .clone()
                .expect("test configured a stored comment"),
        )
    }
}

#[async_trait::async_trait]
impl MessageReader for FakeMessages {
    async fn get(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        Ok(self.stored_comment(id))
    }
    async fn get_thread(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        root: Uuid,
    ) -> Result<MessageThread, MessageError> {
        self.threads
            .iter()
            .find(|thread| thread.root.id == root)
            .cloned()
            .ok_or(MessageError::NotFound)
    }
    async fn timeline(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        Ok(MessagePage {
            items: self
                .threads
                .iter()
                .map(|thread| MessageListItem {
                    message: thread.root.clone(),
                    state: thread.state.clone(),
                    thread: MessageThreadPreview {
                        reply_count: thread.replies.len() as i64,
                        latest_reply_at: None,
                        preview: thread.replies.iter().take(1).cloned().collect(),
                    },
                })
                .collect(),
            next_cursor: None,
            previous_cursor: None,
        })
    }
    async fn timeline_entries(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _query: MessageTimelineQuery,
    ) -> Result<MessageTimelinePage, MessageError> {
        panic!("unexpected timeline_entries call")
    }
    async fn preceding(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _id: Uuid,
        _limit: u16,
    ) -> Result<Vec<Message>, MessageError> {
        panic!("unexpected preceding call")
    }
    async fn resolve_legacy(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _id: i64,
        _is_thread: bool,
    ) -> Result<Message, MessageError> {
        panic!("unexpected resolve_legacy call")
    }
    async fn parent_of(&self, id: Uuid) -> Result<Option<MessageParent>, MessageError> {
        self.parent_lookups.lock().unwrap().push(id);
        Ok(self.parent.clone())
    }
}

#[async_trait::async_trait]
impl MessageCommands for FakeMessages {
    async fn post_from_event(
        &self,
        _: EntityAccessReceipt<MessageWrite>,
        _: Uuid,
        _: PostMessage,
    ) -> Result<Message, MessageError> {
        panic!("discussion tools do not post broker events")
    }
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError> {
        if input.thread_id.is_some() && !self.thread_exists {
            return Err(MessageError::NotFound);
        }
        let posted = Message {
            content: input.content.clone(),
            triggered_by: Some(USER.to_owned()),
            ..message(POSTED, input.thread_id, bot_sender())
        };
        self.posts.lock().unwrap().push((access, input));
        Ok(posted)
    }
    async fn patch(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        input: MessagePatch,
    ) -> Result<Message, MessageError> {
        if self.forbid_changes {
            return Err(MessageError::Forbidden);
        }
        self.comment_patches
            .lock()
            .unwrap()
            .push((access, id, input));
        Ok(self.stored_comment(id))
    }
    async fn delete(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        _nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        if self.forbid_changes {
            return Err(MessageError::Forbidden);
        }
        self.comment_deletes.lock().unwrap().push((access, id));
        Ok(self.stored_comment(id))
    }
    async fn react(
        &self,
        _access: EntityAccessReceipt<MessageWrite>,
        _id: Uuid,
        _emoji: String,
        _add: bool,
        _nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        panic!("unexpected react call")
    }
    async fn typing(
        &self,
        _access: EntityAccessReceipt<MessageWrite>,
        _root: Option<Uuid>,
        _active: bool,
        _nonce: Option<String>,
    ) -> Result<(), MessageError> {
        panic!("unexpected typing call")
    }
    async fn patch_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        patch: ThreadPatch,
    ) -> Result<ThreadState, MessageError> {
        if !self.thread_exists {
            return Err(MessageError::NotFound);
        }
        let state = ThreadState {
            root_id,
            user_id: USER.to_owned(),
            resolved: patch.resolved.unwrap_or_default(),
            anchor: None,
            created_at: at(),
            updated_at: at(),
            deleted_at: None,
        };
        self.thread_patches
            .lock()
            .unwrap()
            .push((access, root_id, patch));
        Ok(state)
    }
    async fn delete_thread(
        &self,
        _access: EntityAccessReceipt<MessageWrite>,
        _root_id: Uuid,
        _nonce: Option<String>,
    ) -> Result<ThreadState, MessageError> {
        panic!("unexpected delete_thread call")
    }
}

/// Grants `access_level` on every entity, or finds none of them.
#[derive(Clone)]
struct FakeEntityAccessService {
    access_level: AccessLevel,
    not_found: bool,
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if self.not_found {
            return Err(AccessError::NotFound("entity"));
        }
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::try_from(user_id.as_ref().to_string())
                .expect("test user id should be valid"),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: self.access_level,
            },
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if self.not_found {
            return Err(AccessError::NotFound("entity"));
        }
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: self.access_level,
            },
        )
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected get_access_level call")
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected get_user_team call")
    }
}

type TestToolContext = MessageToolContext<FakeEntityAccessService>;

fn context(access_level: AccessLevel, messages: FakeMessages) -> ServiceContext<TestToolContext> {
    ServiceContext(MessageToolContext::new(
        Arc::new(messages),
        Arc::new(FakeEntityAccessService {
            access_level,
            not_found: false,
        }),
    ))
}

fn context_without_items(messages: FakeMessages) -> ServiceContext<TestToolContext> {
    ServiceContext(MessageToolContext::new(
        Arc::new(messages),
        Arc::new(FakeEntityAccessService {
            access_level: AccessLevel::Owner,
            not_found: true,
        }),
    ))
}

fn request() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from(USER.to_owned()).unwrap())
}

fn comment_on_initiative(content: &str) -> Comment {
    Comment {
        entity_type: Some(DiscussionParentType::Initiative),
        entity_id: Some(INITIATIVE.to_string()),
        thread_id: None,
        content: content.to_owned(),
    }
}

fn reply(thread_id: Uuid, content: &str) -> Comment {
    Comment {
        entity_type: None,
        entity_id: None,
        thread_id: Some(thread_id),
        content: content.to_owned(),
    }
}

/// The write went to the initiative as the tool actor bot on the user's behalf.
fn assert_bot_on_initiative(access: &EntityAccessReceipt<MessageWrite>) {
    assert_eq!(access.entity().entity_id, INITIATIVE.to_string());
    assert_eq!(access.entity().entity_type, EntityType::Initiative);
    assert!(matches!(access.auth(), EntityAccessAuth::Bot(_)));
    assert_eq!(
        access.acting_user_id().map(|user| user.as_ref()),
        Some(USER)
    );
}

fn assert_user_on_initiative(access: &EntityAccessReceipt<MessageWrite>) {
    assert_eq!(access.entity().entity_id, INITIATIVE.to_string());
    assert_eq!(access.entity().entity_type, EntityType::Initiative);
    assert!(matches!(access.auth(), EntityAccessAuth::Authenticated(_)));
}

#[tokio::test]
async fn comment_on_a_project_posts_as_the_bot_for_the_user() {
    let messages = FakeMessages::default();
    let response = comment_on_initiative("Rollout tracking lives in two docs.")
        .call(context(AccessLevel::Comment, messages.clone()), request())
        .await
        .unwrap();

    assert_eq!(response.entity_type, DiscussionParentType::Initiative);
    assert_eq!(response.entity_id, INITIATIVE.to_string());
    assert_eq!(response.thread_id, response.comment_id);
    assert_eq!(response.comment_id, POSTED);
    let posts = messages.posts.lock().unwrap();
    let [(access, post)] = posts.as_slice() else {
        panic!("expected one post, got {}", posts.len());
    };
    assert_bot_on_initiative(access);
    assert_eq!(post.thread_id, None);
    assert_eq!(post.content, "Rollout tracking lives in two docs.");
    assert_eq!(post.attribution, MessageAttribution::ActingUser);
    assert_eq!(
        post.notification_policy,
        PostMessageNotificationPolicy::Default
    );
    assert!(post.anchor.is_none());
    assert!(messages.parent_lookups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reply_by_thread_id_alone_finds_its_item() {
    let messages = FakeMessages::default();
    let response = reply(THREAD, "Fixed in the latest draft.")
        .call(context(AccessLevel::Comment, messages.clone()), request())
        .await
        .unwrap();

    assert_eq!(response.entity_type, DiscussionParentType::Initiative);
    assert_eq!(response.entity_id, INITIATIVE.to_string());
    assert_eq!(response.thread_id, THREAD);
    assert_eq!(response.comment_id, POSTED);
    assert_eq!(*messages.parent_lookups.lock().unwrap(), vec![THREAD]);
    let posts = messages.posts.lock().unwrap();
    assert_bot_on_initiative(&posts[0].0);
    assert_eq!(posts[0].1.thread_id, Some(THREAD));
}

#[tokio::test]
async fn reply_with_its_item_given_needs_no_lookup() {
    let messages = FakeMessages {
        parent: None,
        ..FakeMessages::default()
    };
    let mut tool = comment_on_initiative("Done.");
    tool.thread_id = Some(THREAD);
    let response = tool
        .call(context(AccessLevel::Comment, messages.clone()), request())
        .await
        .unwrap();

    assert_eq!(response.thread_id, THREAD);
    assert!(messages.parent_lookups.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reply_to_a_thread_not_on_the_item_says_so() {
    let messages = FakeMessages {
        thread_exists: false,
        ..FakeMessages::default()
    };
    let mut tool = comment_on_initiative("Done.");
    tool.thread_id = Some(THREAD);
    let error = tool
        .call(context(AccessLevel::Edit, messages), request())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("thread not found"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn comment_needs_a_target() {
    let messages = FakeMessages::default();
    let error = Comment {
        entity_type: None,
        entity_id: None,
        thread_id: None,
        content: "Looks good.".to_owned(),
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap_err();

    assert!(
        error.description.contains("entityType and entityId"),
        "{}",
        error.description
    );
    assert!(messages.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn entity_type_without_entity_id_is_refused() {
    let error = Comment {
        entity_type: Some(DiscussionParentType::Document),
        entity_id: None,
        thread_id: None,
        content: "Looks good.".to_owned(),
    }
    .call(
        context(AccessLevel::Comment, FakeMessages::default()),
        request(),
    )
    .await
    .unwrap_err();

    assert!(
        error.description.contains("go together"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn comment_needs_comment_access() {
    let messages = FakeMessages::default();
    let error = comment_on_initiative("Looks good.")
        .call(context(AccessLevel::View, messages.clone()), request())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("comment access"),
        "{}",
        error.description
    );
    assert!(messages.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_an_unknown_item_points_at_the_kind() {
    let error = comment_on_initiative("Looks good.")
        .call(context_without_items(FakeMessages::default()), request())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("no project with id"),
        "{}",
        error.description
    );
    assert!(
        error.description.contains("entityType"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn reply_in_a_channel_thread_is_refused() {
    let messages = FakeMessages {
        parent: Some(MessageParent::Channel(CHANNEL)),
        ..FakeMessages::default()
    };
    let error = reply(THREAD, "Looks good.")
        .call(context(AccessLevel::Comment, messages.clone()), request())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("channel"),
        "{}",
        error.description
    );
    assert!(messages.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reply_to_an_unknown_thread_says_so() {
    let messages = FakeMessages {
        parent: None,
        ..FakeMessages::default()
    };
    let error = reply(THREAD, "Looks good.")
        .call(context(AccessLevel::Comment, messages), request())
        .await
        .unwrap_err();

    assert!(
        error.description.contains("no comment or thread"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn read_discussion_lists_threads_oldest_first_with_every_live_reply() {
    let older = Uuid::from_u128(1);
    let newer = Uuid::from_u128(2);
    let deleted_reply = Message {
        deleted_at: Some(at()),
        ..message(Uuid::from_u128(12), Some(older), user_sender())
    };
    let messages = FakeMessages {
        threads: vec![
            thread(
                newer,
                vec![message(Uuid::from_u128(21), Some(newer), bot_sender())],
                Some(ThreadAnchor::Markdown {
                    mark_id: Uuid::from_u128(5),
                    marked_text: Some("ships on Friday".to_owned()),
                }),
            ),
            thread(
                older,
                vec![
                    message(Uuid::from_u128(11), Some(older), user_sender()),
                    deleted_reply,
                    message(Uuid::from_u128(13), Some(older), user_sender()),
                ],
                None,
            ),
        ],
        ..FakeMessages::default()
    };
    let response = ReadDiscussion {
        entity_type: DiscussionParentType::Initiative,
        entity_id: INITIATIVE.to_string(),
    }
    .call(context(AccessLevel::View, messages), request())
    .await
    .unwrap();

    assert_eq!(response.entity_type, DiscussionParentType::Initiative);
    assert_eq!(response.entity_id, INITIATIVE.to_string());
    let [first, second] = response.threads.as_slice() else {
        panic!("expected two threads, got {}", response.threads.len());
    };
    assert_eq!(first.id, older);
    assert!(first.marked_text.is_none());
    assert_eq!(
        first
            .comments
            .iter()
            .map(|comment| comment.id)
            .collect::<Vec<_>>(),
        vec![older, Uuid::from_u128(11), Uuid::from_u128(13)]
    );
    assert_eq!(second.id, newer);
    assert_eq!(second.marked_text.as_deref(), Some("ships on Friday"));
    assert_eq!(second.comments.len(), 2);
    assert_eq!(
        second.comments[1].author,
        bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()
    );
}

#[tokio::test]
async fn read_discussion_on_an_unknown_item_points_at_the_kind() {
    let error = ReadDiscussion {
        entity_type: DiscussionParentType::CrmCompany,
        entity_id: INITIATIVE.to_string(),
    }
    .call(context_without_items(FakeMessages::default()), request())
    .await
    .unwrap_err();

    assert!(
        error.description.contains("no company with id"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn read_discussion_rejects_an_invalid_id() {
    let error = ReadDiscussion {
        entity_type: DiscussionParentType::Initiative,
        entity_id: "not-a-uuid".to_owned(),
    }
    .call(
        context(AccessLevel::View, FakeMessages::default()),
        request(),
    )
    .await
    .unwrap_err();

    assert_eq!(error.description, "not-a-uuid is not a valid project id");
}

#[tokio::test]
async fn resolve_resolves_the_thread_as_the_bot_for_the_user() {
    let messages = FakeMessages::default();
    let response = ResolveComment {
        thread_id: THREAD,
        resolved: true,
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap();

    assert_eq!(response.entity_type, DiscussionParentType::Initiative);
    assert_eq!(response.entity_id, INITIATIVE.to_string());
    assert_eq!(response.thread_id, THREAD);
    assert!(response.resolved);
    let patches = messages.thread_patches.lock().unwrap();
    let [(access, root, patch)] = patches.as_slice() else {
        panic!("expected one thread update, got {}", patches.len());
    };
    assert_bot_on_initiative(access);
    assert_eq!(*root, THREAD);
    assert_eq!(patch.resolved, Some(true));
    assert!(!patch.detach_anchor);
}

#[tokio::test]
async fn resolve_false_reopens_the_thread() {
    let messages = FakeMessages::default();
    let response = ResolveComment {
        thread_id: THREAD,
        resolved: false,
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap();

    assert!(!response.resolved);
    assert_eq!(
        messages.thread_patches.lock().unwrap()[0].2.resolved,
        Some(false)
    );
}

#[test]
fn resolve_defaults_to_resolving() {
    let tool: ResolveComment = serde_json::from_value(serde_json::json!({
        "threadId": THREAD,
    }))
    .unwrap();

    assert!(tool.resolved);
}

#[tokio::test]
async fn resolve_needs_comment_access() {
    let messages = FakeMessages::default();
    let error = ResolveComment {
        thread_id: THREAD,
        resolved: true,
    }
    .call(context(AccessLevel::View, messages.clone()), request())
    .await
    .unwrap_err();

    assert!(
        error.description.contains("comment access"),
        "{}",
        error.description
    );
    assert!(messages.thread_patches.lock().unwrap().is_empty());
}

#[tokio::test]
async fn edit_comment_rewrites_the_users_own_comment_as_the_user() {
    let messages = FakeMessages::with_comment_by(user_sender());
    let patches = messages.comment_patches.clone();

    let response = EditComment {
        comment_id: THREAD,
        content: "clearer wording".to_owned(),
    }
    .call(context(AccessLevel::Comment, messages), request())
    .await
    .expect("the author can edit their comment");

    assert_eq!(response.entity_id, INITIATIVE.to_string());
    let patches = patches.lock().unwrap();
    let [(access, id, patch)] = patches.as_slice() else {
        panic!("expected one edit, got {}", patches.len());
    };
    assert_user_on_initiative(access);
    assert_eq!(*id, THREAD);
    assert_eq!(patch.content.as_deref(), Some("clearer wording"));
}

#[tokio::test]
async fn edit_comment_rewrites_the_assistants_comment_as_the_bot() {
    let messages = FakeMessages::with_comment_by(bot_sender());
    let patches = messages.comment_patches.clone();

    EditComment {
        comment_id: THREAD,
        content: "corrected".to_owned(),
    }
    .call(context(AccessLevel::Comment, messages), request())
    .await
    .expect("the assistant can edit its own comment");

    assert_bot_on_initiative(&patches.lock().unwrap()[0].0);
}

#[tokio::test]
async fn edit_comment_explains_that_only_the_author_can_edit() {
    let messages = FakeMessages {
        forbid_changes: true,
        ..FakeMessages::with_comment_by(user_sender())
    };

    let error = EditComment {
        comment_id: THREAD,
        content: "rewrite".to_owned(),
    }
    .call(context(AccessLevel::Comment, messages), request())
    .await
    .expect_err("the message service refused the edit");

    assert!(
        error.description.contains("author"),
        "{}",
        error.description
    );
}

#[tokio::test]
async fn edit_comment_rejects_empty_text() {
    let error = EditComment {
        comment_id: THREAD,
        content: " ".to_owned(),
    }
    .call(
        context(AccessLevel::Comment, FakeMessages::default()),
        request(),
    )
    .await
    .expect_err("empty edits are refused");

    assert!(error.description.contains("DeleteComment"));
}

#[tokio::test]
async fn delete_comment_reports_whether_the_thread_went_with_it() {
    let root = FakeMessages::with_comment_by(user_sender());
    let root_deletes = root.comment_deletes.clone();
    let response = DeleteComment { comment_id: THREAD }
        .call(context(AccessLevel::Comment, root), request())
        .await
        .expect("the author can delete their comment");
    assert!(response.deleted_thread);
    assert_eq!(response.entity_id, INITIATIVE.to_string());
    assert_user_on_initiative(&root_deletes.lock().unwrap()[0].0);

    let reply = FakeMessages {
        comment_is_reply: true,
        ..FakeMessages::with_comment_by(user_sender())
    };
    let response = DeleteComment { comment_id: REPLY }
        .call(context(AccessLevel::Comment, reply), request())
        .await
        .expect("the author can delete their reply");
    assert!(!response.deleted_thread);
}

#[tokio::test]
async fn delete_comment_explains_who_can_delete() {
    let messages = FakeMessages {
        forbid_changes: true,
        ..FakeMessages::with_comment_by(user_sender())
    };

    let error = DeleteComment { comment_id: THREAD }
        .call(context(AccessLevel::Comment, messages), request())
        .await
        .expect_err("the message service refused the delete");

    assert!(
        error.description.contains("project's owner"),
        "{}",
        error.description
    );
}

#[test]
fn tool_schemas_are_valid() {
    for (name, result) in [
        (
            "ReadDiscussion",
            generate_validated_input_schema::<ReadDiscussion>(),
        ),
        ("Comment", generate_validated_input_schema::<Comment>()),
        (
            "EditComment",
            generate_validated_input_schema::<EditComment>(),
        ),
        (
            "DeleteComment",
            generate_validated_input_schema::<DeleteComment>(),
        ),
        (
            "ResolveComment",
            generate_validated_input_schema::<ResolveComment>(),
        ),
    ] {
        let validated = result.unwrap_or_else(|error| panic!("{name}: {error:?}"));
        assert_eq!(validated.name, name);
    }

    let schema = schemars::schema_for!(Comment).to_value();
    assert_eq!(schema["required"], serde_json::json!(["content"]));
    let properties = schema["properties"].as_object().unwrap();
    for name in ["entityType", "entityId", "threadId", "content"] {
        assert!(properties.contains_key(name), "missing {name}");
    }
}
