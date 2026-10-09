use super::*;
use crate::domain::error::Result as SessionResult;
use crate::domain::model::{AgentMcpServers, ReplicaId, SandboxSize};
use crate::domain::ports::{
    AcceptedControl, BotFacts, ManagedAgentProfile, NoOpAgentSessionNameGenerator, NoOpRealtime,
    NoOpTurnObserver, NoopLifecyclePublisher, OpenExternalAgentSession, QueuedControl,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::{InMemoryAgentSessionRepo, test_agent_session};
use agent_fold::domain::service::FoldedMessageService;
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use shared_entity_registry::OwnedPurgeOutcome;
use std::sync::{Arc, Mutex};

#[test]
#[cfg(feature = "admission")]
fn definitive_admission_failures_survive_routine_preparation_and_prompt_mapping() {
    use ai_billing::{AiAdmissionError, DenyReason};
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Denied(DenyReason::OverageLimitReached),
        AiAdmissionError::Denied(DenyReason::OveragePaymentFailed),
        AiAdmissionError::Unavailable,
    ] {
        let expected = RoutineSessionError::Admission(error);
        assert_eq!(session_error(AgentSessionError::Admission(error)), expected);
        assert_eq!(prompt_error(AgentSessionError::Admission(error)), expected);
        let wire = serde_json::to_vec(&expected).unwrap();
        assert_eq!(
            serde_json::from_slice::<RoutineSessionError>(&wire).unwrap(),
            expected
        );
    }
}

#[derive(Clone)]
struct Directory(Arc<Mutex<Option<BotFacts>>>);

impl BotDirectory for Directory {
    async fn bot_facts(&self, _: BotId) -> SessionResult<Option<BotFacts>> {
        Ok(self.0.lock().unwrap().clone())
    }
    async fn user_has_team(&self, _: MacroUserIdStr<'static>, _: Uuid) -> SessionResult<bool> {
        Ok(false)
    }
    async fn user_shares_channel_with_bot(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> SessionResult<bool> {
        Ok(false)
    }
}

#[derive(Clone, Default)]
struct Openings {
    managed: Arc<Mutex<Vec<OpenManagedSession>>>,
    external: Arc<Mutex<Vec<RequestedExternalSession>>>,
    response: Arc<Mutex<Option<AgentSession>>>,
}

impl SessionOpener for Openings {
    async fn warm_session(
        &self,
        _owner: model_owner::Owner,
        _id: AgentSessionId,
    ) -> crate::domain::error::Result<Option<crate::domain::model::AgentSession>> {
        Ok(None)
    }

