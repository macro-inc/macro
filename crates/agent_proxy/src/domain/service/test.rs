use super::*;
use agent::types::AssistantMessagePart;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, RequestId, SessionUpdate, TextContent,
};
use chat::domain::models::{
    ChatResponse, CopyChatArgs, PatchChatMessageArgs, Result as ChatResult, WebCitation,
};
use chat::domain::ports::MessageRepo;
use macro_user_id::cowlike::CowLike;
use macro_uuid::Uuid;
use model::chat::{Chat, ChatMessageWithAttachments};
use models_permissions::share_permission::SharePermissionV2;
use std::sync::{Arc, Mutex as StdMutex};
use stream::domain::{ItemId, ItemStream, StreamEvent};

const USER: &str = "macro|test@example.com";

fn session() -> Uuid {
    Uuid::from_u128(0x1111_2222_3333_4444)
}

fn user_id() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap().into_owned()
}

#[derive(Clone)]
struct FakeRepo {
    kind: ChatAgentKind,
    access: AccessLevel,
    stored: Arc<StdMutex<Vec<(String, NewChatMessage)>>>,
}

impl FakeRepo {
    fn new(kind: ChatAgentKind, access: AccessLevel) -> Self {
        Self {
            kind,
            access,
            stored: Arc::new(StdMutex::new(Vec::new())),
        }
    }

    fn stored(&self) -> Vec<(String, NewChatMessage)> {
        self.stored.lock().unwrap().clone()
    }
}

impl ChatRepo for FakeRepo {
    async fn create(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _args: CreateChatArgs,
    ) -> ChatResult<String> {
        Ok("new-chat".to_string())
    }

    async fn get_chat(&self, _chat_id: &str) -> ChatResult<ChatResponse> {
        unimplemented!()
    }

    async fn get_metadata(&self, _chat_id: &str) -> ChatResult<Chat> {
        unimplemented!()
    }

    async fn get_agent_kind(&self, _chat_id: &str) -> ChatResult<ChatAgentKind> {
        Ok(self.kind)
    }

    async fn get_access_level(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _chat_id: &str,
    ) -> ChatResult<AccessLevel> {
        Ok(self.access)
    }

    async fn copy_chat(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _source_chat_id: &str,
        _args: CopyChatArgs,
    ) -> ChatResult<String> {
        unimplemented!()
    }

    async fn revert_delete(&self, _chat_id: &str, _project_id: Option<&str>) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_permissions(&self, _chat_id: &str) -> ChatResult<SharePermissionV2> {
        unimplemented!()
    }

    async fn delete(&self, _chat_id: &str) -> ChatResult<()> {
        Ok(())
    }

    async fn permanently_delete(&self, _chat_id: &str) -> ChatResult<()> {
        Ok(())
    }

    async fn patch(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _chat_id: &str,
        _args: PatchChatArgs,
    ) -> ChatResult<()> {
        Ok(())
    }

    async fn update_project_modified(&self, _project_id: &str) -> ChatResult<()> {
        unimplemented!()
    }

    async fn patch_message(&self, _chat_id: &str, _args: PatchChatMessageArgs) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> ChatResult<ChatMessageContent> {
        unimplemented!()
    }

    async fn update_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _content: &ChatMessageContent,
    ) -> ChatResult<()> {
        unimplemented!()
    }

    async fn store_resolved_message(
        &self,
        _message_id: &str,
        _parts: attachment::FormattedParts,
    ) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_resolved_message(
        &self,
        _message_id: &str,
    ) -> ChatResult<attachment::FormattedParts> {
        unimplemented!()
    }
}

impl MessageRepo for FakeRepo {
    async fn create(&self, chat_id: &str, message: NewChatMessage) -> ChatResult<String> {
        let mut stored = self.stored.lock().unwrap();
        stored.push((chat_id.to_string(), message));
        Ok(format!("msg-{}", stored.len()))
    }

