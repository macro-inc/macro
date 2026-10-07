use std::sync::{Arc, Mutex};

use super::*;
use crate::domain::routines::{
    PreparedRoutineSession, RoutineActionStatus, RoutinePromptAccepted, ValidatedRoutineSession,
};

#[derive(Clone, Default)]
struct Directory {
    candidates: Arc<Mutex<Vec<CodingAgentCandidate>>>,
    callers: Arc<Mutex<Vec<MacroUserIdStr<'static>>>>,
}

impl CodingAgentDirectory for Directory {
    async fn candidates(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<CodingAgentCandidate>, CodingAgentError> {
        self.callers.lock().unwrap().push(user_id);
        Ok(self.candidates.lock().unwrap().clone())
    }
}

#[derive(Clone, Default)]
struct Sessions {
    prepared: Arc<Mutex<Vec<PrepareRoutineSession>>>,
    prompted: Arc<Mutex<Vec<PromptRoutineSession>>>,
    prepare_failure: Arc<Mutex<Option<RoutineSessionError>>>,
    prompt_failure: Arc<Mutex<Option<RoutineSessionError>>>,
    mismatched_session: Arc<Mutex<bool>>,
    mismatched_action: Arc<Mutex<bool>>,
}

impl RoutineSessions for Sessions {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        panic!("prepare reauthorizes the persona; separate validation would race")
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        let session_id = command.session_id;
        self.prepared.lock().unwrap().push(command);
        if let Some(error) = *self.prepare_failure.lock().unwrap() {
            return Err(error);
        }
        Ok(PreparedRoutineSession {
            session_id: if *self.mismatched_session.lock().unwrap() {
                AgentSessionId::new()
            } else {
                session_id
            },
        })
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        let action_id = command.action.action_id;
        self.prompted.lock().unwrap().push(command);
        if let Some(error) = *self.prompt_failure.lock().unwrap() {
            return Err(error);
        }
        Ok(RoutinePromptAccepted {
            action_id: if *self.mismatched_action.lock().unwrap() {
                AgentActionId::mint()
            } else {
                action_id
            },
            queued: true,
        })
    }

    async fn status(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        panic!("dispatch returns after admission, without waiting for completion")
    }

