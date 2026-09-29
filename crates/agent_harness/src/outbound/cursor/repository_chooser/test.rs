use super::*;
use agent_session::domain::ports::MockAgentSessionRepo;
use std::sync::Mutex;

/// A canned listing, with what it was asked for recorded.
struct StubRepositories {
    repositories: Vec<String>,
    asked_for: Mutex<Vec<String>>,
}

impl StubRepositories {
    fn with(repositories: &[&str]) -> Arc<Self> {
        Arc::new(Self {
            repositories: repositories.iter().map(|url| (*url).to_owned()).collect(),
            asked_for: Mutex::new(Vec::new()),
        })
    }
}

#[async_trait::async_trait]
impl ReachableRepositories for StubRepositories {
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> crate::domain::error::Result<Vec<crate::domain::model::ReachableRepository>> {
        self.asked_for
            .lock()
            .expect("stub poisoned")
            .push(user.to_string());
        Ok(self
            .repositories
            .iter()
            .map(|url| crate::domain::model::ReachableRepository {
                url: url.clone(),
                default_branch: Some("main".to_owned()),
            })
            .collect())
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@macro.com".to_owned()).expect("a valid user id")
}

fn candidates() -> Vec<String> {
    vec![
        "https://github.com/macro-inc/macro".to_owned(),
        "https://github.com/macro-inc/infra".to_owned(),
    ]
}

/// A coding session cannot start without access to a repository.
#[tokio::test]
async fn no_reachable_repository_fails_without_asking_the_model() {
    let session_id = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().returning(|id| {
        Box::pin(async move { Ok(agent_session::testing::test_agent_session(id)) })
    });
    sessions.expect_recent_for_owner().never();
    sessions.expect_set_repo_url().never();

    let repositories = StubRepositories::with(&[]);
    let chooser = HaikuRepositoryChooser::new(
        Arc::clone(&repositories),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        session_id,
    );

    let error = chooser
        .choose("fix the login button", std::path::Path::new(""))
        .await
        .expect_err("GitHub access is required");
    assert!(error.to_string().contains("Connect GitHub"));
    assert_eq!(
        repositories.asked_for.lock().expect("stub poisoned").len(),
        1,
        "the listing is read once, for the session's owner"
    );
}

/// The prompt sections are what the model reads; an empty history says so
/// rather than leaving the section blank for it to interpret.
#[test]
fn the_user_message_carries_candidates_recent_sessions_and_the_prompt() {
    let message = user_message("rename the button", &candidates(), &[], &candidates()[0]);
    assert!(message.contains("<candidate_repositories>\nhttps://github.com/macro-inc/macro\n"));
    assert!(message.contains("<recent_sessions>\nnone\n</recent_sessions>"));
    assert!(message.contains("<prompt>\nrename the button\n</prompt>"));
    assert!(message.contains(
        "<fallback_repository>\nhttps://github.com/macro-inc/macro\n</fallback_repository>"
    ));
}

/// The model cannot express a repository the user does not reach.
#[test]
fn the_schema_allows_only_candidate_repositories() {
    let schema = choice_schema(&candidates());
    let allowed = schema.schema["properties"]["repository"]["enum"]
        .as_array()
        .expect("an enum of allowed answers")
        .clone();
    assert_eq!(
        allowed,
        vec![
            serde_json::json!("https://github.com/macro-inc/macro"),
            serde_json::json!("https://github.com/macro-inc/infra"),
        ]
    );
}

#[tokio::test]
async fn history_excludes_the_current_session_without_crowding_out_prior_work() {
    let current = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    let prior: Vec<_> = (0..5).map(|_| AgentSessionId::new()).collect();
    let expected = prior.clone();
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|_, limit| limit.get() == 6)
        .return_once(move |_, _| {
            Box::pin(async move {
                Ok(std::iter::once(current)
                    .chain(prior)
                    .map(|id| AgentSession {
                        repo_branch: None,
                        id,
                        name: "session".into(),
                        harness: "cursor".into(),
                        repo_url: Some("https://github.com/macro-inc/macro".into()),
                        ..agent_session::testing::test_agent_session(id)
                    })
                    .collect())
            })
        });
    let chooser = HaikuRepositoryChooser::new(
        StubRepositories::with(&[]),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        current,
    );
    let recent = chooser.recent_sessions(&candidates()).await.unwrap();
    assert_eq!(
        recent.iter().map(|session| session.id).collect::<Vec<_>>(),
        expected
    );
}

#[tokio::test]
async fn explicit_repository_bypasses_automatic_selection() {
    let session_id = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().returning(|id| {
        Box::pin(async move {
            let mut session = agent_session::testing::test_agent_session(id);
            session.repo_url = Some("https://github.com/macro-inc/infra".into());
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
    let repositories = StubRepositories::with(&[]);
    let chooser = HaikuRepositoryChooser::new(
        Arc::clone(&repositories),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        session_id,
    );
    let result = chooser
        .choose("fix home", std::path::Path::new(""))
        .await
        .unwrap();
    assert_eq!(
        result.repository.as_ref().map(RepoUrl::as_str),
        Some("https://github.com/macro-inc/infra")
    );
    assert!(repositories.asked_for.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_single_repository_is_selected_without_a_model_call() {
    let session_id = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_get().returning(|id| {
        Box::pin(async move { Ok(agent_session::testing::test_agent_session(id)) })
    });
    sessions.expect_recent_for_owner().never();
    sessions
        .expect_set_repo_url()
        .once()
        .withf(|_, url| url.as_deref() == Some("https://github.com/macro-inc/macro"))
        .return_once(|_, _| Box::pin(async { Ok(()) }));
    let chooser = HaikuRepositoryChooser::new(
        StubRepositories::with(&["https://github.com/macro-inc/macro"]),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        session_id,
    );
    assert!(
        chooser
            .choose("explain this code", std::path::Path::new(""))
            .await
            .unwrap()
            .repository
            .is_some()
    );
}

#[tokio::test]
async fn history_searches_past_recent_sessions_without_repositories() {
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|_, limit| limit.get() == 6)
        .return_once(|_, _| {
            Box::pin(async {
                Ok((0..6)
                    .map(|_| {
                        let mut session =
                            agent_session::testing::test_agent_session(AgentSessionId::new());
                        session.repo_url = None;
                        session
                    })
                    .collect())
            })
        });
    sessions
        .expect_recent_for_owner()
        .once()
        .withf(|_, limit| limit.get() == 12)
        .return_once(|_, _| {
            Box::pin(async {
                Ok((0..7)
                    .map(|i| {
                        let mut session =
                            agent_session::testing::test_agent_session(AgentSessionId::new());
                        session.repo_url =
                            (i == 6).then(|| "https://github.com/macro-inc/infra".into());
                        session
                    })
                    .collect())
            })
        });
    let chooser = HaikuRepositoryChooser::new(
        StubRepositories::with(&[]),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        AgentSessionId::new(),
    );
    let recent = chooser.recent_sessions(&candidates()).await.unwrap();
    assert_eq!(
        fallback_repository(&candidates(), &recent).unwrap(),
        "https://github.com/macro-inc/infra"
    );
}
