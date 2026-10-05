use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use agent::types::{ChatMessage, ChatMessageContent, Role};
use attachment::{AttachmentError, ResolutionError};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::*;

const BASE: &str = "https://local.example.test:8443/static-file";
const FILE_ID: &str = "00000000-0000-4000-8000-000000000001";
const ONE_BY_ONE_PNG: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0xF8, 0xCF, 0xC0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0xC9, 0xFE, 0x92, 0xEF, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,
    0x44, 0xAE, 0x42, 0x60, 0x82,
];

#[derive(Default)]
struct ServiceState {
    calls: Mutex<Vec<(String, String)>>,
    started: Notify,
    dropped: AtomicBool,
}

#[derive(Clone, Copy)]
enum Outcome {
    Image,
    Error,
    Url,
    Pending,
}

struct Service {
    state: Arc<ServiceState>,
    outcome: Outcome,
}

struct ReadGuard(Arc<ServiceState>);

impl Drop for ReadGuard {
    fn drop(&mut self) {
        self.0.dropped.store(true, Ordering::SeqCst);
    }
}

impl AttachmentService for Service {
    async fn resolve_attachments<'a>(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let entity = ids[0];
        self.state
            .calls
            .lock()
            .expect("calls lock")
            .push((user_id.to_string(), entity.entity_id.to_string()));
        let _guard = ReadGuard(Arc::clone(&self.state));
        self.state.started.notify_one();
        let image = match self.outcome {
            Outcome::Image => ImageData::try_from_bytes(ONE_BY_ONE_PNG.to_vec()).expect("PNG"),
            Outcome::Url => ImageData::StaticUrl(format!("{BASE}/file/{FILE_ID}")),
            Outcome::Error => {
                return Attachments::one(Err(ResolutionError::new(
                    EntityType::StaticFile.with_entity_string(entity.entity_id.to_string()),
                    AttachmentError::NoContent,
                )));
            }
            Outcome::Pending => return std::future::pending().await,
        };
        Attachments::one(Ok(AttachmentContent {
            reference: entity.clone(),
            name: None,
            content: NonEmpty::one(AttachmentPart::Image(image)),
        }))
    }
}

#[derive(Default)]
struct Engine {
    requests: Mutex<Vec<TurnRequest>>,
}

impl TurnEngine for Engine {
    fn supported_models(&self) -> &[&str] {
        &["test-model"]
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        self.requests.lock().expect("requests lock").push(request);
        let (parts, receiver) = mpsc::channel(1);
        parts
            .try_send(Ok(StreamPart::Content("reply".to_owned())))
            .expect("empty channel");
        receiver
    }
}

fn engine(
    outcome: Outcome,
) -> (
    LocalAttachmentTurnEngine<Service>,
    Arc<Engine>,
    Arc<ServiceState>,
) {
    let inner = Arc::new(Engine::default());
    let state = Arc::new(ServiceState::default());
    let engine = LocalAttachmentTurnEngine::new(
        inner.clone(),
        Url::parse(BASE).expect("base URL"),
        Service {
            state: Arc::clone(&state),
            outcome,
        },
    )
    .expect("valid local engine");
    (engine, inner, state)
}

fn content(uri: &str) -> AttachmentContent<'static> {
    AttachmentContent {
        reference: EntityType::StaticFile.with_entity_string("original-reference".to_owned()),
        name: Some("original-name.png".to_owned()),
        content: NonEmpty::new(vec![
            AttachmentPart::Content("caption".to_owned()),
            AttachmentPart::Image(ImageData::StaticUrl(uri.to_owned())),
        ])
        .expect("two parts"),
    }
}

fn message(uri: &str) -> ChatMessage {
    ChatMessage {
        content: ChatMessageContent::Text("look at this".to_owned()),
        role: Role::User,
        attachments: Some(Attachments::one(Ok(content(uri)))),
    }
}

fn request(messages: Vec<ChatMessage>) -> TurnRequest {
    TurnRequest {
        session_id: agent_session::domain::model::AgentSessionId::new(),
        owner: Owner::from_principal_str("macro|test@macro.com").expect("user"),
        model: "test-model".to_owned(),
        reasoning_effort: agent::ReasoningEffort::default(),
        identity: None,
        instructions: None,
        messages,
        mcp_tools: None,
        cancel: CancellationToken::new(),
        user_input: None,
        reviewer: None,
    }
}