    async fn delete(&self, _message_id: &str) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_messages(&self, _chat_id: &str) -> ChatResult<Vec<ChatMessageWithAttachments>> {
        unimplemented!()
    }

    async fn get_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
    ) -> ChatResult<ChatMessageContent> {
        unimplemented!()
    }

    async fn update_message_content(
        &self,
        _chat_id: &str,
        _message_id: &str,
        _content: &ChatMessageContent,
    ) -> ChatResult<()> {
        unimplemented!()
    }

    async fn patch_message(&self, _chat_id: &str, _args: PatchChatMessageArgs) -> ChatResult<()> {
        unimplemented!()
    }

    async fn copy_messages(&self, _source_chat_id: &str, _dest_chat_id: &str) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_web_citations(
        &self,
        _chat_id: &str,
    ) -> ChatResult<Vec<(String, Vec<WebCitation>)>> {
        unimplemented!()
    }

    async fn store_resolved_message(
        &self,
        _message_id: &str,
        _parts: attachment::FormattedParts,
    ) -> ChatResult<()> {
        unimplemented!()
    }

    async fn get_resolved_message(
        &self,
        _message_id: &str,
    ) -> ChatResult<attachment::FormattedParts> {
        unimplemented!()
    }
}

#[derive(Clone)]
struct FakeSessions {
    sent: Arc<StdMutex<Vec<(Uuid, RawJsonRpcMessage)>>>,
    connected: Arc<StdMutex<bool>>,
    fail_send: Arc<StdMutex<bool>>,
}

impl Default for FakeSessions {
    fn default() -> Self {
        Self {
            sent: Arc::default(),
            connected: Arc::new(StdMutex::new(true)),
            fail_send: Arc::new(StdMutex::new(false)),
        }
    }
}

impl RuntimeSessions for FakeSessions {
    fn send(&self, session_id: Uuid, message: RawJsonRpcMessage) -> Result<()> {
        if *self.fail_send.lock().unwrap() {
            return Err(AgentProxyErr::SessionNotConnected);
        }
        self.sent.lock().unwrap().push((session_id, message));
        Ok(())
    }

    fn is_connected(&self, _session_id: Uuid) -> bool {
        *self.connected.lock().unwrap()
    }
}

