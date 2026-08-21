use std::sync::{Arc, Mutex};

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{
    InitializeResponse, NewSessionResponse, RequestId, SessionId,
};
use agent_fold::domain::model::{FoldedMessage, TurnId};
use agent_fold::domain::ports::FoldedMessageRepo;
use agent_runtime_protocol::domain::action::{AgentAction, AgentActionId};
use agent_runtime_protocol::domain::ports::{Transport, TransportError, TransportSender};
use agent_runtime_protocol::domain::schema::v0::{
    AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage,
};
use agent_session::PROTOCOL_VERSION;
use agent_session::domain::connection::RuntimeAttachment;
use agent_session::domain::error::{AgentSessionError, Result};
use agent_session::domain::model::{
    AgentSession, AgentSessionId, AgentSessionLog, ChannelSession, CreateAgentSessionParams,
    Message, SessionBot, SessionStatus, StoredAgentSessionLog,
};
use agent_session::domain::ports::{AgentSessionLogRepo, AgentSessionRepo, NoOpRealtime};
use agent_session::domain::service::{AgentSessionService as _, AgentSessionServiceImpl};
use bots::domain::models::BotId;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use opentelemetry::trace::TracerProvider as _;
use tokio::sync::mpsc;
use tracing::{Instrument as _, instrument::WithSubscriber as _};
use tracing_subscriber::layer::SubscriberExt as _;

#[derive(Clone)]
struct TraceRepo {
    session: Arc<Mutex<AgentSession>>,
    logs: Arc<Mutex<Vec<StoredAgentSessionLog>>>,
}