fn attachment(message: &ChatMessage) -> &AttachmentContent<'static> {
    message.attachments.as_ref().expect("attachments").parts()[0]
        .as_ref()
        .expect("resolved content")
}

#[tokio::test]
async fn historical_images_are_inlined_and_original_content_is_preserved() {
    let (engine, inner, state) = engine(Outcome::Image);
    let mut turn = request(vec![message(&format!("{BASE}/file/{FILE_ID}"))]);
    turn.messages.push(ChatMessage {
        content: ChatMessageContent::Text("try again".to_owned()),
        role: Role::User,
        attachments: None,
    });
    assert_eq!(engine.supported_models(), &["test-model"]);
    let mut stream = engine.run_turn(turn);
    assert!(matches!(stream.recv().await, Some(Ok(StreamPart::Content(text))) if text == "reply"));
    assert!(stream.recv().await.is_none());

    let requests = inner.requests.lock().expect("requests lock");
    let attachment = attachment(&requests[0].messages[0]);
    assert_eq!(attachment.reference.entity_id, "original-reference");
    assert_eq!(attachment.name.as_deref(), Some("original-name.png"));
    assert!(matches!(&attachment.content[0], AttachmentPart::Content(text) if text == "caption"));
    assert!(matches!(
        &attachment.content[1],
        AttachmentPart::Image(ImageData::Base64(_))
    ));
    assert_eq!(requests[0].messages[1].content.message_text(), "try again");
    assert_eq!(
        *state.calls.lock().expect("calls lock"),
        vec![("macro|test@macro.com".to_owned(), FILE_ID.to_owned())]
    );
}

#[test]
fn only_the_exact_static_file_origin_and_canonical_id_are_matched() {
    let (engine, _, _) = engine(Outcome::Image);
    let resolver = &engine.resolver;
    assert_eq!(
        resolver.file_id(&format!("{BASE}/file/{FILE_ID}")),
        Some(Uuid::parse_str(FILE_ID).unwrap())
    );
    for uri in [
        format!("https://other.example.test:8443/static-file/file/{FILE_ID}"),
        format!("https://local.example.test:8444/static-file/file/{FILE_ID}"),
        format!("http://local.example.test:8443/static-file/file/{FILE_ID}"),
        format!("{BASE}-other/file/{FILE_ID}"),
        format!("{BASE}/api/file/{FILE_ID}"),
        format!("{BASE}/internal/file/{FILE_ID}"),
        format!("{BASE}/file/not-a-uuid"),
        format!("{BASE}/file/{FILE_ID}/extra"),
        format!("{BASE}/other/../file/{FILE_ID}"),
        format!("{BASE}/other/%2e%2e/file/{FILE_ID}"),
        format!("{BASE}/file/{FILE_ID}?redirect=http://localhost"),
        format!("{BASE}/file/{FILE_ID}#fragment"),
        format!("https://user:password@local.example.test:8443/static-file/file/{FILE_ID}"),
    ] {
        assert_eq!(resolver.file_id(&uri), None, "must not resolve {uri}");
    }
}

#[tokio::test]
async fn public_images_are_left_for_the_provider_without_internal_reads() {
    let (engine, _, state) = engine(Outcome::Image);
    let uri = "https://public.example/file/picture.png";
    let mut turn = request(vec![message(uri)]);
    engine
        .resolver
        .resolve_request(&mut turn)
        .await
        .expect("resolve");
    assert!(
        matches!(&attachment(&turn.messages[0]).content[1], AttachmentPart::Image(ImageData::StaticUrl(url)) if url == uri)
    );
    assert!(state.calls.lock().expect("calls lock").is_empty());
}

#[tokio::test]
async fn nested_images_are_resolved_without_replacing_the_parent() {
    let (engine, _, _) = engine(Outcome::Image);
    let child = content(&format!("{BASE}/file/{FILE_ID}"));
    let mut turn = request(vec![message("https://public.example/image.png")]);
    turn.messages[0].attachments = Some(Attachments::one(Ok(AttachmentContent {
        reference: EntityType::Document.with_entity_string("parent-document".to_owned()),
        name: Some("parent".to_owned()),
        content: NonEmpty::one(AttachmentPart::Child(Box::new(Ok(child)))),
    })));
    engine
        .resolver
        .resolve_request(&mut turn)
        .await
        .expect("resolve");
    let parent = attachment(&turn.messages[0]);
    assert_eq!(parent.reference.entity_id, "parent-document");
    let AttachmentPart::Child(child) = &parent.content[0] else {
        panic!("child preserved")
    };
    assert!(matches!(
        &child.as_ref().as_ref().expect("child").content[1],
        AttachmentPart::Image(ImageData::Base64(_))
    ));
}

