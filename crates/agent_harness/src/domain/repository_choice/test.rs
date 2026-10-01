use super::*;
use agent_session::domain::ports::MockAgentSessionRepo;
use ai_billing::{AdmissionFuture, AiAdmissionError, DenyReason};
use std::sync::{
    Mutex,
    atomic::{AtomicUsize, Ordering},
};

const REPO: &str = "https://github.com/macro-inc/macro";
const OTHER: &str = "https://github.com/macro-inc/infra";

struct StubRepositories(Vec<String>);

#[async_trait::async_trait]
impl ReachableRepositories for StubRepositories {
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> crate::domain::error::Result<Vec<crate::domain::model::ReachableRepository>> {
        assert_eq!(user, &owner());
        Ok(self
            .0
            .iter()
            .map(|url| crate::domain::model::ReachableRepository {
                url: url.clone(),
                default_branch: Some("main".to_owned()),
            })
            .collect())
    }
}

struct Admission {
    result: Result<(), AiAdmissionError>,
    calls: AtomicUsize,
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        assert_eq!(user, &owner());
        assert_eq!(feature, AiFeature::AgentRepositoryChoice);
        self.calls.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { self.result })
    }
}

struct Model {
    calls: Arc<Mutex<Vec<String>>>,
    admission: Arc<Admission>,
}

impl RepositoryChoiceModel for Model {
    async fn decide(
        &self,
        user: &MacroUserIdStr<'_>,
        prompt: &str,
        candidates: &[String],
        _recent: &[AgentSession],
        fallback: &str,
    ) -> Result<String, rootcause::Report> {
        assert_eq!(user, &owner());
        assert_eq!(prompt, "fix home");
        assert_eq!(self.admission.calls.load(Ordering::SeqCst), 1);
        assert!(self.admission.result.is_ok());
        assert!(candidates.contains(&fallback.to_owned()));
        self.calls.lock().unwrap().push(prompt.to_owned());
        Ok(fallback.to_owned())
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@macro.com".to_owned()).unwrap()
}

fn admission(result: Result<(), AiAdmissionError>) -> Arc<Admission> {
    Arc::new(Admission {
        result,
        calls: AtomicUsize::new(0),
    })
}

fn sessions() -> MockAgentSessionRepo {
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().returning(|id| {
        Box::pin(async move { Ok(agent_session::testing::test_agent_session(id)) })
    });
    sessions
}

fn chooser(
    sessions: MockAgentSessionRepo,
    candidates: &[&str],
    admission: Arc<Admission>,
    calls: Arc<Mutex<Vec<String>>>,
) -> RepositoryChoiceService<StubRepositories, MockAgentSessionRepo, Model> {
    RepositoryChoiceService::new(
        Arc::new(StubRepositories(
            candidates.iter().map(|s| (*s).to_owned()).collect(),
        )),
        sessions,
        Model {
            calls,
            admission: admission.clone(),
        },
        admission,
        owner(),
        AgentSessionId::new(),
    )
}

#[tokio::test]
async fn deterministic_selection_never_checks_quota_or_calls_a_model() {
    for candidates in [vec![], vec![REPO]] {
        let mut sessions = sessions();
        sessions.expect_recent_for_owner().never();
        let has_repo = !candidates.is_empty();
        sessions
            .expect_set_repo_url()
            .times(usize::from(has_repo))
            .withf(|_, url| url.as_deref() == Some(REPO))
            .returning(|_, _| Box::pin(async { Ok(()) }));
        let gate = admission(Err(AiAdmissionError::Unavailable));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = chooser(sessions, &candidates, gate.clone(), calls.clone())
            .choose("fix home", std::path::Path::new(""))
            .await;
        if has_repo {
            assert_eq!(result.unwrap().repository.unwrap().as_str(), REPO);
        } else {
            assert!(result.unwrap_err().to_string().contains("Connect GitHub"));
        }
        assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
        assert!(calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn explicit_repository_bypasses_automatic_selection() {
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().returning(|id| {
        Box::pin(async move {
            let mut session = agent_session::testing::test_agent_session(id);
            session.repo_url = Some(OTHER.into());
            session.repo_branch = Some(
                agent_session::domain::repository_branch::RepositoryBranch::parse(
                    "feature/home".into(),
                )
                .unwrap(),
            );
            Ok(session)
        })
    });
    sessions.expect_set_repo_url().never();
    sessions.expect_recent_for_owner().never();
    let gate = admission(Err(AiAdmissionError::Denied(
        DenyReason::AllowanceExhausted,
    )));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let result = chooser(sessions, &[], gate.clone(), calls.clone())
        .choose("fix home", std::path::Path::new(""))
        .await
        .unwrap();
    assert_eq!(result.repository.unwrap().as_str(), OTHER);
    assert_eq!(gate.calls.load(Ordering::SeqCst), 0);
    assert!(calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn refusal_preserves_the_typed_error_without_model_or_persistence_calls() {
    for error in [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable,
    ] {
        let mut sessions = sessions();
        sessions.expect_recent_for_owner().never();
        sessions.expect_set_repo_url().never();
        let gate = admission(Err(error));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let report = chooser(sessions, &[REPO, OTHER], gate.clone(), calls.clone())
            .choose("fix home", std::path::Path::new(""))
            .await
            .unwrap_err();
        assert_eq!(
            report.downcast_current_context::<AiAdmissionError>(),
            Some(&error)
        );
        assert_eq!(gate.calls.load(Ordering::SeqCst), 1);
        assert!(calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn admitted_selection_calls_model_and_persists_its_choice() {
    let mut sessions = sessions();
    sessions
        .expect_recent_for_owner()
        .once()
        .returning(|_, _| Box::pin(async { Ok(vec![]) }));
    sessions
        .expect_set_repo_url()
        .once()
        .withf(|_, url| url.as_deref() == Some(REPO))
        .returning(|_, _| Box::pin(async { Ok(()) }));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let result = chooser(sessions, &[REPO, OTHER], admission(Ok(())), calls.clone())
        .choose("fix home", std::path::Path::new(""))
        .await
        .unwrap();
    assert_eq!(result.repository.unwrap().as_str(), REPO);
    assert_eq!(calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn history_excludes_current_session_and_searches_past_chat_only_sessions() {
    let current = AgentSessionId::new();
    let prior = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|_, limit| limit.get() == 6)
        .return_once(move |_, _| {
            Box::pin(async move {
                Ok((0..6)
                    .map(|i| {
                        let id = if i == 0 {
                            current
                        } else {
                            AgentSessionId::new()
                        };
                        agent_session::testing::test_agent_session(id)
                    })
                    .collect())
            })
        });
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|_, limit| limit.get() == 12)
        .return_once(move |_, _| {
            Box::pin(async move {
                let mut session = agent_session::testing::test_agent_session(prior);
                session.repo_url = Some(OTHER.into());
                Ok(vec![
                    agent_session::testing::test_agent_session(current),
                    session,
                ])
            })
        });
    let mut service = chooser(sessions, &[], admission(Ok(())), Arc::default());
    service.session_id = current;
    let candidates = vec![REPO.to_owned(), OTHER.to_owned()];
    let recent = service.recent_sessions(&candidates).await.unwrap();
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].id, prior);
    assert_eq!(fallback_repository(&candidates, &recent).unwrap(), OTHER);
}