type Notified = (Uuid, &'static str, serde_json::Value);

#[derive(Clone, Default)]
struct FakeNotifier {
    notified: Arc<StdMutex<Vec<Notified>>>,
}

impl ClientNotifier for FakeNotifier {
    async fn notify_session(
        &self,
        session_id: Uuid,
        message_type: &'static str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.notified
            .lock()
            .unwrap()
            .push((session_id, message_type, payload));
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeProvisioner {
    provisioned: Arc<StdMutex<Vec<Uuid>>>,
}

impl RuntimeProvisioner for FakeProvisioner {
    async fn provision(&self, session_id: Uuid) -> anyhow::Result<String> {
        self.provisioned.lock().unwrap().push(session_id);
        Ok(format!("ws://fake/{session_id}"))
    }
}

#[derive(Clone, Default)]
struct FakeStreamRepo {
    appended: Arc<StdMutex<Vec<(StreamId, serde_json::Value)>>>,
}

impl FakeStreamRepo {
    /// The `ChatStream` items appended, in order.
    fn items(&self) -> Vec<ChatStream> {
        self.appended
            .lock()
            .unwrap()
            .iter()
            .map(|(_, payload)| serde_json::from_value(payload.clone()).unwrap())
            .collect()
    }
}

#[async_trait::async_trait]
impl StreamRepo for FakeStreamRepo {
    async fn append(
        &self,
        id: &StreamId,
        payload: serde_json::Value,
    ) -> stream::domain::Result<ItemId> {
        self.appended.lock().unwrap().push((id.clone(), payload));
        Ok("item".to_string())
    }

    async fn stream_from_beginning(&self, _id: &StreamId) -> stream::domain::Result<ItemStream> {
        unimplemented!()
    }

    async fn close(&self, _id: &StreamId) -> stream::domain::Result<()> {
        Ok(())
    }

    async fn active_streams(&self, _entity_id: &str) -> stream::domain::Result<Vec<StreamId>> {
        Ok(Vec::new())
    }

    async fn notify(&self) -> tokio::sync::broadcast::Receiver<StreamEvent> {
        tokio::sync::broadcast::channel(1).1
    }
}

struct Harness {
    service: AgentProxyServiceImpl<FakeRepo, FakeSessions, FakeNotifier, FakeProvisioner>,
    repo: FakeRepo,
    sessions: FakeSessions,
    notifier: FakeNotifier,
    provisioner: FakeProvisioner,
    streams: FakeStreamRepo,
}

fn harness(kind: ChatAgentKind, access: AccessLevel) -> Harness {
    let repo = FakeRepo::new(kind, access);
    let sessions = FakeSessions::default();
    let notifier = FakeNotifier::default();
    let provisioner = FakeProvisioner::default();
    let streams = FakeStreamRepo::default();
    let service = AgentProxyServiceImpl::new(
        repo.clone(),
        sessions.clone(),
        notifier.clone(),
        provisioner.clone(),
        Arc::new(streams.clone()),
    );
    Harness {
        service,
        repo,
        sessions,
        notifier,
        provisioner,
        streams,
    }
}

fn prompt_message(id: i64, text: &str) -> RawJsonRpcMessage {
    let prompt = PromptRequest::new(
        session().to_string(),
        vec![ContentBlock::Text(TextContent::new(text))],
    );
    RawJsonRpcMessage::request(
        prompt.method().to_string(),
        serde_json::to_value(&prompt).unwrap(),
        RequestId::Number(id),
    )
    .unwrap()
}

fn session_update(update: SessionUpdate) -> RawJsonRpcMessage {
    let notification =
        agent_client_protocol::schema::v1::SessionNotification::new(session().to_string(), update);
    RawJsonRpcMessage::notification(
        notification.method().to_string(),
        serde_json::to_value(&notification).unwrap(),
    )
    .unwrap()
}

fn text_chunk(text: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
        text,
    ))))
}

#[tokio::test]
async fn post_prompt_persists_user_message_and_forwards() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    h.service
        .post_acp(user_id(), session(), prompt_message(1, "fix the bug"))
        .await
        .unwrap();

    let stored = h.repo.stored();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].0, session().to_string());
    assert_eq!(stored[0].1.role, Role::User);
    assert_eq!(
        stored[0].1.content,
        ChatMessageContent::Text("fix the bug".to_string())
    );

    let sent = h.sessions.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert!(matches!(sent[0].1, RawJsonRpcMessage::Request(_)));

    let items = h.streams.items();
    assert_eq!(items.len(), 1);
    assert!(matches!(
        &items[0],
        ChatStream::ChatUserMessage { content, chat_id, .. }
            if content == "fix the bug" && *chat_id == session().to_string()
    ));
}

#[tokio::test]
async fn provision_runtime_connection_returns_provisioner_url() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    let url = h
        .service
        .provision_runtime_connection(user_id(), session())
        .await
        .unwrap();

    assert_eq!(url, format!("ws://fake/{}", session()));
    assert_eq!(*h.provisioner.provisioned.lock().unwrap(), vec![session()]);
}

