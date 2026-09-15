use super::*;
use codex_cloud_agents::domain::cloud::{CloudTasks, TurnSnapshot};
use codex_cloud_agents::domain::{DeviceLogin, Environment, LoginPoll, Secret};
use codex_connection::domain::{
    ConnectionError, ConnectionStatus, LoginStatus, ResolvedConnection, StartedLogin,
};
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
struct Connections(
    Mutex<HashMap<String, (String, String)>>,
    Mutex<Option<Option<String>>>,
);
#[async_trait::async_trait]
impl ConnectionService for Connections {
    async fn resolve(&self, owner: &str) -> Result<ResolvedConnection, ConnectionError> {
        let rows = self.0.lock().unwrap();
        let (connection, account) = rows.get(owner).ok_or(ConnectionError::NotConnected)?;
        let environment = self
            .1
            .lock()
            .unwrap()
            .clone()
            .unwrap_or(Some("env_owner".into()));
        Ok(ResolvedConnection {
            connection_id: connection.parse().unwrap(),
            credentials: Credentials {
                version: 1,
                access_token: Secret::new(account.clone()).unwrap(),
                refresh_token: Secret::new("refresh".into()).unwrap(),
                expires_at: u64::MAX,
                account_id: account.clone(),
            },
            environment_id: environment.map(|id| CloudId::new(id).unwrap()),
        })
    }
    async fn status(&self, _: &str) -> Result<ConnectionStatus, ConnectionError> {
        unimplemented!()
    }
    async fn start_login(&self, _: &str) -> Result<StartedLogin, ConnectionError> {
        unimplemented!()
    }
    async fn poll_login(&self, _: &str, _: uuid::Uuid) -> Result<LoginStatus, ConnectionError> {
        unimplemented!()
    }
    async fn cancel_login(&self, _: &str, _: uuid::Uuid) -> Result<(), ConnectionError> {
        unimplemented!()
    }
    async fn disconnect(&self, owner: &str) -> Result<(), ConnectionError> {
        self.0.lock().unwrap().remove(owner);
        Ok(())
    }
    async fn environments(&self, _: &str) -> Result<Vec<Environment>, ConnectionError> {
        unimplemented!()
    }
    async fn configure(&self, _: &str, _: &str) -> Result<ConnectionStatus, ConnectionError> {
        unimplemented!()
    }
}
#[derive(Default, Clone)]
struct Sessions(Arc<Mutex<HashMap<AgentSessionId, ExternalSession>>>);
impl ExternalSessionRepo for Sessions {
    async fn upsert(
        &self,
        id: AgentSessionId,
        external: ExternalSession,
    ) -> agent_session::domain::error::Result<()> {
        self.0.lock().unwrap().insert(id, external);
        Ok(())
    }
    async fn get(
        &self,
        id: AgentSessionId,
    ) -> agent_session::domain::error::Result<Option<ExternalSession>> {
        Ok(self.0.lock().unwrap().get(&id).cloned())
    }
    async fn delete(&self, id: AgentSessionId) -> agent_session::domain::error::Result<()> {
        self.0.lock().unwrap().remove(&id);
        Ok(())
    }
}
#[derive(Default)]
struct Provider(
    Mutex<Vec<String>>,
    Mutex<Option<Vec<Environment>>>,
    Mutex<Vec<(String, String, String)>>,
);
impl OAuth for Provider {
    async fn begin(&self) -> Result<DeviceLogin, rootcause::Report> {
        unimplemented!()
    }
    async fn poll(&self, _: &DeviceLogin) -> Result<LoginPoll, rootcause::Report> {
        unimplemented!()
    }
    async fn refresh(&self, _: &Credentials) -> Result<Credentials, rootcause::Report> {
        unimplemented!()
    }
    async fn environments(&self, _: &Credentials) -> Result<Vec<Environment>, rootcause::Report> {
        if let Some(environments) = self.1.lock().unwrap().clone() {
            return Ok(environments);
        }
        Ok(vec![Environment {
            id: "env_owner".into(),
            label: None,
            repositories: vec![],
        }])
    }
}
impl CloudTasks for Provider {
    async fn create(
        &self,
        auth: &Credentials,
        request: &Launch,
    ) -> Result<CreatedTask, rootcause::Report> {
        self.2.lock().unwrap().push((
            request.environment.as_str().into(),
            request.branch.clone(),
            request.prompt.clone(),
        ));
        self.0.lock().unwrap().push(auth.account_id.clone());
        Ok(CreatedTask {
            task_id: CloudId::new("task_owner".into())?,
            assistant_turn_id: Some(TurnId::new("turn_owner".into())?),
            url: "https://chatgpt.com/codex/tasks/task_owner".into(),
        })
    }
    async fn snapshot(
        &self,
        _: &Credentials,
        task: &CloudId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        Ok(TaskSnapshot {
            task_id: task.clone(),
            native: None,
            pull_requests: vec![],
            title: None,
            assistant_status: Some("completed".into()),
            turns: Vec::<TurnSnapshot>::new(),
        })
    }
}
impl CloudConversation for Provider {
    async fn follow_up(
        &self,
        auth: &Credentials,
        task: &CloudId,
        _: &TurnId,
        _: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        self.0
            .lock()
            .unwrap()
            .push(format!("followup:{}", auth.account_id));
        Ok(CreatedTask {
            task_id: task.clone(),
            assistant_turn_id: Some(TurnId::new("turn_owner".into())?),
            url: "https://chatgpt.com/codex/tasks/task_owner".into(),
        })
    }
    async fn cancel(&self, auth: &Credentials, _: &CloudId) -> Result<(), rootcause::Report> {
        self.0
            .lock()
            .unwrap()
            .push(format!("cancel:{}", auth.account_id));
        Ok(())
    }
    async fn turn(
        &self,
        auth: &Credentials,
        task: &CloudId,
        _: &TurnId,
    ) -> Result<TaskSnapshot, rootcause::Report> {
        self.snapshot(auth, task).await
    }
    async fn stream(
        &self,
        _: &Credentials,
        _: &CloudId,
        _: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        Ok(Box::pin(futures::stream::empty()))
    }
}
fn runtime(
    owner: &str,
    connections: Arc<Connections>,
    provider: Arc<Provider>,
) -> CodexRuntime<Provider, Sessions, agent_session::testing::InMemoryAgentSessionRepo> {
    let connection = uuid::Uuid::now_v7().to_string();
    connections
        .0
        .lock()
        .unwrap()
        .insert(owner.into(), (connection.clone(), owner.into()));
    CodexRuntime {
        provider,
        connections,
        owner: MacroUserIdStr::try_from(owner.to_owned()).unwrap(),
        binding: RuntimeIdentity {
            connection_id: connection,
            account_id: owner.into(),
        },
        session: AgentSessionId::new(),
        sessions: Sessions::default(),
        session_repository: agent_session::testing::InMemoryAgentSessionRepo::default(),
        pull_requests: None,
        claim: Arc::new(std::sync::OnceLock::new()),
    }
}
fn launch() -> Launch {
    Launch {
        environment: CloudId::new("env_owner".into()).unwrap(),
        branch: "main".into(),
        prompt: "inspect".into(),
    }
}
#[tokio::test]
async fn owners_use_only_their_credentials_and_record_mapping_before_return() {
    let connections = Arc::new(Connections::default());
    let provider = Arc::new(Provider::default());
    let a = runtime("macro|a@example.com", connections.clone(), provider.clone());
    let b = runtime("macro|b@example.com", connections, provider.clone());
    a.launch(&launch()).await.unwrap();
    b.launch(&launch()).await.unwrap();
    assert_eq!(
        *provider.0.lock().unwrap(),
        ["macro|a@example.com", "macro|b@example.com"]
    );
    assert_eq!(
        a.sessions.get(a.session).await.unwrap().unwrap().provider,
        CODEX_PROVIDER
    );
}
#[tokio::test]
async fn disconnect_and_reconnect_cannot_retarget_existing_session() {
    let connections = Arc::new(Connections::default());
    let provider = Arc::new(Provider::default());
    let old = runtime("macro|a@example.com", connections.clone(), provider.clone());
    connections.disconnect(old.owner.as_ref()).await.unwrap();
    assert!(old.launch(&launch()).await.is_err());
    let _new = runtime(old.owner.as_ref(), connections, provider.clone());
    assert!(
        old.cancel(&CloudId::new("task_owner".into()).unwrap())
            .await
            .is_err()
    );
    assert!(provider.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn launch_rechecks_environment_visibility() {
    let connections = Arc::new(Connections::default());
    let provider = Arc::new(Provider::default());
    let runtime = runtime("macro|a@example.com", connections, provider.clone());
    let mut request = launch();
    request.environment = CloudId::new("env_foreign".into()).unwrap();
    assert!(runtime.launch(&request).await.is_err());
    assert!(provider.0.lock().unwrap().is_empty());
}

mod selection;

#[derive(Default)]
struct PullRequests(
    Mutex<
        Vec<(
            AgentSessionId,
            String,
            String,
            agent_session::domain::model::SessionClaim,
        )>,
    >,
);
impl agent_session::domain::pull_request::SessionPullRequests for PullRequests {
    fn set_pull_request<'a>(
        &'a self,
        session: AgentSessionId,
        owner: &'a MacroUserIdStr<'static>,
        url: &'a str,
        claim: Option<agent_session::domain::model::SessionClaim>,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = agent_session::domain::error::Result<String>> + Send + 'a>,
    > {
        Box::pin(async move {
            self.0.lock().unwrap().push((
                session,
                owner.to_string(),
                url.to_owned(),
                claim.expect("Codex publication requires the activated fence"),
            ));
            Ok(url.into())
        })
    }
}
#[tokio::test]
async fn pr_publication_passes_the_activated_claim_and_rejects_disconnected_owner() {
    use agent_session::domain::model::{ManagerFence, ReplicaId, SessionClaim};
    let connections = Arc::new(Connections::default());
    let mut runtime = runtime(
        "macro|pr@example.com",
        connections.clone(),
        Arc::new(Provider::default()),
    );
    let reporter = Arc::new(PullRequests::default());
    runtime.pull_requests = Some(reporter.clone());
    let url = "https://github.com/org/repo/pull/42";
    assert!(runtime.report_pull_request(url).await.is_err());
    assert!(reporter.0.lock().unwrap().is_empty());
    let claim = SessionClaim {
        session: runtime.session,
        replica: ReplicaId::from_uuid(uuid::Uuid::from_u128(2)),
        fence: ManagerFence(7),
    };
    runtime.claim.set(claim).unwrap();
    runtime.report_pull_request(url).await.unwrap();
    {
        let calls = reporter.0.lock().unwrap();
        assert_eq!(calls[0].0, runtime.session);
        assert_eq!(calls[0].1, runtime.owner.as_ref());
        assert_eq!(calls[0].2, url);
        assert_eq!(calls[0].3.session, claim.session);
        assert_eq!(calls[0].3.replica, claim.replica);
        assert_eq!(calls[0].3.fence, claim.fence);
    }
    connections
        .disconnect(runtime.owner.as_ref())
        .await
        .unwrap();
    assert!(runtime.report_pull_request(url).await.is_err());
    assert_eq!(reporter.0.lock().unwrap().len(), 1);
}