impl TraceRepo {
    fn new(session: AgentSession) -> Self {
        Self {
            session: Arc::new(Mutex::new(session)),
            logs: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl AgentSessionRepo for TraceRepo {
    async fn create(&self, _params: CreateAgentSessionParams) -> Result<AgentSession> {
        Err(AgentSessionError::Unknown(anyhow::anyhow!(
            "not used by this test"
        )))
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        let session = self.session.lock().expect("session lock").clone();
        if session.id == id {
            Ok(session)
        } else {
            Err(AgentSessionError::Disconnected(id))
        }
    }

    async fn find_for_channel(
        &self,
        _thread_id: Option<Uuid>,
        _bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        Ok(ChannelSession::None)
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        Ok(SessionBot {
            id,
            name: "Trace Agent".to_owned(),
            avatar_url: None,
        })
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        let mut session = self.session.lock().expect("session lock");
        assert_eq!(session.id, id);
        session.acp_session_id = Some(acp_session_id);
        Ok(())
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<()> {
        let mut session = self.session.lock().expect("session lock");
        assert_eq!(session.id, id);
        session.model = model.to_owned();
        Ok(())
    }

    async fn delete(&self, _id: AgentSessionId) -> Result<()> {
        Ok(())
    }
}

impl AgentSessionLogRepo for TraceRepo {
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        let (traceparent, tracestate) = macro_tower_layers::current_trace_carrier();
        let stored = StoredAgentSessionLog {
            created_at: Utc::now(),
            traceparent,
            tracestate,
            entry: log,
        };
        self.logs.lock().expect("log lock").push(stored.clone());
        Ok(stored)
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        Ok(self
            .logs
            .lock()
            .expect("log lock")
            .iter()
            .filter(|stored| stored.entry.agent_session_id == agent_session_id)
            .cloned()
            .collect())
    }
}

impl agent_fold::domain::ports::LogRepo for TraceRepo {
    async fn list_by_session(
        &self,
        session: AgentSessionId,
    ) -> std::result::Result<std::collections::VecDeque<AgentSessionLog>, rootcause::Report> {
        let stored = AgentSessionLogRepo::list_by_session(self, session)
            .await
            .map_err(|error| rootcause::report!(error))?;
        Ok(stored.into_iter().map(|stored| stored.entry).collect())
    }
}

#[derive(Clone)]
struct NoFolds;

impl FoldedMessageRepo for NoFolds {
    async fn messages(
        &self,
        _session: AgentSessionId,
    ) -> std::result::Result<Vec<FoldedMessage>, rootcause::Report> {
        Ok(Vec::new())
    }

    async fn next_turn_id(
        &self,
        _session: AgentSessionId,
    ) -> std::result::Result<TurnId, rootcause::Report> {
        Ok(TurnId(0))
    }
}

struct TestTransport {
    outbound: mpsc::Sender<ToRuntimeMessage>,
    inbound: mpsc::Receiver<ToServerMessage>,
}

#[derive(Clone)]
struct TestSender(mpsc::Sender<ToRuntimeMessage>);

impl Transport<ToRuntimeMessage, ToServerMessage> for TestTransport {
    type Sender = TestSender;
    type Receiver = mpsc::Receiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (TestSender(self.outbound), self.inbound)
    }
}

impl TransportSender<ToRuntimeMessage> for TestSender {
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        self.0
            .send(message)
            .await
            .map_err(|_| TransportError::Client("test receiver closed".to_owned()))
    }
}

fn session(id: AgentSessionId) -> AgentSession {
    let now = Utc::now();
    AgentSession {
        id,
        owner_id: MacroUserIdStr::try_from_email("trace@example.com").expect("valid user"),
        thread_id: None,
        thread_channel_id: None,
        originating_message_id: None,
        bot_id: BotId::TEST_A,
        model: "test".to_owned(),
        harness: "test".to_owned(),
        repo_url: None,
        workspace: "/workspace".to_owned(),
        acp_session_id: None,
        status: SessionStatus::NoMessages,
        created_at: now,
        modified_at: now,
    }
}

async fn drive_handshake(
    session: AgentSessionId,
    inbound: &mpsc::Sender<ToServerMessage>,
    outbound: &mut mpsc::Receiver<ToRuntimeMessage>,
) {
    inbound
        .send(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .await
        .unwrap();
    let _initialize = outbound.recv().await.expect("initialize request");
    inbound
        .send(ToServerMessage::Acp(AcpMessage(
            RawJsonRpcMessage::response(
                RequestId::Str(format!("agent_session:{session}:0")),
                Ok(serde_json::to_value(InitializeResponse::new(PROTOCOL_VERSION)).unwrap()),
            ),
        )))
        .await
        .unwrap();
    let _open = outbound.recv().await.expect("session/new request");
    inbound
        .send(ToServerMessage::Acp(AcpMessage(
            RawJsonRpcMessage::response(
                RequestId::Str(format!("agent_session:{session}:1")),
                Ok(serde_json::to_value(NewSessionResponse::new("acp-trace")).unwrap()),
            ),
        )))
        .await
        .unwrap();
}

fn trace_id(traceparent: &str) -> &str {
    traceparent
        .split('-')
        .nth(1)
        .expect("valid W3C traceparent")
}

#[tokio::test]
async fn abnormal_terminal_log_keeps_the_originating_turn_trace() {
    opentelemetry::global::set_text_map_propagator(
        opentelemetry_sdk::propagation::TraceContextPropagator::new(),
    );
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder().build();
    let subscriber = tracing_subscriber::registry()
        .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

    async {
        let id = AgentSessionId::new_from_uuid(Uuid::from_u128(42));
        let repo = TraceRepo::new(session(id));
        let service = AgentSessionServiceImpl::new(repo.clone(), NoFolds, NoOpRealtime);
        let (outbound_tx, mut outbound_rx) = mpsc::channel(16);
        let (inbound_tx, inbound_rx) = mpsc::channel(16);
        service
            .attach_session(
                id,
                RuntimeAttachment::solo(TestTransport {
                    outbound: outbound_tx,
                    inbound: inbound_rx,
                }),
            )
            .await
            .expect("attach session");
        drive_handshake(id, &inbound_tx, &mut outbound_rx).await;

        service
            .send_action(
                id,
                None,
                AgentAction::prompt("trace me"),
                AgentActionId::mint(),
            )
            .instrument(tracing::info_span!("test.caller"))
            .await
            .expect("send prompt");
        let prompt = outbound_rx.recv().await.expect("prompt request");
        assert!(matches!(
            prompt,
            ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request)))
                if request.method.as_ref() == "session/prompt"
        ));

        service.shutdown().await;
        let stored = AgentSessionLogRepo::list_by_session(&repo, id)
            .await
            .expect("read stored log");
        let prompt = stored
            .iter()
            .find(|stored| {
                matches!(
                    &stored.entry.content,
                    Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(
                        RawJsonRpcMessage::Request(request)
                    ))) if request.method.as_ref() == "session/prompt"
                )
            })
            .and_then(|stored| stored.traceparent.as_deref())
            .expect("prompt persisted under its turn");
        let terminal = stored
            .iter()
            .find(|stored| {
                matches!(
                    &stored.entry.content,
                    Message::ToServer(ToServerMessage::Event {
                        event: SystemEvent::Disconnected
                    })
                )
            })
            .and_then(|stored| stored.traceparent.as_deref())
            .expect("disconnect persisted under its turn");
        assert_eq!(trace_id(prompt), trace_id(terminal));
    }
    .with_subscriber(subscriber)
    .await;
}
