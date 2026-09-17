use super::*;
use agent_session::domain::{
    model::{AgentMcpServers, CreateAgentSessionParams, SandboxSize},
    ports::MockExternalSessionRepo,
};
use agent_session::testing::InMemoryAgentSessionRepo;
use claude_cloud_agents::domain::{
    model::Event,
    ports::{Cloud, Events},
};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Default)]
struct Provider {
    calls: Arc<Mutex<Vec<(String, String)>>>,
    uncertain: bool,
}
#[derive(Clone)]
struct Client {
    owner: String,
    calls: Arc<Mutex<Vec<(String, String)>>>,
    uncertain: bool,
}
impl CloudProvider for Provider {
    type Client = Client;
    async fn connect(&self, owner: &str) -> claude_cloud_agents::domain::model::Result<Client> {
        Ok(Client {
            owner: owner.into(),
            calls: self.calls.clone(),
            uncertain: self.uncertain,
        })
    }
}
impl CloudLifecycle for Client {
    async fn create(
        &self,
        instructions: &str,
    ) -> claude_cloud_agents::domain::model::Result<SessionId> {
        self.calls
            .lock()
            .unwrap()
            .push((self.owner.clone(), instructions.into()));
        if self.uncertain {
            return Err(Error::UncertainCreate);
        }
        SessionId::parse(&format!("cse_{}", self.calls.lock().unwrap().len()))
    }
    async fn archive(&self, _: &SessionId) -> claude_cloud_agents::domain::model::Result<()> {
        Ok(())
    }
}
impl Cloud for Client {
    async fn recent_sessions(&self) -> claude_cloud_agents::domain::model::Result<Vec<SessionId>> {
        Ok(vec![])
    }
    async fn history(
        &self,
        _: &SessionId,
    ) -> claude_cloud_agents::domain::model::Result<Vec<Event>> {
        Ok(vec![])
    }
    async fn send(
        &self,
        _: &SessionId,
        _: serde_json::Value,
    ) -> claude_cloud_agents::domain::model::Result<()> {
        unreachable!()
    }
    async fn send_batch(
        &self,
        _: &SessionId,
        _: Vec<serde_json::Value>,
    ) -> claude_cloud_agents::domain::model::Result<()> {
        unreachable!()
    }
    async fn stream(
        &self,
        _: &SessionId,
        _: Option<u64>,
    ) -> claude_cloud_agents::domain::model::Result<Events> {
        unreachable!()
    }
}

fn mappings() -> MockExternalSessionRepo {
    let data = Arc::new(Mutex::new(HashMap::<AgentSessionId, ExternalSession>::new()));
    let mut repo = MockExternalSessionRepo::new();
    let records = data.clone();
    repo.expect_get().returning(move |id| {
        let found = records.lock().unwrap().get(&id).cloned();
        Box::pin(async move { Ok(found) })
    });
    let records = data.clone();
    repo.expect_upsert().returning(move |id, external| {
        records.lock().unwrap().insert(id, external);
        Box::pin(async { Ok(()) })
    });
    repo.expect_delete().returning(move |id| {
        data.lock().unwrap().remove(&id);
        Box::pin(async { Ok(()) })
    });
    repo
}

async fn seed(
    repo: &InMemoryAgentSessionRepo,
    bot: bot_id::BotId,
    owner: &str,
    instructions: &str,
) -> AgentSessionId {
    let id = AgentSessionId::new();
    repo.create(CreateAgentSessionParams {
        id,
        bot_id: bot,
        owner_id: macro_user_id::user_id::MacroUserIdStr::try_from(owner.to_owned()).unwrap(),
        thread_id: None,
        originating_message_id: None,
        model: "claude-default".into(),
        harness: "claude-cloud".into(),
        repo_url: None,
        workspace: "/".into(),
        sandbox_size: SandboxSize::Default,
        instructions: Some(instructions.into()),
        mcp_servers: AgentMcpServers::OwnerConnections,
        egress_token_hash: None,
    })
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn distinct_agents_keep_their_owner_instructions_model_and_remote_session() {
    let repo = InMemoryAgentSessionRepo::new();
    let first = seed(
        &repo,
        bot_id::BotId::TEST_A,
        "macro|one@example.com",
        "Review code",
    )
    .await;
    let second = seed(
        &repo,
        bot_id::BotId::TEST_B,
        "macro|two@example.com",
        "Fix tests",
    )
    .await;
    let provider = Arc::new(Provider::default());
    let sessions = ClaudeSessions::new(provider.clone(), repo, mappings());
    let one = sessions.attach(first).await.unwrap();
    let two = sessions.attach(second).await.unwrap();
    assert_ne!(one.id(), two.id());
    assert_eq!(one.model().await.id(), "claude-default");
    assert_eq!(sessions.attach(first).await.unwrap().id(), one.id());
    assert_eq!(
        *provider.calls.lock().unwrap(),
        vec![
            ("macro|one@example.com".into(), "Review code".into()),
            ("macro|two@example.com".into(), "Fix tests".into()),
        ]
    );
}

#[tokio::test]
async fn uncertain_create_remains_pending_and_is_never_retried() {
    let repo = InMemoryAgentSessionRepo::new();
    let id = seed(
        &repo,
        bot_id::BotId::TEST_A,
        "macro|one@example.com",
        "Review code",
    )
    .await;
    let provider = Arc::new(Provider {
        uncertain: true,
        ..Default::default()
    });
    let sessions = ClaudeSessions::new(provider.clone(), repo, mappings());
    assert!(sessions.attach(id).await.is_err());
    assert!(sessions.attach(id).await.is_err());
    assert_eq!(provider.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn reattach_restores_egress_with_the_saved_agent_selection() {
    use crate::testing::helpers::egress::EgressProvisionerMock;
    let repo = InMemoryAgentSessionRepo::new();
    let id = seed(
        &repo,
        bot_id::BotId::TEST_A,
        "macro|one@example.com",
        "Review code",
    )
    .await;
    let sessions = ClaudeSessions::new(Arc::new(Provider::default()), repo.clone(), mappings());
    let egress = EgressProvisionerMock::default();
    let token = sessions.refresh_egress(id, &egress).await.unwrap();
    assert_eq!(token, "test-session-token");
    assert_eq!(
        egress.provisioned(),
        vec![(
            id,
            "macro|one@example.com".into(),
            AgentMcpServers::OwnerConnections
        )]
    );
    assert!(
        repo.find_by_egress_token_hash("test-token-hash")
            .await
            .unwrap()
            .is_some()
    );
}
