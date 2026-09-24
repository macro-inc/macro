use std::sync::{Arc, Mutex};

use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use channel_sender::ChannelSender;
use chrono::{TimeZone, Utc};
use entity_access::domain::models::{EntityAccessAuth, EntityAccessReceipt, EntityType};
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    api::{MessageCommands, MessageReader},
    models::{
        Message, MessageAttribution, MessageParent, MessageThread, NewThreadAnchor, PostMessage,
        PostMessageNotificationPolicy, ThreadPatch, ThreadState,
    },
    ports::{MessageError, MessagePage, MessagePatch, MessageTimelineQuery},
    service::{MessageView, MessageWrite},
};
use models_permissions::share_permission::access_level::AccessLevel;
use sync_service_client::SyncServiceClient;
use uuid::Uuid;

use crate::domain::permission_token::decode_permission_token;

use super::{
    DocumentToolContext,
    comment_on_document_text::CommentOnDocumentText,
    edit_document::test::{FakeDocumentService, FakeEditingWorker, FakeEntityAccessService},
    reply_to_document_comment::ReplyToDocumentComment,
    resolve_document_comment::ResolveDocumentComment,
};

const USER: &str = "macro|commenter@example.com";
const DOCUMENT: Uuid = Uuid::from_u128(0x019fd3b9_3c6c_7c05_89c2_a27f0121813b);
const THREAD: Uuid = Uuid::from_u128(7);

/// Records the comment writes the tools make; `thread_exists` false answers
/// them as the message service does for a thread not on the document.
#[derive(Clone)]
pub(in crate::inbound::toolset) struct FakeMessages {
    thread_exists: bool,
    /// Refuse every post, as the message service does an anchor it rejects.
    fail_posts: bool,
    posts: Arc<Mutex<Vec<(EntityAccessReceipt<MessageWrite>, PostMessage)>>>,
    thread_patches: Arc<Mutex<Vec<(EntityAccessReceipt<MessageWrite>, Uuid, ThreadPatch)>>>,
}

impl Default for FakeMessages {
    fn default() -> Self {
        Self {
            thread_exists: true,
            fail_posts: false,
            posts: Arc::default(),
            thread_patches: Arc::default(),
        }
    }
}

