//! Composition-root wiring for the demo Claude cloud provider.
use agent_harness::domain::{
    error::{HarnessError, Result},
    model::{AgentKind, SpawnContainer},
    ports::ContainerManager,
    sandbox::SandboxResizeEffect,
};
use agent_runtime_protocol::domain::{
    connection::ServerChannel,
    ports::{Transport, TransportError, TransportReceiver, TransportSender},
    schema::v0::{ToRuntimeMessage, ToServerMessage},
};
use agent_session::domain::{
    connection::RuntimeAttachment,
    model::{AgentSessionId, ExternalSession, SandboxSize},
    ports::{AgentSessionRepo, ExternalSessionRepo},
};
use claude_cloud_agents::{
    domain::{
        model::{Error, SessionId},
        service::Session,
    },
    inbound::acp,
    outbound::{credentials::FileCredentials, http::Client},
};
use std::sync::Arc;

const PROVIDER: &str = "claude-cloud";
const PENDING: &str = "claude-cloud-create-pending";

pub struct ClaudeModels(pub Option<FileCredentials>);
impl agent_harness::domain::model_load::ClaudeModelProbe for ClaudeModels {
    fn probe<'a>(
        &'a self,
        caller: &'a macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = std::result::Result<
                        agent_harness::domain::model_load::RawModelProbe,
                        agent_harness::domain::model_load::ModelProbeError,
                    >,
                > + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            use agent_harness::domain::model_load::{ModelProbeError, RawModelProbe};
            let Some(credentials) = &self.0 else {
                return Ok(RawModelProbe::Unsupported);
            };
            if !credentials.contains(caller.as_ref()).await {
                return Ok(RawModelProbe::Unsupported);
            }
            let client = Client::new(credentials.clone(), caller.as_ref().to_owned())
                .await
                .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
            let catalog = claude_cloud_agents::domain::models::discover(&client)
                .await
                .map_err(|error| ModelProbeError::Failed(error.to_string()))?;
            let options = serde_json::from_value(acp::model_options(&catalog, &Default::default()))
                .map_err(|_| {
                    ModelProbeError::Failed("Invalid Claude model configuration".into())
                })?;
            Ok(RawModelProbe::Options(options))
        })
    }
}

/// Routes Claude sessions to Anthropic and all other sessions to the existing providers.
pub struct WithClaude<Base, Repo> {
    base: Base,
    repo: Repo,
    credentials: Option<FileCredentials>,
    creation: Arc<tokio::sync::Mutex<()>>,
}
impl<Base, Repo> WithClaude<Base, Repo> {
    pub fn new(base: Base, repo: Repo, credentials: Option<FileCredentials>) -> Self {
        Self {
            base,
            repo,
            credentials,
            creation: Arc::new(tokio::sync::Mutex::new(())),
        }
    }
}
fn cloud_error(error: Error) -> HarnessError {
    HarnessError::Container(error.to_string())
}

impl<Base, Repo> WithClaude<Base, Repo>
where
    Repo: AgentSessionRepo + ExternalSessionRepo + Clone,
    Base: ContainerManager,
{
    async fn is_claude(&self, id: AgentSessionId) -> Result<bool> {
        let row = AgentSessionRepo::get(&self.repo, id).await?;
        Ok(AgentKind::for_session(row.bot_id, &row.harness) == AgentKind::ClaudeCloud)
    }

    async fn attach(&self, id: AgentSessionId) -> Result<RuntimeAttachment<ServerChannel>> {
        let _creation = self.creation.lock().await;
        let row = AgentSessionRepo::get(&self.repo, id).await?;
        let credentials = self
            .credentials
            .clone()
            .ok_or_else(|| cloud_error(Error::NotConnected))?;
        let client = Client::new(credentials, row.owner_id.as_ref().to_owned())
            .await
            .map_err(cloud_error)?;
        let external = ExternalSessionRepo::get(&self.repo, id).await?;
        let cloud_id = match external {
            Some(mut external) if external.provider == PROVIDER => {
                let cloud_id = SessionId::parse(&external.external_id).map_err(cloud_error)?;
                if external.external_url.is_none() {
                    external.external_url = Some(cloud_id.web_url());
                    self.repo.upsert(id, external).await?;
                }
                cloud_id
            }
            Some(_) => return Err(cloud_error(Error::UncertainCreate)),
            None => {
                // Write a durable intent before the non-idempotent POST. A crash or
                // timeout stays visibly pending rather than minting a duplicate VM.
                self.repo
                    .upsert(
                        id,
                        ExternalSession {
                            provider: PENDING.into(),
                            external_id: id.to_string(),
                            external_name: None,
                            external_url: None,
                            last_run_id: None,
                        },
                    )
                    .await?;
                let cloud_id = match client
                    .create(row.instructions.as_deref().unwrap_or_default())
                    .await
                {
                    Ok(id) => id,
                    Err(error) => {
                        // Only a definite client rejection is safe to retry as a new create.
                        if matches!(
                            error,
                            Error::Authorization | Error::NotConnected | Error::Http(400..=499)
                        ) {
                            ExternalSessionRepo::delete(&self.repo, id).await?;
                        }
                        return Err(cloud_error(error));
                    }
                };
                self.repo
                    .upsert(
                        id,
                        ExternalSession {
                            provider: PROVIDER.into(),
                            external_id: cloud_id.as_str().to_owned(),
                            external_name: Some("Claude Cloud demo".into()),
                            external_url: Some(cloud_id.web_url()),
                            last_run_id: None,
                        },
                    )
                    .await?;
                cloud_id
            }
        };
        Ok(RuntimeAttachment::solo(acp::attach(Session::with_model(
            client,
            cloud_id,
            claude_cloud_agents::domain::models::Model::parse(&row.model).map_err(cloud_error)?,
        ))))
    }
}