#[tokio::test]
async fn resolution_failures_and_non_inline_results_never_reach_the_model() {
    for outcome in [Outcome::Error, Outcome::Url] {
        let (engine, inner, _) = engine(outcome);
        let mut stream = engine.run_turn(request(vec![message(&format!("{BASE}/file/{FILE_ID}"))]));
        assert!(matches!(stream.recv().await, Some(Err(_))));
        assert!(stream.recv().await.is_none());
        assert!(inner.requests.lock().expect("requests lock").is_empty());
    }
}

#[tokio::test]
async fn non_user_owners_do_not_resolve_files_under_an_invented_identity() {
    let (engine, inner, state) = engine(Outcome::Image);
    let mut turn = request(vec![message(&format!("{BASE}/file/{FILE_ID}"))]);
    turn.owner = Owner::Bot(bot_id::BotId::TEST_A);
    let mut stream = engine.run_turn(turn);
    assert!(matches!(stream.recv().await, Some(Err(_))));
    assert!(inner.requests.lock().expect("requests lock").is_empty());
    assert!(state.calls.lock().expect("calls lock").is_empty());
}

#[tokio::test]
async fn cancelling_or_dropping_the_receiver_stops_pending_resolution() {
    for drop_receiver in [false, true] {
        let (engine, inner, state) = engine(Outcome::Pending);
        let turn = request(vec![message(&format!("{BASE}/file/{FILE_ID}"))]);
        let cancel = turn.cancel.clone();
        let mut stream = engine.run_turn(turn);
        tokio::time::timeout(Duration::from_secs(2), state.started.notified())
            .await
            .expect("resolution starts");
        if drop_receiver {
            drop(stream);
        } else {
            cancel.cancel();
            assert!(
                tokio::time::timeout(Duration::from_secs(2), stream.recv())
                    .await
                    .expect("stream closes")
                    .is_none()
            );
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            while !state.dropped.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("attachment read is dropped");
        assert!(cancel.is_cancelled());
        assert!(inner.requests.lock().expect("requests lock").is_empty());
    }
}

struct CooperativeEngine {
    started: Arc<Notify>,
}

impl TurnEngine for CooperativeEngine {
    fn supported_models(&self) -> &[&str] {
        &["test-model"]
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(1);
        let started = Arc::clone(&self.started);
        tokio::spawn(async move {
            started.notify_one();
            request.cancel.cancelled().await;
            let _ = parts
                .send(Ok(StreamPart::ToolResponse(agent::ToolResponse::Json {
                    id: "running-tool".to_owned(),
                    name: "cooperative-tool".to_owned(),
                    json: serde_json::json!({"status": "cancelled"}),
                })))
                .await;
        });
        receiver
    }
}

#[tokio::test]
async fn a_running_engine_drains_its_final_tool_response_after_cancellation() {
    let started = Arc::new(Notify::new());
    let engine = LocalAttachmentTurnEngine::new(
        Arc::new(CooperativeEngine {
            started: Arc::clone(&started),
        }),
        Url::parse(BASE).expect("base URL"),
        Service {
            state: Arc::new(ServiceState::default()),
            outcome: Outcome::Image,
        },
    )
    .expect("local engine");
    let turn = request(vec![message(&format!("{BASE}/file/{FILE_ID}"))]);
    let cancel = turn.cancel.clone();
    let mut stream = engine.run_turn(turn);
    tokio::time::timeout(Duration::from_secs(2), started.notified())
        .await
        .expect("inner engine starts");
    cancel.cancel();
    let final_part = tokio::time::timeout(Duration::from_secs(2), stream.recv())
        .await
        .expect("inner engine drains");
    assert!(matches!(final_part,
        Some(Ok(StreamPart::ToolResponse(agent::ToolResponse::Json { id, json, .. })))
        if id == "running-tool" && json == serde_json::json!({"status": "cancelled"})
    ));
    assert!(stream.recv().await.is_none());
}