    async fn open_managed_session(
        &self,
        request: OpenManagedSession,
    ) -> SessionResult<AgentSession> {
        self.managed.lock().unwrap().push(request);
        Ok(self.response.lock().unwrap().clone().unwrap())
    }
    async fn open_external_session(
        &self,
        _: OpenExternalAgentSession,
    ) -> SessionResult<AgentSession> {
        panic!("external sessions must go through their requester")
    }
    async fn find_thread_session(
        &self,
        _: Uuid,
        _: BotId,
    ) -> SessionResult<Option<AgentSessionId>> {
        panic!("routine has no originating thread")
    }
}

impl ExternalSessionRequester for Openings {
    async fn request(&self, request: RequestedExternalSession) -> SessionResult<AgentSession> {
        self.external.lock().unwrap().push(request);
        self.response
            .lock()
            .unwrap()
            .clone()
            .ok_or(AgentSessionError::RuntimeUnavailable("offline"))
    }
}

#[derive(Clone, Default)]
struct Controls {
    events: Arc<Mutex<Vec<ControlEvent>>>,
    fail: Arc<Mutex<bool>>,
    queued: Arc<Mutex<Vec<QueuedControl>>>,
}

impl AgentSessionNotificationRecipient for Controls {
    async fn control_event(
        &self,
        _: AgentSessionId,
        event: ControlEvent,
    ) -> SessionResult<AcceptedControl> {
        let action_id = event.action_id.unwrap();
        self.events.lock().unwrap().push(event);
        if *self.fail.lock().unwrap() {
            return Err(AgentSessionError::RuntimeUnavailable("ambiguous failure"));
        }
        Ok(AcceptedControl {
            action_id,
            disposition: ControlDisposition::Sent,
        })
    }
    async fn queued_controls(&self, _: AgentSessionId) -> SessionResult<Vec<QueuedControl>> {
        Ok(self.queued.lock().unwrap().clone())
    }
    async fn delete_user_sessions(&self, _: MacroUserIdStr<'static>) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn session_deleted(&self, _: AgentSessionId) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn purge_owned_session(
        &self,
        _: AgentSessionId,
        _: &Owner,
    ) -> SessionResult<OwnedPurgeOutcome> {
        panic!("not a routine capability")
    }
    async fn edit_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: String,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn remove_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn steer_queued_control(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
        _: Option<MacroUserIdStr<'static>>,
    ) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn set_sandbox_size(&self, _: AgentSessionId, _: SandboxSize) -> SessionResult<()> {
        panic!("not a routine capability")
    }
    async fn session_harness(
        &self,
        _: AgentSessionId,
    ) -> SessionResult<Option<harness_id::HarnessId>> {
        panic!("routine preserves runtime binding")
    }
}

type Sessions = AgentSessionServiceImpl<
    InMemoryAgentSessionRepo,
    FoldedMessageService<InMemoryAgentSessionRepo>,
    NoOpRealtime,
>;
type Service = RoutineSessionsService<Directory, Openings, Openings, Sessions, Controls>;

struct Fixture {
    service: Service,
    directory: Directory,
    openings: Openings,
    controls: Controls,
    repo: InMemoryAgentSessionRepo,
    session: AgentSession,
}

impl Fixture {
    fn new(managed: bool) -> Self {
        let session = test_agent_session(AgentSessionId::new());
        let directory = Directory(Arc::new(Mutex::new(Some(BotFacts {
            has_agent: true,
            is_managed: managed,
            is_system: false,
            owner_user_id: Some(session.owner_user().unwrap().clone()),
            owner_team_id: None,
            harness_id: None,
            managed_profile: Some(ManagedAgentProfile {
                model: "persona-default".into(),
                harness: "persona-runtime".into(),
                instructions: "Keep persona instructions".into(),
                mcp_servers: AgentMcpServers::OwnerConnections,
            }),
            selected_channels: false,
        }))));
        let repo = InMemoryAgentSessionRepo::new();
        repo.insert_session(session.clone());
        let sessions = AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        );
        let openings = Openings::default();
        *openings.response.lock().unwrap() = Some(session.clone());
        let controls = Controls::default();
        let service = RoutineSessionsService::new(
            directory.clone(),
            openings.clone(),
            openings.clone(),
            sessions,
            controls.clone(),
        );
        Self {
            service,
            directory,
            openings,
            controls,
            repo,
            session,
        }
    }

    fn selection(&self) -> ValidateRoutineSession {
        ValidateRoutineSession {
            owner: self.session.owner_user().unwrap().clone(),
            bot_id: self.session.bot_id,
            model: None,
        }
    }

    fn prepare(&self) -> PrepareRoutineSession {
        PrepareRoutineSession {
            selection: self.selection(),
            session_id: self.session.id,
        }
    }

    fn action(&self) -> RoutineSessionAction {
        RoutineSessionAction {
            owner: self.session.owner_user().unwrap().clone(),
            bot_id: self.session.bot_id,
            session_id: self.session.id,
            action_id: AgentActionId::mint(),
        }
    }
}