#[tokio::test]
async fn provision_runtime_connection_rejects_macro_chats() {
    let h = harness(ChatAgentKind::MacroChat, AccessLevel::Owner);

    let err = h
        .service
        .provision_runtime_connection(user_id(), session())
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::BadRequest(_)));
    assert!(h.provisioner.provisioned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn provision_runtime_connection_requires_edit_access() {
    let h = harness(ChatAgentKind::External, AccessLevel::View);

    let err = h
        .service
        .provision_runtime_connection(user_id(), session())
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::Unauthorized));
    assert!(h.provisioner.provisioned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn post_acp_rejects_macro_chats() {
    let h = harness(ChatAgentKind::MacroChat, AccessLevel::Owner);

    let err = h
        .service
        .post_acp(user_id(), session(), prompt_message(1, "hi"))
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::BadRequest(_)));
    assert!(h.sessions.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn post_acp_requires_edit_access() {
    let h = harness(ChatAgentKind::External, AccessLevel::View);

    let err = h
        .service
        .post_acp(user_id(), session(), prompt_message(1, "hi"))
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::Unauthorized));
    assert!(h.repo.stored().is_empty());
}

#[tokio::test]
async fn agent_turn_accumulates_and_flushes_on_prompt_response() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    // The user prompts (request id 7), the agent streams two chunks, then
    // the prompt response ends the turn.
    h.service
        .post_acp(user_id(), session(), prompt_message(7, "hello"))
        .await
        .unwrap();

    h.service
        .handle_agent_message(session(), session_update(text_chunk("Hello, ")))
        .await
        .unwrap();
    h.service
        .handle_agent_message(session(), session_update(text_chunk("world!")))
        .await
        .unwrap();

    // Streaming alone persists nothing beyond the user message.
    assert_eq!(h.repo.stored().len(), 1);

    let response = RawJsonRpcMessage::response(
        RequestId::Number(7),
        Ok(serde_json::json!({"stopReason": "end_turn"})),
    );
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();

    let stored = h.repo.stored();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[1].1.role, Role::Assistant);
    assert_eq!(
        stored[1].1.content,
        ChatMessageContent::AssistantMessageParts(vec![AssistantMessagePart::Text {
            text: "Hello, world!".to_string()
        }])
    );

    // ChatUserMessage, one ChatMessageResponse per chunk (unmerged, matching
    // document_cognition_service's streamed granularity), then StreamEnd.
    let items = h.streams.items();
    assert_eq!(items.len(), 4);
    assert!(matches!(items[0], ChatStream::ChatUserMessage { .. }));
    assert!(matches!(
        &items[1],
        ChatStream::ChatMessageResponse { content: AssistantMessagePart::Text { text }, .. }
            if text == "Hello, "
    ));
    assert!(matches!(
        &items[2],
        ChatStream::ChatMessageResponse { content: AssistantMessagePart::Text { text }, .. }
            if text == "world!"
    ));
    assert!(matches!(items[3], ChatStream::StreamEnd { .. }));

    // Every item in the turn shares one stream_id, which also became the
    // persisted assistant message's id.
    let stream_id = match &items[0] {
        ChatStream::ChatUserMessage { stream_id, .. } => stream_id.clone(),
        _ => unreachable!(),
    };
    assert!(items.iter().all(|item| match item {
        ChatStream::ChatUserMessage { stream_id: id, .. }
        | ChatStream::ChatMessageResponse { stream_id: id, .. }
        | ChatStream::StreamEnd { stream_id: id } => *id == stream_id,
        ChatStream::Error(_) => false,
    }));
    assert_eq!(stored[1].1.id, Some(stream_id));
}

#[tokio::test]
async fn unrelated_response_does_not_flush() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    h.service
        .post_acp(user_id(), session(), prompt_message(7, "hello"))
        .await
        .unwrap();
    h.service
        .handle_agent_message(session(), session_update(text_chunk("thinking...")))
        .await
        .unwrap();

    // A response to some other request (e.g. initialize) must not end the turn.
    let response = RawJsonRpcMessage::response(RequestId::Number(99), Ok(serde_json::json!({})));
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();

    assert_eq!(h.repo.stored().len(), 1);
}

#[tokio::test]
async fn post_acp_fails_fast_when_session_disconnected() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);
    *h.sessions.connected.lock().unwrap() = false;

    let err = h
        .service
        .post_acp(user_id(), session(), prompt_message(1, "hi"))
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::SessionNotConnected));
    // Nothing was persisted for a prompt that could never be delivered.
    assert!(h.repo.stored().is_empty());
}

