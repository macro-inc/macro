use super::*;
use codex_cloud_agents::domain::EnvironmentRepository;
use codex_cloud_agents::domain::acp_session::{
    Outcome, SessionService, SessionSink, SessionStore, StoredSession,
};
use codex_cloud_agents::domain::cloud::CloudEvent;
use codex_cloud_agents::domain::journal::{JournalEntry, JournalInput};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Default, Clone)]
struct Journal(
    Arc<Mutex<HashMap<String, StoredSession>>>,
    Arc<Mutex<HashMap<String, Vec<JournalEntry>>>>,
);
impl SessionStore for Journal {
    async fn load(&self, id: &str) -> Result<Option<StoredSession>, rootcause::Report> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    async fn save(&self, id: &str, state: &StoredSession) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().insert(id.into(), state.clone());
        Ok(())
    }
    async fn read(&self, id: &str) -> Result<Vec<JournalEntry>, rootcause::Report> {
        Ok(self.1.lock().unwrap().get(id).cloned().unwrap_or_default())
    }
    async fn append(
        &self,
        id: &str,
        expected: i64,
        turn: Option<&TurnId>,
        input: &JournalInput,
    ) -> Result<JournalEntry, rootcause::Report> {
        let mut journals = self.1.lock().unwrap();
        let entries = journals.entry(id.into()).or_default();
        assert_eq!(entries.len() as i64, expected);
        let entry = JournalEntry {
            sequence: expected + 1,
            turn: turn.cloned(),
            input: input.clone(),
        };
        entries.push(entry.clone());
        Ok(entry)
    }
    async fn validate(&self) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
struct Sink;
impl SessionSink for Sink {
    fn emit(&self, _: &CloudEvent) -> Result<(), rootcause::Report> {
        Ok(())
    }
}
type ChoiceObservation = (String, Vec<String>, Vec<AgentSessionId>);

#[derive(Default)]
struct Choice {
    selected: Mutex<Option<String>>,
    failed: AtomicBool,
    calls: AtomicUsize,
    observed: Mutex<Vec<ChoiceObservation>>,
    hold: bool,
    entered: tokio::sync::Notify,
    release: tokio::sync::Notify,
}
#[async_trait::async_trait]
impl RepositoryDecision for Choice {
    async fn choose(
        &self,
        owner: &MacroUserIdStr<'static>,
        _: &str,
        candidates: &[String],
        recent: &[agent_session::domain::model::AgentSession],
    ) -> Result<Option<String>, rootcause::Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.observed.lock().unwrap().push((
            owner.to_string(),
            candidates.to_vec(),
            recent.iter().map(|session| session.id).collect(),
        ));
        self.entered.notify_one();
        if self.hold {
            self.release.notified().await;
        }
        if self.failed.load(Ordering::SeqCst) {
            return Err(rootcause::report!("injected model failure"));
        }
        Ok(self.selected.lock().unwrap().clone())
    }
}
fn environment(id: &str, url: &str, branch: &str) -> Environment {
    Environment {
        id: id.into(),
        label: Some(id.into()),
        repositories: vec![EnvironmentRepository {
            full_name: "org/repo".into(),
            clone_url: url.into(),
            default_branch: branch.into(),
        }],
    }
}
type Runtime = CodexRuntime<Provider, Sessions, agent_session::testing::InMemoryAgentSessionRepo>;
fn automatic(choice: Arc<Choice>) -> (Arc<Runtime>, Arc<Connections>, Arc<Provider>) {
    let connections = Arc::new(Connections::default());
    *connections.1.lock().unwrap() = Some((None, "ignored-explicit-branch".into()));
    let provider = Arc::new(Provider::default());
    *provider.1.lock().unwrap() = Some(vec![
        environment("env_a", "https://github.com/Org/Repo.git", "develop"),
        environment("env_b", "https://github.com/org/other", "main"),
    ]);
    provider.1.lock().unwrap().as_mut().unwrap()[0]
        .repositories
        .push(EnvironmentRepository {
            full_name: "org/secondary".into(),
            clone_url: "https://github.com/org/secondary".into(),
            default_branch: "secondary-branch".into(),
        });
    let mut runtime = runtime(
        "macro|chooser@example.com",
        connections.clone(),
        provider.clone(),
    );
    runtime.decision = choice;
    let mut current = agent_session::testing::test_agent_session(runtime.session);
    current.owner_id = runtime.owner.clone();
    runtime.history.insert_session(current);
    (Arc::new(runtime), connections, provider)
}
fn text() -> Vec<agent_client_protocol::schema::v1::ContentBlock> {
    vec![agent_client_protocol::schema::v1::ContentBlock::Text(
        agent_client_protocol::schema::v1::TextContent::new("fix the org/repo login button"),
    )]
}

