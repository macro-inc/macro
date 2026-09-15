use super::*;
use codex_cloud_agents::domain::EnvironmentRepository;
use codex_cloud_agents::domain::acp_session::{
    Outcome, SessionService, SessionSink, SessionStore, StoredSession,
};
use codex_cloud_agents::domain::cloud::CloudEvent;
use codex_cloud_agents::domain::journal::{JournalEntry, JournalInput};

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

fn text() -> Vec<agent_client_protocol::schema::v1::ContentBlock> {
    vec![agent_client_protocol::schema::v1::ContentBlock::Text(
        agent_client_protocol::schema::v1::TextContent::new("fix the org/repo login button"),
    )]
}
fn configured_runtime() -> (
    Arc<CodexRuntime<Provider, Sessions, agent_session::testing::InMemoryAgentSessionRepo>>,
    Arc<Connections>,
    Arc<Provider>,
) {
    let connections = Arc::new(Connections::default());
    *connections.1.lock().unwrap() = Some(None);
    let provider = Arc::new(Provider::default());
    *provider.1.lock().unwrap() = Some(vec![Environment {
        id: "env_a".into(),
        label: None,
        repositories: vec![EnvironmentRepository {
            full_name: "org/repo".into(),
            clone_url: "https://github.com/Org/Repo.git".into(),
            default_branch: "develop".into(),
        }],
    }]);
    let runtime = runtime(
        "macro|configured@example.com",
        connections.clone(),
        provider.clone(),
    );
    let mut current = agent_session::testing::test_agent_session(runtime.session);
    current.owner_id = runtime.owner.clone();
    runtime.session_repository.insert_session(current);
    (Arc::new(runtime), connections, provider)
}

#[tokio::test]
async fn explicit_configuration_is_required_even_when_prompt_names_available_repository() {
    let (runtime, connections, provider) = configured_runtime();
    let journal = Journal::default();
    let service = SessionService::new(runtime, journal.clone(), None);
    let id = service.new_session().await.unwrap();
    let error = service.prompt(&id, text(), &Sink).await.err().unwrap();
    assert!(
        error
            .to_string()
            .contains("select and save a Codex environment")
    );
    let state = journal.load(&id).await.unwrap().unwrap();
    assert!(state.target.is_none());
    assert!(!state.uncertain_write);
    assert_eq!(journal.read(&id).await.unwrap().len(), 1);
    assert!(provider.2.lock().unwrap().is_empty());
    *connections.1.lock().unwrap() = Some(Some("env_a".into()));
    assert!(matches!(
        service.prompt(&id, text(), &Sink).await.unwrap(),
        Outcome::Completed
    ));
    assert_eq!(provider.2.lock().unwrap()[0].0, "env_a");
    assert_eq!(provider.2.lock().unwrap()[0].1, "main");
}

#[tokio::test]
async fn configured_target_remains_pinned_across_settings_changes_and_restart() {
    let (runtime, connections, provider) = configured_runtime();
    *connections.1.lock().unwrap() = Some(Some("env_a".into()));
    let journal = Journal::default();
    let service = SessionService::new(runtime.clone(), journal.clone(), None);
    let id = service.new_session().await.unwrap();
    service.prompt(&id, text(), &Sink).await.unwrap();
    let pinned = journal.load(&id).await.unwrap().unwrap().target.unwrap();
    assert_eq!(pinned.environment.as_str(), "env_a");
    assert_eq!(pinned.branch, "main");
    assert_eq!(
        runtime
            .session_repository
            .get(runtime.session)
            .await
            .unwrap()
            .repo_url
            .as_deref(),
        Some("https://github.com/org/repo")
    );
    *connections.1.lock().unwrap() = Some(Some("other_environment".into()));
    drop(service);
    SessionService::new(runtime, journal.clone(), None)
        .prompt(&id, text(), &Sink)
        .await
        .unwrap();
    assert_eq!(
        journal.load(&id).await.unwrap().unwrap().target.unwrap(),
        pinned
    );
    assert_eq!(provider.2.lock().unwrap().len(), 1);
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