#[tokio::test]
async fn failed_send_rolls_back_the_pending_prompt() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);
    *h.sessions.fail_send.lock().unwrap() = true;

    let err = h
        .service
        .post_acp(user_id(), session(), prompt_message(7, "hi"))
        .await
        .unwrap_err();
    assert!(matches!(err, AgentProxyErr::SessionNotConnected));

    // The prompt never reached an agent, so a later response with the same
    // request ID must not end a turn.
    *h.sessions.fail_send.lock().unwrap() = false;
    h.service
        .handle_agent_message(session(), session_update(text_chunk("stray")))
        .await
        .unwrap();
    let response = RawJsonRpcMessage::response(RequestId::Number(7), Ok(serde_json::json!({})));
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();

    // Only the user message row exists; no assistant turn was flushed.
    assert_eq!(h.repo.stored().len(), 1);
}

#[tokio::test]
async fn detach_discards_in_flight_turn_state() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    h.service
        .post_acp(user_id(), session(), prompt_message(7, "hello"))
        .await
        .unwrap();
    h.service
        .handle_agent_message(session(), session_update(text_chunk("partial answer")))
        .await
        .unwrap();

    // The agent crashed / its connection dropped mid-turn.
    h.service.handle_agent_detached(session());

    // A stray response for the old prompt must not flush the stale turn.
    let response = RawJsonRpcMessage::response(RequestId::Number(7), Ok(serde_json::json!({})));
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();
    assert_eq!(h.repo.stored().len(), 1);
}

#[tokio::test]
async fn flushed_turn_leaves_no_state_behind() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    h.service
        .post_acp(user_id(), session(), prompt_message(7, "hello"))
        .await
        .unwrap();
    h.service
        .handle_agent_message(session(), session_update(text_chunk("done")))
        .await
        .unwrap();
    let response = RawJsonRpcMessage::response(RequestId::Number(7), Ok(serde_json::json!({})));
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();
    assert_eq!(h.repo.stored().len(), 2);

    // Detaching after a fully flushed turn is a no-op (the entry is gone).
    h.service.handle_agent_detached(session());
}

#[tokio::test]
async fn unsolicited_chunks_do_not_create_turn_state() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    // Chunks arriving with no open prompt turn — e.g. buffered messages
    // processed after a detach discarded the session's state — are streamed
    // but never persisted and never resurrect the turns entry.
    h.service
        .handle_agent_message(session(), session_update(text_chunk("late chunk")))
        .await
        .unwrap();

    // A prompt then opens a fresh turn: only its own chunks are flushed.
    h.service
        .post_acp(user_id(), session(), prompt_message(9, "hello"))
        .await
        .unwrap();
    h.service
        .handle_agent_message(session(), session_update(text_chunk("clean answer")))
        .await
        .unwrap();
    let response = RawJsonRpcMessage::response(RequestId::Number(9), Ok(serde_json::json!({})));
    h.service
        .handle_agent_message(session(), response)
        .await
        .unwrap();

    let stored = h.repo.stored();
    assert_eq!(stored.len(), 2);
    assert_eq!(
        stored[1].1.content,
        ChatMessageContent::AssistantMessageParts(vec![AssistantMessagePart::Text {
            text: "clean answer".to_string()
        }])
    );
}

#[tokio::test]
async fn handle_system_event_notifies_the_gateway() {
    let h = harness(ChatAgentKind::External, AccessLevel::Owner);

    h.service
        .handle_system_event(session(), SystemEvent::Unknown("agent/started".to_string()))
        .await
        .unwrap();

    let notified = h.notifier.notified.lock().unwrap();
    assert_eq!(notified.len(), 1);
    assert_eq!(notified[0].0, session());
    assert_eq!(notified[0].1, AGENT_SYSTEM_EVENT_MESSAGE_TYPE);
}