#[tokio::test]
async fn first_prompt_selects_and_pins_target_using_owner_codex_repositories_and_recent_sessions() {
    let choice = Arc::new(Choice::default());
    *choice.selected.lock().unwrap() = Some("https://github.com/org/repo".into());
    let (runtime, connections, provider) = automatic(choice.clone());
    let prior = AgentSessionId::new();
    let mut recent = agent_session::testing::test_agent_session(prior);
    recent.owner_id = runtime.owner.clone();
    recent.repo_url = Some("https://github.com/org/repo".into());
    runtime.history.insert_session(recent);
    let journal = Journal::default();
    let service = SessionService::new(runtime.clone(), journal.clone(), None);
    let id = service.new_session().await.unwrap();
    assert_eq!(choice.calls.load(Ordering::SeqCst), 0);
    assert!(journal.load(&id).await.unwrap().unwrap().target.is_none());
    assert!(matches!(
        service.prompt(&id, text(), &Sink).await.unwrap(),
        Outcome::Completed
    ));
    let pinned = journal.load(&id).await.unwrap().unwrap().target.unwrap();
    assert_eq!(pinned.environment.as_str(), "env_a");
    assert_eq!(pinned.branch, "develop");
    assert_eq!(provider.2.lock().unwrap()[0].0, "env_a");
    assert_eq!(provider.2.lock().unwrap()[0].1, "develop");
    assert_eq!(
        runtime
            .history
            .get(runtime.session)
            .await
            .unwrap()
            .repo_url
            .as_deref(),
        Some("https://github.com/org/repo")
    );
    {
        let observed = choice.observed.lock().unwrap();
        assert_eq!(observed[0].0, runtime.owner.as_ref());
        assert_eq!(observed[0].2, vec![prior]);
        assert_eq!(
            observed[0].1,
            vec![
                "https://github.com/org/other",
                "https://github.com/org/repo"
            ]
        );
    }
    *connections.1.lock().unwrap() = Some((Some("env_b".into()), "release".into()));
    drop(service);
    let restarted = SessionService::new(runtime, journal.clone(), None);
    restarted.prompt(&id, text(), &Sink).await.unwrap();
    assert_eq!(choice.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        journal.load(&id).await.unwrap().unwrap().target.unwrap(),
        pinned
    );
}

#[tokio::test]
async fn no_selection_is_retryable_after_configuring_explicit_environment_in_same_session() {
    let choice = Arc::new(Choice::default());
    let (runtime, connections, provider) = automatic(choice.clone());
    let journal = Journal::default();
    let service = SessionService::new(runtime, journal.clone(), None);
    let id = service.new_session().await.unwrap();
    let error = service.prompt(&id, text(), &Sink).await.err().unwrap();
    assert!(error.to_string().contains("Harness settings"));
    let state = journal.load(&id).await.unwrap().unwrap();
    assert!(!state.uncertain_write);
    assert!(state.target.is_none());
    assert_eq!(journal.read(&id).await.unwrap().len(), 1);
    assert!(provider.2.lock().unwrap().is_empty());
    *connections.1.lock().unwrap() = Some((Some("env_b".into()), "release".into()));
    service.prompt(&id, text(), &Sink).await.unwrap();
    assert_eq!(choice.calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.2.lock().unwrap()[0].0, "env_b");
    assert_eq!(provider.2.lock().unwrap()[0].1, "release");
}