    async fn cancel(&self, _: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        panic!("an uncertain dispatch must not cancel an admitted task")
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|coder@example.com".to_owned()).unwrap()
}

fn candidate(is_coding: bool, available: bool) -> CodingAgentCandidate {
    CodingAgentCandidate {
        handle: Some("repo-maintainer".into()),
        agent: CodingAgent {
            id: macro_uuid::generate_uuid_v7(),
            name: "Repository maintainer".into(),
            description: Some("Maintains the web app".into()),
            instructions: "Work in the product repository".into(),
            harness: "macrod".into(),
            model: Some("configured-default".into()),
        },
        is_coding,
        available,
    }
}

fn fixture() -> (
    CodingAgentServiceImpl<Directory, Sessions>,
    Directory,
    Sessions,
    CodingAgentCandidate,
) {
    let agent = candidate(true, true);
    let directory = Directory::default();
    directory.candidates.lock().unwrap().push(agent.clone());
    let sessions = Sessions::default();
    (
        CodingAgentServiceImpl::new(directory.clone(), sessions.clone()),
        directory,
        sessions,
        agent,
    )
}

fn command(agent_id: Uuid) -> DispatchCodingAgentRequest {
    DispatchCodingAgentRequest {
        agent_name: None,
        model: None,
        repo_url: None,
        repo_branch: None,
        user_id: user(),
        agent_id: Some(agent_id),
        prompt: "In owner/product, fix the login bug and add regression coverage.".into(),
    }
}

#[tokio::test]
async fn discovery_returns_available_chat_and_coding_personas_for_the_caller() {
    let (service, directory, _, agent) = fixture();
    let chat = candidate(false, true);
    directory.candidates.lock().unwrap().extend([
        chat.clone(),
        candidate(true, false),
        candidate(false, false),
    ]);

    assert_eq!(
        service.list(user()).await.unwrap(),
        vec![agent.agent, chat.agent]
    );
    assert_eq!(*directory.callers.lock().unwrap(), vec![user()]);
}

#[tokio::test]
async fn dispatch_prepares_and_prompts_once_with_the_callers_identity() {
    let (service, _, sessions, agent) = fixture();
    let request = command(agent.agent.id);
    let response = service.dispatch(request.clone()).await.unwrap();

    let prepared = sessions.prepared.lock().unwrap();
    assert_eq!(prepared.len(), 1);
    assert_eq!(prepared[0].selection.owner, user());
    assert_eq!(prepared[0].selection.bot_id.as_uuid(), agent.agent.id);
    assert_eq!(prepared[0].selection.model, None);
    assert_eq!(prepared[0].session_id.as_uuid(), response.agent_session_id);
    assert_eq!(response.agent_session_id.get_version_num(), 7);
    let prompted = sessions.prompted.lock().unwrap();
    assert_eq!(prompted.len(), 1);
    assert_eq!(prompted[0].action.owner, user());
    assert_eq!(prompted[0].action.bot_id.as_uuid(), agent.agent.id);
    assert_eq!(prompted[0].action.session_id, prepared[0].session_id);
    assert_eq!(prompted[0].action.action_id.as_uuid().get_version_num(), 7);
    assert_eq!(prompted[0].prompt, request.prompt);
    assert_eq!(response.agent_id, agent.agent.id);
    assert_eq!(response.agent_name, agent.agent.name);
}

#[tokio::test]
async fn discovery_does_not_authorize_a_later_dispatch() {
    let (service, directory, sessions, agent) = fixture();
    assert_eq!(service.list(user()).await.unwrap().len(), 1);
    directory.candidates.lock().unwrap().clear();

    assert_eq!(
        service.dispatch(command(agent.agent.id)).await,
        Err(CodingAgentError::Unavailable)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
    assert!(sessions.prompted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unavailable_personas_cannot_be_dispatched_by_id() {
    let (service, directory, sessions, _) = fixture();
    for rejected in [candidate(false, false), candidate(true, false)] {
        *directory.candidates.lock().unwrap() = vec![rejected.clone()];
        assert_eq!(
            service.dispatch(command(rejected.agent.id)).await,
            Err(CodingAgentError::Unavailable)
        );
    }
    assert!(sessions.prepared.lock().unwrap().is_empty());
    assert!(sessions.prompted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn blank_prompt_is_rejected_before_provisioning() {
    let (service, directory, sessions, agent) = fixture();
    let mut request = command(agent.agent.id);
    request.prompt = " \n\t".into();
    assert_eq!(
        service.dispatch(request).await,
        Err(CodingAgentError::InvalidPrompt)
    );
    assert!(directory.callers.lock().unwrap().is_empty());
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn authorization_failure_during_preparation_never_delivers_a_prompt() {
    let (service, _, sessions, agent) = fixture();
    *sessions.prepare_failure.lock().unwrap() = Some(RoutineSessionError::Forbidden);

    let error = service.dispatch(command(agent.agent.id)).await.unwrap_err();
    assert!(matches!(
        error,
        CodingAgentError::DispatchFailed {
            reason: RoutineSessionError::Forbidden,
            ..
        }
    ));
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);
    assert!(sessions.prompted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn uncertain_prompt_retains_session_id_and_never_retries() {
    let (service, _, sessions, agent) = fixture();
    *sessions.prompt_failure.lock().unwrap() = Some(RoutineSessionError::PromptDeliveryUnknown);

    let error = service.dispatch(command(agent.agent.id)).await.unwrap_err();
    let session_id = sessions.prepared.lock().unwrap()[0].session_id.as_uuid();
    assert_eq!(
        error,
        CodingAgentError::DispatchFailed {
            agent_session_id: session_id,
            reason: RoutineSessionError::PromptDeliveryUnknown,
        }
    );
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);
    assert_eq!(sessions.prompted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn mismatched_preparation_never_prompts_another_session() {
    let (service, _, sessions, agent) = fixture();
    *sessions.mismatched_session.lock().unwrap() = true;
    assert!(matches!(
        service.dispatch(command(agent.agent.id)).await,
        Err(CodingAgentError::DispatchFailed {
            reason: RoutineSessionError::SessionMismatch,
            ..
        })
    ));
    assert!(sessions.prompted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_different_accepted_action_does_not_report_dispatch_success() {
    let (service, _, sessions, agent) = fixture();
    *sessions.mismatched_action.lock().unwrap() = true;
    assert!(matches!(
        service.dispatch(command(agent.agent.id)).await,
        Err(CodingAgentError::DispatchFailed {
            reason: RoutineSessionError::PromptDeliveryUnknown,
            ..
        })
    ));
    assert_eq!(sessions.prompted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn named_chat_agent_uses_its_persona_and_explicit_model() {
    let (service, directory, sessions, _) = fixture();
    let mut grungus = candidate(false, true);
    grungus.agent.name = "Grungus".into();
    *directory.candidates.lock().unwrap() = vec![grungus.clone()];
    let mut request = command(grungus.agent.id);
    request.agent_id = None;
    request.agent_name = Some("grungus".into());
    request.model = Some("selected-model".into());
    let response = service.dispatch(request).await.unwrap();
    assert_eq!(response.agent_id, grungus.agent.id);
    let prepared = sessions.prepared.lock().unwrap();
    assert_eq!(
        prepared[0].selection.model.as_deref(),
        Some("selected-model")
    );
    assert_eq!(prepared[0].selection.bot_id.as_uuid(), grungus.agent.id);
}

#[tokio::test]
async fn model_only_session_does_not_require_a_connected_coding_provider() {
    let (service, directory, sessions, _) = fixture();
    directory.candidates.lock().unwrap().clear();
    let mut request = command(Uuid::nil());
    request.agent_id = None;
    request.model = Some("selected-model".into());
    let response = service.dispatch(request).await.unwrap();
    assert_eq!(response.agent_id, bot_id::MACRO_NEW_BOT_ID.as_uuid());
    assert!(directory.callers.lock().unwrap().is_empty());
    assert_eq!(sessions.prompted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cursor_receives_repository_and_branch_as_launch_options() {
    let (service, directory, sessions, _) = fixture();
    let mut cursor = candidate(true, true);
    cursor.agent.id = bot_id::CURSOR_BOT_ID.as_uuid();
    cursor.agent.name = "Cursor".into();
    cursor.agent.harness = "cursor".into();
    *directory.candidates.lock().unwrap() = vec![cursor];
    let mut request = command(bot_id::CURSOR_BOT_ID.as_uuid());
    request.agent_id = None;
    request.agent_name = Some("cursor".into());
    request.repo_url = Some("https://github.com/example/product".into());
    request.repo_branch = Some("feature/fix".into());
    service.dispatch(request.clone()).await.unwrap();
    let prepared = sessions.prepared.lock().unwrap();
    assert_eq!(prepared[0].repo_url, request.repo_url);
    assert_eq!(prepared[0].repo_branch, request.repo_branch);
}

#[tokio::test]
async fn ambiguous_names_fail_without_starting_either_agent() {
    let (service, directory, sessions, agent) = fixture();
    directory
        .candidates
        .lock()
        .unwrap()
        .push(candidate(false, true));
    let mut request = command(agent.agent.id);
    request.agent_id = None;
    request.agent_name = Some(agent.agent.name);
    assert_eq!(
        service.dispatch(request).await,
        Err(CodingAgentError::AmbiguousAgent)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn conflicting_selectors_and_blank_models_fail_before_provisioning() {
    let (service, _, sessions, agent) = fixture();
    let mut request = command(agent.agent.id);
    request.agent_name = Some(agent.agent.name);
    assert_eq!(
        service.dispatch(request).await,
        Err(CodingAgentError::InvalidCommand)
    );
    let mut request = command(agent.agent.id);
    request.model = Some(" ".into());
    assert_eq!(
        service.dispatch(request).await,
        Err(CodingAgentError::InvalidCommand)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disconnected_duplicate_name_does_not_silently_select_another_agent() {
    let (service, directory, sessions, agent) = fixture();
    directory
        .candidates
        .lock()
        .unwrap()
        .push(candidate(false, false));
    let mut request = command(agent.agent.id);
    request.agent_id = None;
    request.agent_name = Some(agent.agent.name);
    assert_eq!(
        service.dispatch(request).await,
        Err(CodingAgentError::AmbiguousAgent)
    );
    assert!(sessions.prepared.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mention_handle_resolves_the_saved_persona() {
    let (service, directory, sessions, agent) = fixture();
    directory.candidates.lock().unwrap()[0].handle = Some("grungus".into());
    let mut request = command(agent.agent.id);
    request.agent_id = None;
    request.agent_name = Some("@grungus".into());
    assert_eq!(
        service.dispatch(request).await.unwrap().agent_id,
        agent.agent.id
    );
    assert_eq!(sessions.prepared.lock().unwrap().len(), 1);
}
