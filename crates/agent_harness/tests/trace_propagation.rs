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
use opentelemetry_sdk::trace::{InMemorySpanExporter, SdkTracerProvider};
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

#[tokio::test]
async fn queued_prompt_keeps_the_open_trace_when_handshake_finishes_later() {
    let exporter = InMemorySpanExporter::default();
    let provider = SdkTracerProvider::builder()
        .with_simple_exporter(exporter.clone())
        .build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    async {
        let containers = MockContainerManager::new();
        let repo = InMemoryAgentSessionRepo::new();
        let runtimes: Arc<RuntimeRegistry<ContainerSender>> = RuntimeRegistry::new();
        let service = AgentHarnessService::new(
            AgentSessionServiceImpl::new(
                repo.clone(),
                FoldedMessageService::new(repo.clone()),
                NoOpRealtime,
            ),
            containers.clone(),
            AnnouncerMock::new(),
            Arc::clone(&runtimes),
            SessionDefaults {
                model: "claude".to_owned(),
                harness: "opencode".to_owned(),
                repo_url: "https://github.com/macro-inc/macro".to_owned(),
            },
        );
        let open = service.execute(AgentSessionId::new(), HarnessCommand::Open(open_command()));
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
        };
        let (opened, ()) = tokio::join!(open, drive);
        opened.expect("open should succeed");
    }
    .with_subscriber(subscriber)
    .await;

    provider.force_flush().expect("flush spans");
    let spans = exporter.get_finished_spans().expect("read spans");
    let open = spans
        .iter()
        .find(|span| span.name == "open")
        .expect("open span");
    let command = spans
        .iter()
        .find(|span| span.name == "agent.session.command")
        .expect("command span");

    assert_eq!(command.parent_span_id, open.span_context.span_id());
}