#[tokio::test]
async fn duplicate_repository_environments_reject_case_variants_without_guessing() {
    let choice = Arc::new(Choice::default());
    *choice.selected.lock().unwrap() = Some("https://github.com/org/repo".into());
    let (runtime, _, provider) = automatic(choice);
    provider
        .1
        .lock()
        .unwrap()
        .as_mut()
        .unwrap()
        .push(environment(
            "duplicate",
            "https://GITHUB.com/ORG/REPO.git",
            "main",
        ));
    let journal = Journal::default();
    let service = SessionService::new(runtime, journal.clone(), None);
    let id = service.new_session().await.unwrap();
    assert!(
        service
            .prompt(&id, text(), &Sink)
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("multiple Codex environments")
    );
    assert!(provider.2.lock().unwrap().is_empty());
    assert!(journal.load(&id).await.unwrap().unwrap().target.is_none());
}

#[tokio::test]
async fn cancellation_during_model_choice_never_launches_cloud_work() {
    let choice = Arc::new(Choice {
        hold: true,
        ..Choice::default()
    });
    *choice.selected.lock().unwrap() = Some("https://github.com/org/repo".into());
    let (runtime, _, provider) = automatic(choice.clone());
    let journal = Journal::default();
    let service = Arc::new(SessionService::new(runtime, journal.clone(), None));
    let id = service.new_session().await.unwrap();
    let running = {
        let service = service.clone();
        let id = id.clone();
        tokio::spawn(async move { service.prompt(&id, text(), &Sink).await })
    };
    choice.entered.notified().await;
    service.cancel(&id).await.unwrap();
    assert!(matches!(
        tokio::time::timeout(std::time::Duration::from_secs(1), running)
            .await
            .expect("Stop does not wait for the model")
            .unwrap()
            .unwrap(),
        Outcome::Cancelled
    ));
    assert!(provider.2.lock().unwrap().is_empty());
    assert!(!journal.load(&id).await.unwrap().unwrap().uncertain_write);
}

#[tokio::test]
async fn disconnect_during_model_choice_prevents_pinning_or_launch() {
    let choice = Arc::new(Choice {
        hold: true,
        ..Choice::default()
    });
    *choice.selected.lock().unwrap() = Some("https://github.com/org/repo".into());
    let (runtime, connections, provider) = automatic(choice.clone());
    let owner = runtime.owner.clone();
    let journal = Journal::default();
    let service = Arc::new(SessionService::new(runtime, journal.clone(), None));
    let id = service.new_session().await.unwrap();
    let running = {
        let service = service.clone();
        let id = id.clone();
        tokio::spawn(async move { service.prompt(&id, text(), &Sink).await })
    };
    choice.entered.notified().await;
    connections.disconnect(owner.as_ref()).await.unwrap();
    choice.release.notify_one();
    assert!(running.await.unwrap().is_err());
    let state = journal.load(&id).await.unwrap().unwrap();
    assert!(state.target.is_none());
    assert!(!state.uncertain_write);
    assert!(provider.2.lock().unwrap().is_empty());
}

#[test]
fn repository_identity_only_casefolds_github_and_strips_one_git_suffix() {
    assert_eq!(
        repository_identity("https://GitHub.com/ORG/Repo.git").unwrap(),
        "https://github.com/org/repo"
    );
    assert_eq!(
        repository_identity("https://github.com/org/repo.git.git").unwrap(),
        "https://github.com/org/repo.git"
    );
    assert_eq!(
        repository_identity("https://git.example.com/Org/Repo.git").unwrap(),
        "https://git.example.com/Org/Repo"
    );
}

#[tokio::test]
async fn model_errors_and_non_candidates_leave_the_unlaunched_session_retryable() {
    for (selected, failed) in [
        (Some("https://github.com/outsider/secret"), false),
        (None, true),
    ] {
        let choice = Arc::new(Choice::default());
        *choice.selected.lock().unwrap() = selected.map(str::to_owned);
        choice.failed.store(failed, Ordering::SeqCst);
        let (runtime, _, provider) = automatic(choice);
        let journal = Journal::default();
        let service = SessionService::new(runtime, journal.clone(), None);
        let id = service.new_session().await.unwrap();
        assert!(
            service
                .prompt(&id, text(), &Sink)
                .await
                .err()
                .unwrap()
                .to_string()
                .contains("Harness settings")
        );
        let state = journal.load(&id).await.unwrap().unwrap();
        assert!(state.target.is_none());
        assert!(!state.uncertain_write);
        assert_eq!(journal.read(&id).await.unwrap().len(), 1);
        assert!(provider.2.lock().unwrap().is_empty());
    }
}
