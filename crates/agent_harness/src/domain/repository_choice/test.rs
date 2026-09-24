use super::*;
use agent_session::domain::ports::MockAgentSessionRepo;
use ai_billing::domain::{AiAdmissionError, DenyReason};
use std::sync::Mutex;

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
                default_branch: Some("main".into()),
            })
            .collect())
    }
}

#[derive(Clone, Copy)]
enum Admission {
    Allow,
    Deny,
    Unavailable,
    Never,
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: ai_usage::AiFeature,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<(), AiAdmissionError>> + Send + 'a>> {
        assert_eq!(user, &owner());
        assert_eq!(feature, ai_usage::AiFeature::AgentRepositoryChoice);
        Box::pin(async move {
            match self {
                Self::Allow => Ok(()),
                Self::Deny => Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)),
                Self::Unavailable => Err(AiAdmissionError::Unavailable(rootcause::report!(
                    "private billing failure"
                ))),
                Self::Never => panic!("deterministic choices must not request admission"),
            }
        })
    }
}

struct Model {
    answer: Option<String>,
    calls: Mutex<usize>,
}

impl RepositoryChoiceModel for Model {
    async fn decide(
        &self,
        user: &MacroUserIdStr<'_>,
        prompt: &str,
        candidates: &[String],
        recent: &[AgentSession],
    ) -> Result<Option<String>, rootcause::Report> {
        assert_eq!(user, &owner());
        assert_eq!(prompt, "fix home");
        assert_eq!(candidates, &[REPOSITORY.to_owned()]);
        assert!(recent.is_empty());
        *self.calls.lock().unwrap() += 1;
        Ok(self.answer.clone())
    }
}

const REPOSITORY: &str = "https://github.com/macro-inc/infra";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@macro.com".to_owned()).unwrap()
}

fn chooser(
    sessions: MockAgentSessionRepo,
    id: AgentSessionId,
    candidates: Vec<String>,
    admission: Admission,
    answer: Option<String>,
) -> RepositoryChoice<StubRepositories, MockAgentSessionRepo, Model> {
    RepositoryChoice::new(
        Arc::new(StubRepositories(candidates)),
        sessions,
        Model {
            answer,
            calls: Mutex::new(0),
        },
        Arc::new(admission),
        owner(),
        id,
    )
}

fn unselected_session() -> MockAgentSessionRepo {
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().once().returning(|id| {
        Box::pin(async move { Ok(agent_session::testing::test_agent_session(id)) })
    });
    sessions
}

#[tokio::test]
async fn explicit_repository_needs_neither_allowance_nor_model() {
    let id = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().once().returning(|id| {
        Box::pin(async move {
            let mut session = agent_session::testing::test_agent_session(id);
            session.repo_url = Some(REPOSITORY.into());
            session.repo_branch = Some(
                agent_session::domain::repository_branch::RepositoryBranch::parse(
                    "feature/home".into(),
                )
                .unwrap(),
            );
            Ok(session)
        })
    });
    sessions.expect_recent_for_owner().never();
    sessions.expect_set_repo_url().never();
    let choice = chooser(sessions, id, vec![], Admission::Never, None);
    let selected = choice.choose("fix home").await.unwrap();
    assert_eq!(
        selected.repository.as_ref().map(RepoUrl::as_str),
        Some(REPOSITORY)
    );
    assert!(selected.open_pull_request);
    assert_eq!(*choice.model.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn no_candidates_clears_the_repository_without_allowance_or_model() {
    let id = AgentSessionId::new();
    let mut sessions = unselected_session();
    sessions.expect_recent_for_owner().never();
    sessions
        .expect_set_repo_url()
        .once()
        .withf(move |session, url| *session == id && url.is_none())
        .return_once(|_, _| Box::pin(async { Ok(()) }));
    let choice = chooser(sessions, id, vec![], Admission::Never, None);
    assert_eq!(
        choice.choose("fix home").await.unwrap(),
        SessionIntent::default()
    );
    assert_eq!(*choice.model.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn admission_failure_never_calls_model_or_persists_a_choice() {
    for admission in [Admission::Deny, Admission::Unavailable] {
        let mut sessions = unselected_session();
        sessions.expect_recent_for_owner().never();
        sessions.expect_set_repo_url().never();
        let choice = chooser(
            sessions,
            AgentSessionId::new(),
            vec![REPOSITORY.into()],
            admission,
            None,
        );
        let error = choice.choose("fix home").await.unwrap_err();
        let error = error
            .downcast_current_context::<AiAdmissionError>()
            .expect("typed admission failure");
        match admission {
            Admission::Deny => assert!(matches!(
                error,
                AiAdmissionError::Denied(DenyReason::AllowanceExhausted)
            )),
            Admission::Unavailable => assert!(matches!(error, AiAdmissionError::Unavailable(_))),
            _ => unreachable!(),
        }
        assert_eq!(*choice.model.calls.lock().unwrap(), 0);
    }
}

#[tokio::test]
async fn admitted_choice_is_persisted_including_none() {
    for answer in [Some(REPOSITORY.to_owned()), None] {
        let id = AgentSessionId::new();
        let mut sessions = unselected_session();
        sessions
            .expect_recent_for_owner()
            .once()
            .returning(|_, _| Box::pin(async { Ok(vec![]) }));
        let expected = answer.clone();
        sessions
            .expect_set_repo_url()
            .once()
            .withf(move |session, url| *session == id && *url == expected)
            .return_once(|_, _| Box::pin(async { Ok(()) }));
        let choice = chooser(
            sessions,
            id,
            vec![REPOSITORY.into()],
            Admission::Allow,
            answer.clone(),
        );
        let selected = choice.choose("fix home").await.unwrap();
        assert_eq!(
            selected.repository.as_ref().map(ToString::to_string),
            answer
        );
        assert_eq!(selected.open_pull_request, answer.is_some());
        assert_eq!(*choice.model.calls.lock().unwrap(), 1);
    }
}

#[tokio::test]
async fn model_cannot_select_an_unreachable_repository() {
    let mut sessions = unselected_session();
    sessions
        .expect_recent_for_owner()
        .once()
        .returning(|_, _| Box::pin(async { Ok(vec![]) }));
    sessions.expect_set_repo_url().never();
    let choice = chooser(
        sessions,
        AgentSessionId::new(),
        vec![REPOSITORY.into()],
        Admission::Allow,
        Some("https://github.com/other/private".into()),
    );
    assert!(
        choice
            .choose("fix home")
            .await
            .unwrap_err()
            .to_string()
            .contains("not one of this user's repositories")
    );
}

#[tokio::test]
async fn history_excludes_current_session_without_crowding_out_prior_work() {
    let current = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    let prior: Vec<_> = (0..5).map(|_| AgentSessionId::new()).collect();
    let expected = prior.clone();
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|user, limit| *user == owner() && limit.get() == 6)
        .return_once(move |_, _| {
            Box::pin(async move {
                Ok(std::iter::once(current)
                    .chain(prior)
                    .map(agent_session::testing::test_agent_session)
                    .collect())
            })
        });
    let choice = chooser(sessions, current, vec![], Admission::Never, None);
    let recent = choice.recent_sessions().await.unwrap();
    assert_eq!(
        recent.iter().map(|session| session.id).collect::<Vec<_>>(),
        expected
    );
}
