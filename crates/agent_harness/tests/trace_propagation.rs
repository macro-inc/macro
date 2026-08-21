use std::sync::Arc;

use agent_client_protocol::schema::v1::{InitializeResponse, NewSessionResponse};
use agent_fold::domain::service::FoldedMessageService;
use agent_harness::domain::model::{HarnessCommand, MentionOrigin, OpenSession, SessionDefaults};
use agent_harness::domain::service::AgentHarnessService;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_harness::testing::helpers::announcer::AnnouncerMock;
use agent_harness::testing::helpers::containers::{ContainerSender, MockContainerManager};
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::NoOpRealtime;
use agent_session::domain::service::AgentSessionServiceImpl;
use agent_session::testing::InMemoryAgentSessionRepo;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use opentelemetry::trace::TracerProvider as _;
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider, SpanData};
use tracing::instrument::WithSubscriber as _;
use tracing_subscriber::layer::SubscriberExt as _;

fn open_command() -> OpenSession {
    let thread_id = macro_uuid::generate_uuid_v7();
    OpenSession {
        bot_id: BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
        origin: MentionOrigin {
            channel_id: macro_uuid::generate_uuid_v7(),
            thread_id,
            message_id: thread_id,
            sender: MacroUserIdStr::try_from_email("asker@example.com").expect("valid user id"),
            content: "@claude fix the failing test".to_owned(),
        },
    }
}

fn session_of(containers: &MockContainerManager) -> AgentSessionId {
    containers
        .sessions()
        .into_iter()
        .next()
        .expect("exactly one session has a container")
}

/// Open a managed session and drive its handshake to completion.
///
/// Queue admission happens inside a dedicated child of `caller`, matching the
/// Kafka adapter's consumer -> harness boundary.
async fn open_a_session_under(caller: &tracing::Span) {
    let containers = MockContainerManager::new();
    let repo = InMemoryAgentSessionRepo::new();
    let runtimes: Arc<RuntimeRegistry<ContainerSender>> = RuntimeRegistry::new();
    let sessions = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        NoOpRealtime,
    );
    let service = AgentHarnessService::new(
        sessions.clone(),
        containers.clone(),
        AnnouncerMock::new(),
        Arc::clone(&runtimes),
        SessionDefaults {
            model: "claude".to_owned(),
            harness: "opencode".to_owned(),
            repo_url: "https://github.com/macro-inc/macro".to_owned(),
        },
    );
    let execution = tracing::info_span!(parent: caller, "harness.execute");
    let open = execution
        .in_scope(|| service.execute(AgentSessionId::new(), HarnessCommand::Open(open_command())));
    let drive = async {
        loop {
            if containers.spawned() == 1 {
                break;
            }
            tokio::task::yield_now().await;
        }
        let container = containers
            .container(session_of(&containers))
            .expect("the spawned container is findable");
        let agent = container.agent();
        container.sends_ready();
        agent.wait_for_requests(1).await;
        agent.completes_initialize(InitializeResponse::new(PROTOCOL_VERSION));
        agent.wait_for_requests(2).await;
        agent.opens_session(NewSessionResponse::new("acp-test"));
        agent.completes_prompt().await;
    };
    let (opened, ()) = tokio::join!(open, drive);
    opened.expect("open should succeed");
    sessions.shutdown().await;
}

/// Record every span one harness open produces, plus the `harness.caller` span
/// it was queued under - the stand-in for whatever really queues a command, be
/// that a Kafka consumer or a control route.
async fn spans_for_one_open() -> Vec<SpanData> {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    async {
        let caller = tracing::info_span!("kafka.process");
        open_a_session_under(&caller).await;
    }
    .with_subscriber(subscriber)
    .await;

    provider.force_flush().expect("flush spans");
    exporter.get_finished_spans().expect("read spans")
}

fn span_named<'a>(spans: &'a [SpanData], name: &str) -> &'a SpanData {
    spans
        .iter()
        .find(|span| span.name == name)
        .unwrap_or_else(|| panic!("a {name} span was exported"))
}

#[tokio::test]
async fn queued_prompt_keeps_the_open_trace_when_handshake_finishes_later() {
    let spans = spans_for_one_open().await;
    let open = span_named(&spans, "open");
    let command = span_named(&spans, "agent.session.command");

    assert_eq!(command.parent_span_id, open.span_context.span_id());
}

/// The per-session worker runs on its own task, so nothing but an explicitly
/// carried span keeps its work attached to whoever queued the command. Without
/// that, `open` is a disconnected root and the whole trigger trace is severed
/// at the harness boundary.
#[tokio::test]
async fn worker_spans_descend_from_the_span_the_caller_held() {
    let spans = spans_for_one_open().await;
    let caller = span_named(&spans, "kafka.process");
    let execute = span_named(&spans, "harness.execute");
    let open = span_named(&spans, "open");

    assert_eq!(execute.parent_span_id, caller.span_context.span_id());
    assert_eq!(open.parent_span_id, execute.span_context.span_id());
    for span in &spans {
        assert_eq!(
            span.span_context.trace_id(),
            caller.span_context.trace_id(),
            "{} escaped the caller's trace",
            span.name
        );
    }
}
