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

impl ReachableRepositories for StubRepositories {
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> crate::domain::error::Result<Vec<String>> {
        self.asked_for
            .lock()
            .expect("stub poisoned")
            .push(user.to_string());
        Ok(self.repositories.clone())
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

/// Nothing to choose between is answered without spending a model call - and
/// the session's row is still written, so a stamped default cannot survive.
#[tokio::test]
async fn no_reachable_repository_chooses_none_without_asking_the_model() {
    let session_id = AgentSessionId::new();
    let mut sessions = MockAgentSessionRepo::new();
    sessions.expect_recent_for_owner().never();
    sessions
        .expect_set_repo_url()
        .once()
        .withf(move |id, repo_url| *id == session_id && repo_url.is_none())
        .return_once(|_, _| Box::pin(async { Ok(()) }));

    let repositories = StubRepositories::with(&[]);
    let chooser = HaikuRepositoryChooser::new(
        Arc::clone(&repositories),
        sessions,
        Arc::new(ai_usage::NoOpUsageRecorder),
        owner(),
        session_id,
    );

    let intent = chooser
        .choose("fix the login button")
        .await
        .expect("choose");
    assert_eq!(intent, SessionIntent::default());
    assert_eq!(
        repositories.asked_for.lock().expect("stub poisoned").len(),
        1,
        "the listing is read once, for the session's owner"
    );
}

/// An answer naming something nobody offered is an error, not a pick: the
/// schema already excluded it, so a miss is a model ignoring the list.
#[test]
fn a_repository_outside_the_candidates_is_refused() {
    let error = intent(
        &candidates(),
        Some("https://github.com/someone-else/secrets"),
        true,
    )
    .expect_err("a non-candidate is refused");
    assert!(
        error
            .to_string()
            .contains("not one of this user's repositories"),
        "{error}"
    );
}

#[test]
fn a_candidate_is_taken_with_its_pull_request_decision() {
    let chosen = intent(
        &candidates(),
        Some("https://github.com/macro-inc/infra"),
        true,
    )
    .expect("a candidate is taken");
    assert_eq!(
        chosen.repository.as_ref().map(RepoUrl::as_str),
        Some("https://github.com/macro-inc/infra")
    );
    assert!(chosen.open_pull_request);
}

#[test]
fn no_repository_means_no_pull_request() {
    let chosen = intent(&candidates(), None, true).expect("no repository is an answer");
    assert_eq!(chosen, SessionIntent::default());
}

/// The three sections are what the model reads; an empty history says so
/// rather than leaving the section blank for it to interpret.
#[test]
fn the_user_message_carries_candidates_recent_sessions_and_the_prompt() {
    let message = user_message("rename the button", &candidates(), &[]);
    assert!(message.contains("<candidate_repositories>\nhttps://github.com/macro-inc/macro\n"));
    assert!(message.contains("<recent_sessions>\nnone\n</recent_sessions>"));
    assert!(message.contains("<prompt>\nrename the button\n</prompt>"));
}

/// The model cannot express a repository the user does not reach.
#[test]
fn the_schema_allows_only_the_candidates_and_null() {
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
            serde_json::Value::Null,
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
                    .map(|id| RecentAgentSession {
                        id,
                        name: "session".into(),
                        harness: "cursor".into(),
                        repo_url: None,
                        created_at: chrono::Utc::now(),
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
    let recent = chooser.recent_sessions().await.unwrap();
    assert_eq!(
        recent.iter().map(|session| session.id).collect::<Vec<_>>(),
        expected
    );
}