impl<Base, Repo> ContainerManager for WithClaude<Base, Repo>
where
    Base: ContainerManager,
    Repo: AgentSessionRepo + ExternalSessionRepo + Clone,
{
    type Transport = CloudTransport<Base::Transport>;
    async fn spawn(&self, command: SpawnContainer) -> Result<RuntimeAttachment<Self::Transport>> {
        if command.kind == AgentKind::ClaudeCloud {
            self.attach(command.session_id)
                .await
                .map(|a| a.map_transport(CloudTransport::Claude))
        } else {
            self.base
                .spawn(command)
                .await
                .map(|a| a.map_transport(CloudTransport::Other))
        }
    }
    async fn resume(&self, id: AgentSessionId) -> Result<RuntimeAttachment<Self::Transport>> {
        if self.is_claude(id).await? {
            self.attach(id)
                .await
                .map(|a| a.map_transport(CloudTransport::Claude))
        } else {
            self.base
                .resume(id)
                .await
                .map(|a| a.map_transport(CloudTransport::Other))
        }
    }
    async fn session_token(&self, id: AgentSessionId) -> Result<Option<String>> {
        if self.is_claude(id).await? {
            Ok(None)
        } else {
            self.base.session_token(id).await
        }
    }
    async fn teardown(&self, id: AgentSessionId) -> Result<()> {
        if !self.is_claude(id).await? {
            return self.base.teardown(id).await;
        }
        let Some(external) = ExternalSessionRepo::get(&self.repo, id).await? else {
            return Ok(());
        };
        if external.provider != PROVIDER {
            return Err(cloud_error(Error::UncertainCreate));
        }
        let row = AgentSessionRepo::get(&self.repo, id).await?;
        let credentials = self
            .credentials
            .clone()
            .ok_or_else(|| cloud_error(Error::NotConnected))?;
        Client::new(credentials, row.owner_id.as_ref().to_owned())
            .await
            .map_err(cloud_error)?
            .archive(&SessionId::parse(&external.external_id).map_err(cloud_error)?)
            .await
            .map_err(cloud_error)?;
        ExternalSessionRepo::delete(&self.repo, id).await?;
        Ok(())
    }
    fn resize_effect(&self, from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
        self.base.resize_effect(from, to)
    }
    async fn resize(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        if self.is_claude(id).await? {
            return Err(HarnessError::Container(
                "Claude manages its own cloud compute".into(),
            ));
        }
        self.base.resize(id, size).await
    }
}

pub enum CloudTransport<Base> {
    Other(Base),
    Claude(ServerChannel),
}
pub enum CloudSender<Base> {
    Other(Base),
    Claude(tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>),
}
pub enum CloudReceiver<Base> {
    Other(Base),
    Claude(tokio::sync::mpsc::UnboundedReceiver<ToServerMessage>),
}
impl<Base: Transport<ToRuntimeMessage, ToServerMessage>>
    Transport<ToRuntimeMessage, ToServerMessage> for CloudTransport<Base>
{
    type Sender = CloudSender<Base::Sender>;
    type Receiver = CloudReceiver<Base::Receiver>;
    fn split(self) -> (Self::Sender, Self::Receiver) {
        match self {
            Self::Other(base) => {
                let (tx, rx) = base.split();
                (CloudSender::Other(tx), CloudReceiver::Other(rx))
            }
            Self::Claude(channel) => (
                CloudSender::Claude(channel.tx),
                CloudReceiver::Claude(channel.rx),
            ),
        }
    }
}
impl<Base: TransportSender<ToRuntimeMessage>> TransportSender<ToRuntimeMessage>
    for CloudSender<Base>
{
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        match self {
            Self::Other(base) => base.send(message).await,
            Self::Claude(tx) => TransportSender::send(tx, message).await,
        }
    }
}
impl<Base: TransportReceiver<ToServerMessage>> TransportReceiver<ToServerMessage>
    for CloudReceiver<Base>
{
    async fn recv(&mut self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        match self {
            Self::Other(base) => base.recv().await,
            Self::Claude(rx) => Ok(rx.recv().await),
        }
    }
}