#[async_trait::async_trait]
impl MessageReader for FakeMessages {
    async fn get(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _id: Uuid,
    ) -> Result<Message, MessageError> {
        panic!("unexpected get call")
    }
    async fn get_thread(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _root: Uuid,
    ) -> Result<MessageThread, MessageError> {
        panic!("unexpected get_thread call")
    }
    async fn timeline(
        &self,
        _access: EntityAccessReceipt<MessageView>,
        _query: MessageTimelineQuery,
    ) -> Result<MessagePage, MessageError> {
        panic!("unexpected timeline call")
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
}

#[async_trait::async_trait]
impl MessageCommands for FakeMessages {
    async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError> {
        if input.thread_id.is_some() && !self.thread_exists {
            return Err(MessageError::NotFound);
        }
        if self.fail_posts {
            return Err(MessageError::Invalid("anchor already in use"));
        }
        let at = Utc.with_ymd_and_hms(2026, 9, 23, 12, 0, 0).unwrap();
        let message = Message {
            id: Uuid::from_u128(99),
            parent: MessageParent::parse("document", &access.entity().entity_id).unwrap(),
            thread_id: input.thread_id,
            sender_id: ChannelSender::try_from(
                bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
            )
            .unwrap(),
            imported_author: None,
            bot_profile: None,
            mentions: vec![],
            triggered_by: Some(USER.to_owned()),
            content: input.content.clone(),
            created_at: at,
            updated_at: at,
            edited_at: None,
            deleted_at: None,
            attachments: vec![],
            reactions: vec![],
        };
        self.posts.lock().unwrap().push((access, input));
        Ok(message)
    }
    async fn patch(
        &self,
        _access: EntityAccessReceipt<MessageWrite>,
        _id: Uuid,
        _input: MessagePatch,
    ) -> Result<Message, MessageError> {
        panic!("unexpected patch call")
    }
    async fn delete(
        &self,
        _access: EntityAccessReceipt<MessageWrite>,
        _id: Uuid,
        _nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        panic!("unexpected delete call")
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
        let at = Utc.with_ymd_and_hms(2026, 9, 23, 12, 0, 0).unwrap();
        let state = ThreadState {
            root_id,
            user_id: "macro|author@example.com".to_owned(),
            resolved: patch.resolved.unwrap_or_default(),
            anchor: None,
            created_at: at,
            updated_at: at,
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

type TestToolContext =
    DocumentToolContext<FakeDocumentService, FakeEntityAccessService, FakeEditingWorker>;

fn context(access_level: AccessLevel, messages: FakeMessages) -> ServiceContext<TestToolContext> {
    context_with(access_level, messages, "md", FakeEditingWorker::default())
}

fn context_with(
    access_level: AccessLevel,
    messages: FakeMessages,
    file_type: &str,
    editing: FakeEditingWorker,
) -> ServiceContext<TestToolContext> {
    ServiceContext(DocumentToolContext::new(
        FakeDocumentService::new(file_type),
        FakeEntityAccessService { access_level },
        LexicalClient::new("unused".to_owned(), "http://localhost/lexical".to_owned()),
        SyncServiceClient::new("unused".to_owned(), "http://localhost/sync".to_owned()),
        editing,
        "unused-jwt-secret".to_owned(),
        Arc::new(messages),
    ))
}

fn request() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from(USER.to_owned()).unwrap())
}

/// The write went to the document as the tool actor bot on the user's behalf.
fn assert_bot_on_document(access: &EntityAccessReceipt<MessageWrite>) {
    assert_eq!(access.entity().entity_id, DOCUMENT.to_string());
    assert_eq!(access.entity().entity_type, EntityType::Document);
    assert!(matches!(access.auth(), EntityAccessAuth::Bot(_)));
    assert_eq!(
        access.acting_user_id().map(|user| user.as_ref()),
        Some(USER)
    );
}

#[tokio::test]
async fn reply_posts_in_the_thread_as_the_bot_for_the_user() {
    let messages = FakeMessages::default();
    let response = ReplyToDocumentComment {
        document_id: DOCUMENT,
        content: "Fixed in the latest draft.".to_owned(),
        thread_id: Some(THREAD),
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap();

    assert_eq!(response.document_id, DOCUMENT);
    assert_eq!(response.thread_id, THREAD);
    assert_eq!(response.comment_id, Uuid::from_u128(99));
    let posts = messages.posts.lock().unwrap();
    let [(access, post)] = posts.as_slice() else {
        panic!("expected one post, got {}", posts.len());
    };
    assert_bot_on_document(access);
    assert_eq!(post.thread_id, Some(THREAD));
    assert_eq!(post.content, "Fixed in the latest draft.");
    assert_eq!(post.attribution, MessageAttribution::ActingUser);
    assert_eq!(
        post.notification_policy,
        PostMessageNotificationPolicy::Default
    );
    assert!(post.anchor.is_none());
}

#[tokio::test]
async fn reply_without_a_thread_starts_a_discussion_comment() {
    let messages = FakeMessages::default();
    let response = ReplyToDocumentComment {
        document_id: DOCUMENT,
        content: "Summary of the open questions.".to_owned(),
        thread_id: None,
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap();

    assert_eq!(response.thread_id, response.comment_id);
    let posts = messages.posts.lock().unwrap();
    assert_eq!(posts.len(), 1);
    assert_eq!(posts[0].1.thread_id, None);
    assert!(posts[0].1.anchor.is_none());
}

#[tokio::test]
async fn reply_needs_comment_access() {
    let messages = FakeMessages::default();
    let error = ReplyToDocumentComment {
        document_id: DOCUMENT,
        content: "Looks good.".to_owned(),
        thread_id: Some(THREAD),
    }
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
async fn reply_to_a_thread_not_on_the_document_says_so() {
    let messages = FakeMessages {
        thread_exists: false,
        ..FakeMessages::default()
    };
    let error = ReplyToDocumentComment {
        document_id: DOCUMENT,
        content: "Done.".to_owned(),
        thread_id: Some(THREAD),
    }
    .call(context(AccessLevel::Edit, messages), request())
    .await
    .unwrap_err();

    assert_eq!(
        error.description,
        "comment thread not found on this document"
    );
}

#[tokio::test]
async fn resolve_resolves_the_thread_as_the_bot_for_the_user() {
    let messages = FakeMessages::default();
    let response = ResolveDocumentComment {
        document_id: DOCUMENT,
        thread_id: THREAD,
        resolved: true,
    }
    .call(context(AccessLevel::Comment, messages.clone()), request())
    .await
    .unwrap();

    assert_eq!(response.thread_id, THREAD);
    assert!(response.resolved);
    let patches = messages.thread_patches.lock().unwrap();
    let [(access, root, patch)] = patches.as_slice() else {
        panic!("expected one thread update, got {}", patches.len());
    };
    assert_bot_on_document(access);
    assert_eq!(*root, THREAD);
    assert_eq!(patch.resolved, Some(true));
    assert!(!patch.detach_anchor);
}

#[tokio::test]
async fn resolve_false_reopens_the_thread() {
    let messages = FakeMessages::default();
    let response = ResolveDocumentComment {
        document_id: DOCUMENT,
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
    let tool: ResolveDocumentComment = serde_json::from_value(serde_json::json!({
        "documentId": DOCUMENT,
        "threadId": THREAD,
    }))
    .unwrap();

    assert!(tool.resolved);
}

#[tokio::test]
async fn resolve_needs_comment_access() {
    let messages = FakeMessages::default();
    let error = ResolveDocumentComment {
        document_id: DOCUMENT,
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

fn comment_on_text(text: &str, occurrence: Option<u32>) -> CommentOnDocumentText {
    CommentOnDocumentText {
        document_id: DOCUMENT,
        text: text.to_owned(),
        occurrence,
        content: "Is this date still right?".to_owned(),
    }
}

#[tokio::test]
async fn comment_on_text_places_the_mark_then_posts_a_thread_anchored_to_it() {
    let messages = FakeMessages::default();
    let editing = FakeEditingWorker::default();
    let response = comment_on_text("ships on Friday", Some(2))
        .call(
            context_with(
                AccessLevel::Comment,
                messages.clone(),
                "md",
                editing.clone(),
            ),
            request(),
        )
        .await
        .unwrap();

    let marks = editing.added_comment_marks.lock().unwrap();
    let [mark] = marks.as_slice() else {
        panic!("expected one mark, got {}", marks.len());
    };
    assert_eq!(mark.document_id, DOCUMENT.to_string());
    assert_eq!(mark.text, "ships on Friday");
    assert_eq!(mark.occurrence, Some(2));
    let token = decode_permission_token(&mark.token, "unused-jwt-secret").unwrap();
    assert_eq!(token.access_level, AccessLevel::Comment);
    assert_eq!(token.user_id.as_ref().map(|user| user.as_ref()), Some(USER));

    let posts = messages.posts.lock().unwrap();
    let [(access, post)] = posts.as_slice() else {
        panic!("expected one post, got {}", posts.len());
    };
    assert_bot_on_document(access);
    assert_eq!(post.thread_id, None);
    assert_eq!(post.content, "Is this date still right?");
    assert_eq!(post.attribution, MessageAttribution::ActingUser);
    let Some(NewThreadAnchor::Markdown {
        mark_id,
        marked_text,
    }) = &post.anchor
    else {
        panic!("expected a markdown anchor, got {:?}", post.anchor);
    };
    assert_eq!(*mark_id, mark.mark_id);
    assert_eq!(marked_text.as_deref(), Some("ships on Friday"));

    assert_eq!(response.document_id, DOCUMENT);
    assert_eq!(response.thread_id, Uuid::from_u128(99));
    assert_eq!(response.comment_id, Uuid::from_u128(99));
    assert_eq!(response.marked_text, "ships on Friday");
    assert!(editing.removed_comment_marks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_text_refused_by_the_document_posts_nothing() {
    let messages = FakeMessages::default();
    let editing = FakeEditingWorker::refusing_comment_marks("The text appears 2 times.");
    let error = comment_on_text("TBD", None)
        .call(
            context_with(AccessLevel::Edit, messages.clone(), "md", editing),
            request(),
        )
        .await
        .unwrap_err();

    assert_eq!(error.description, "The text appears 2 times.");
    assert!(messages.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_text_removes_the_mark_when_the_thread_cannot_be_posted() {
    let messages = FakeMessages {
        fail_posts: true,
        ..FakeMessages::default()
    };
    let editing = FakeEditingWorker::default();
    let error = comment_on_text("ships on Friday", None)
        .call(
            context_with(AccessLevel::Comment, messages, "md", editing.clone()),
            request(),
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.description,
        "unable to post the comment: anchor already in use"
    );
    let placed = editing.added_comment_marks.lock().unwrap()[0].mark_id;
    assert_eq!(*editing.removed_comment_marks.lock().unwrap(), vec![placed]);
}

#[tokio::test]
async fn comment_on_text_needs_comment_access() {
    let editing = FakeEditingWorker::default();
    let error = comment_on_text("ships on Friday", None)
        .call(
            context_with(
                AccessLevel::View,
                FakeMessages::default(),
                "md",
                editing.clone(),
            ),
            request(),
        )
        .await
        .unwrap_err();

    assert!(
        error.description.contains("comment access"),
        "{}",
        error.description
    );
    assert!(editing.added_comment_marks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_text_rejects_documents_that_are_not_markdown() {
    let editing = FakeEditingWorker::default();
    let error = comment_on_text("ships on Friday", None)
        .call(
            context_with(
                AccessLevel::Edit,
                FakeMessages::default(),
                "pdf",
                editing.clone(),
            ),
            request(),
        )
        .await
        .unwrap_err();

    assert!(
        error.description.contains("markdown documents only"),
        "{}",
        error.description
    );
    assert!(editing.added_comment_marks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_text_removes_the_mark_when_placing_it_fails() {
    let messages = FakeMessages::default();
    let editing = FakeEditingWorker::failing_comment_marks();
    let error = comment_on_text("ships on Friday", None)
        .call(
            context_with(
                AccessLevel::Comment,
                messages.clone(),
                "md",
                editing.clone(),
            ),
            request(),
        )
        .await
        .unwrap_err();

    assert_eq!(
        error.description,
        "unable to anchor the comment to the text"
    );
    let placed = editing.added_comment_marks.lock().unwrap()[0].mark_id;
    assert_eq!(*editing.removed_comment_marks.lock().unwrap(), vec![placed]);
    assert!(messages.posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn comment_on_text_rejects_occurrence_zero() {
    let editing = FakeEditingWorker::default();
    let error = comment_on_text("ships on Friday", Some(0))
        .call(
            context_with(
                AccessLevel::Comment,
                FakeMessages::default(),
                "md",
                editing.clone(),
            ),
            request(),
        )
        .await
        .unwrap_err();

    assert!(
        error.description.contains("counts from 1"),
        "{}",
        error.description
    );
    assert!(editing.added_comment_marks.lock().unwrap().is_empty());
}