#[tokio::test]
async fn managed_preparation_preserves_persona_and_applies_override_without_prompting() {
    let fx = Fixture::new(true);
    let mut command = fx.prepare();
    command.selection.model = Some(fx.session.model.clone());
    let prepared = fx.service.prepare(command).await.unwrap();
    assert_eq!(prepared.session_id, fx.session.id);
    let requests = fx.openings.managed.lock().unwrap();
    let request = &requests[0];
    assert_eq!(request.id, Some(fx.session.id));
    assert_eq!(request.owner, fx.session.owner_id);
    assert_eq!(request.model.as_deref(), Some(fx.session.model.as_str()));
    assert!(request.prompt.is_none());
    assert!(request.instructions.is_none());
    assert!(request.repo_url.is_none() && request.repo_branch.is_none());
    let persona = request.profile.as_ref().unwrap();
    assert_eq!(persona.bot_id, fx.session.bot_id);
    let profile = persona.profile.as_ref().unwrap();
    assert_eq!(profile.model, "persona-default");
    assert_eq!(profile.instructions, "Keep persona instructions");
    assert_eq!(profile.harness, "persona-runtime");
    assert_eq!(profile.mcp_servers, AgentMcpServers::OwnerConnections);
    assert!(fx.openings.external.lock().unwrap().is_empty());
    assert!(fx.controls.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn external_preparation_uses_requested_identity_and_model() {
    for override_model in [None, Some("override-model".to_owned())] {
        let fx = Fixture::new(false);
        let mut command = fx.prepare();
        command.selection.model = override_model.clone();
        if let Some(model) = &override_model {
            fx.openings.response.lock().unwrap().as_mut().unwrap().model = model.clone();
        }
        fx.service.prepare(command).await.unwrap();
        let requests = fx.openings.external.lock().unwrap();
        assert_eq!(
            requests.as_slice(),
            &[RequestedExternalSession {
                repo_url: None,
                session_id: fx.session.id,
                bot_id: fx.session.bot_id,
                owner: fx.session.owner_user().unwrap().clone(),
                model: override_model,
            }]
        );
        assert!(fx.openings.managed.lock().unwrap().is_empty());
        assert!(fx.controls.events.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn validation_does_not_open_runtime_and_preparation_reauthorizes() {
    for managed in [true, false] {
        let fx = Fixture::new(managed);
        assert_eq!(
            fx.service.validate(fx.selection()).await.unwrap(),
            ValidatedRoutineSession { managed }
        );
        assert!(fx.openings.managed.lock().unwrap().is_empty());
        assert!(fx.openings.external.lock().unwrap().is_empty());
        fx.directory
            .0
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .owner_user_id = Some(other_owner());
        assert_eq!(
            fx.service.prepare(fx.prepare()).await.unwrap_err(),
            RoutineSessionError::Forbidden
        );
        *fx.directory.0.lock().unwrap() = None;
        assert_eq!(
            fx.service.prepare(fx.prepare()).await.unwrap_err(),
            RoutineSessionError::PersonaUnavailable
        );
    }
}

fn other_owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("other@example.com").unwrap()
}

#[tokio::test]
async fn rejects_non_agents_blank_models_and_non_v7_execution_ids() {
    let fx = Fixture::new(true);
    let mut selection = fx.selection();
    selection.model = Some(" \t".into());
    assert_eq!(
        fx.service.validate(selection).await.unwrap_err(),
        RoutineSessionError::InvalidCommand
    );
    let mut command = fx.prepare();
    command.session_id = AgentSessionId::new_from_uuid(Uuid::nil());
    assert_eq!(
        fx.service.prepare(command).await.unwrap_err(),
        RoutineSessionError::InvalidCommand
    );
    let mut action = fx.action();
    action.action_id = AgentActionId::from_uuid(Uuid::nil());
    assert_eq!(
        fx.service.status(action).await.unwrap_err(),
        RoutineSessionError::InvalidCommand
    );
    fx.directory.0.lock().unwrap().as_mut().unwrap().has_agent = false;
    assert_eq!(
        fx.service.validate(fx.selection()).await.unwrap_err(),
        RoutineSessionError::PersonaUnavailable
    );
}

#[tokio::test]
async fn rejects_mismatched_external_owner_bot_session_and_model() {
    for field in ["owner", "bot", "session", "model"] {
        let fx = Fixture::new(false);
        let mut response = fx.session.clone();
        match field {
            "owner" => response.owner_id = Owner::User(other_owner()),
            "bot" => response.bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7()),
            "session" => response.id = AgentSessionId::new(),
            "model" => response.model = "wrong-model".into(),
            _ => unreachable!(),
        }
        *fx.openings.response.lock().unwrap() = Some(response);
        let mut command = fx.prepare();
        command.selection.model = Some(fx.session.model.clone());
        let expected = if field == "model" {
            RoutineSessionError::ModelMismatch
        } else {
            RoutineSessionError::SessionMismatch
        };
        assert_eq!(fx.service.prepare(command).await.unwrap_err(), expected);
        assert!(fx.controls.events.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn offline_external_agent_validates_but_cannot_prepare() {
    let fx = Fixture::new(false);
    *fx.openings.response.lock().unwrap() = None;
    fx.service.validate(fx.selection()).await.unwrap();
    assert_eq!(
        fx.service.prepare(fx.prepare()).await.unwrap_err(),
        RoutineSessionError::RuntimeUnavailable
    );
}

#[tokio::test]
async fn every_subsequent_operation_checks_owner_and_persona_before_controls_or_history() {
    let fx = Fixture::new(true);
    for change_owner in [true, false] {
        let mut action = fx.action();
        if change_owner {
            action.owner = other_owner();
        } else {
            action.bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
        }
        assert_eq!(
            fx.service.status(action.clone()).await.unwrap_err(),
            RoutineSessionError::Forbidden
        );
        assert_eq!(
            fx.service.cancel(action.clone()).await.unwrap_err(),
            RoutineSessionError::Forbidden
        );
        assert_eq!(
            fx.service
                .prompt(PromptRoutineSession {
                    action,
                    prompt: "task".into()
                })
                .await
                .unwrap_err(),
            RoutineSessionError::Forbidden
        );
    }
    assert_eq!(fx.repo.log_reads(), 0);
    assert!(fx.controls.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn prompt_and_cancel_only_emit_attributed_prompt_and_stop_controls() {
    let fx = Fixture::new(true);
    let action = fx.action();
    let accepted = fx
        .service
        .prompt(PromptRoutineSession {
            action: action.clone(),
            prompt: "routine guidance and task".into(),
        })
        .await
        .unwrap();
    assert_eq!(accepted.action_id, action.action_id);
    assert!(!accepted.queued);
    fx.service.cancel(action.clone()).await.unwrap();
    let events = fx.controls.events.lock().unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(
        events[0].action,
        AgentAction::prompt("routine guidance and task")
    );
    assert_eq!(events[0].action_id, Some(action.action_id));
    assert_eq!(events[0].actor, Some(action.owner.clone()));
    assert_eq!(events[1].action, AgentAction::Stop);
    assert_ne!(events[1].action_id, Some(action.action_id));
    assert_eq!(events[1].actor, Some(action.owner));
}

#[tokio::test]
async fn ambiguous_prompt_failure_is_not_replayed() {
    let fx = Fixture::new(true);
    *fx.controls.fail.lock().unwrap() = true;
    assert_eq!(
        fx.service
            .prompt(PromptRoutineSession {
                action: fx.action(),
                prompt: "task".into()
            })
            .await
            .unwrap_err(),
        RoutineSessionError::PromptDeliveryUnknown
    );
    assert_eq!(fx.controls.events.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn refuses_known_prompt_replays_even_after_completion() {
    let fx = Fixture::new(true);
    let action = fx.action();
    let content: ToRuntimeMessage = AgentAction::prompt("already submitted")
        .to_runtime(
            &agent_client_protocol::schema::v1::SessionId::new("s"),
            action.action_id.to_request_id(),
        )
        .unwrap();
    fx.repo.extend_log([crate::domain::model::AgentSessionLog {
        agent_session_id: fx.session.id,
        user_id: Some(action.owner.clone()),
        content: crate::domain::model::Message::ToRuntime(content),
    }]);
    let response = serde_json::json!({
        "direction": "to_server",
        "content": {
            "type": "acp", "jsonrpc": "2.0", "id": action.action_id,
            "result": { "stopReason": "end_turn" }
        }
    });
    fx.repo.extend_log(agent_fold::testing::parse_log_as(
        fx.session.id,
        &response.to_string(),
    ));
    assert_eq!(
        fx.service.status(action.clone()).await.unwrap(),
        RoutineActionStatus::Succeeded
    );
    assert_eq!(
        fx.service
            .prompt(PromptRoutineSession {
                action,
                prompt: "retry".into()
            })
            .await
            .unwrap_err(),
        RoutineSessionError::Conflict
    );
    assert!(fx.controls.events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn queued_prompt_prevents_second_submission() {
    let fx = Fixture::new(true);
    let action = fx.action();
    fx.controls.queued.lock().unwrap().push(QueuedControl {
        action_id: action.action_id,
        action: AgentAction::prompt("queued"),
        actor: Some(action.owner.clone()),
        created_at: chrono::Utc::now(),
    });
    assert_eq!(
        fx.service
            .prompt(PromptRoutineSession {
                action,
                prompt: "retry".into()
            })
            .await
            .unwrap_err(),
        RoutineSessionError::Conflict
    );
    assert!(fx.controls.events.lock().unwrap().is_empty());
}

#[test]
fn commands_reject_malformed_owner_and_ids_at_deserialization() {
    let fx = Fixture::new(true);
    let command = fx.action();
    let mut value = serde_json::to_value(&command).unwrap();
    value["owner"] = serde_json::json!("not-a-user");
    assert!(serde_json::from_value::<RoutineSessionAction>(value).is_err());
    let mut value = serde_json::to_value(&command).unwrap();
    value["session_id"] = serde_json::json!("not-a-uuid");
    assert!(serde_json::from_value::<RoutineSessionAction>(value).is_err());
}
