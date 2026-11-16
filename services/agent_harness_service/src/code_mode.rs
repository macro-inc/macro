//! Composition of code execution credentials with the harness's owner approval gate.
use agent_code_mode::domain::{
    CodeModeError, ExecutionCredentials, ExecutionIdentity, IssuedRun, UserExecutionCredentials,
};
use agent_correlation::domain::{CorrelationRepository, SessionScope};
use agent_egress::outbound::macro_mcp::{MacroApiTokenSigner, SignedCorrelation};
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::{RunEnvironment, SdkEndpoints};
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct RunCredentials {
    pub signer: MacroApiTokenSigner,
    pub correlations: agent_correlation::outbound::PgCorrelationRepository,
    pub gate: Arc<dyn NativeToolGate>,
    pub endpoints: SdkEndpoints,
    pub scopes: Arc<dyn SessionScopes>,
}

/// Which narrower scope a session's code runs in, decided where its
/// credential is minted. Every service that accepts the credential refuses
/// requests outside it.
#[async_trait]
pub trait SessionScopes: Send + Sync + 'static {
    /// The scope of `session`'s code, if narrower than its person's access.
    async fn scope(&self, session: uuid::Uuid) -> Result<Option<SessionScope>, rootcause::Report>;
}

/// Suggestion generation sessions read, and write only through their own
/// tools and email drafts, until they are deleted: one whose turn ended but
/// is still being stopped, or whose delete was given up, keeps the scope. A
/// background run whose suggestion sends nothing reaches nobody.
pub struct HarnessScopes {
    pub generations: Arc<dyn suggestions::domain::ports::GenerationSessions>,
    pub runs: Arc<dyn suggestions::domain::ports::RunScopes>,
}

#[async_trait]
impl SessionScopes for HarnessScopes {
    async fn scope(&self, session: uuid::Uuid) -> Result<Option<SessionScope>, rootcause::Report> {
        if self.generations.undeleted(session).await? {
            return Ok(Some(SessionScope::Generation));
        }
        Ok(self
            .runs
            .sends_nothing(session)
            .await?
            .then_some(SessionScope::NoSend))
    }
}

/// The scope of `session`'s code; when it can't be told, no code runs.
async fn scope_of(
    scopes: &dyn SessionScopes,
    session: uuid::Uuid,
) -> Result<Option<SessionScope>, CodeModeError> {
    scopes.scope(session).await.map_err(|error| {
        tracing::error!(?error, "could not read a session's scope");
        CodeModeError::Unavailable
    })
}

/// Native tools a scoped session may call: code mode's, which reach the API
/// through its scoped credential, and finding and reading tools.
fn native_tool_allowed(scope: SessionScope, tool: &str) -> bool {
    match scope {
        SessionScope::Generation | SessionScope::NoSend => matches!(
            tool,
            "ExecuteCode"
                | "DescribeCodeTools"
                | "ReadCodeDocs"
                | "SearchTools"
                | "LoadTools"
                | "ReadToolResult"
        ),
    }
}

/// [`NativeToolGate`] that refuses a scoped session's native tools outside
/// its scope before asking `inner`.
pub struct ScopedToolGate {
    pub inner: Arc<dyn NativeToolGate>,
    pub scopes: Arc<dyn SessionScopes>,
}

impl NativeToolGate for ScopedToolGate {
    fn check<'a>(
        &'a self,
        session: agent_session::domain::model::AgentSessionId,
        tool: &'a str,
        arguments: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn Future<Output = NativeToolVerdict> + Send + 'a>> {
        Box::pin(async move {
            match self.scopes.scope(session.as_uuid()).await {
                Ok(Some(scope)) if !native_tool_allowed(scope, tool) => NativeToolVerdict::Refuse(
                    format!("This session can't use {tool}; it works through code only."),
                ),
                Ok(_) => self.inner.check(session, tool, arguments).await,
                Err(error) => {
                    tracing::error!(?error, "could not read a session's scope");
                    NativeToolVerdict::Refuse(
                        "Whether this tool may run could not be checked; nothing was done."
                            .to_owned(),
                    )
                }
            }
        })
    }
}

#[async_trait]
impl ExecutionCredentials for RunCredentials {
    async fn issue(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        cancel: CancellationToken,
    ) -> Result<IssuedRun, CodeModeError> {
        let actor = approve_run(self.gate.as_ref(), identity, source, &cancel).await?;
        let scope = scope_of(self.scopes.as_ref(), identity.session.as_uuid()).await?;
        let correlation = self
            .correlations
            .create(
                identity.session.as_uuid(),
                identity.agent_id.as_uuid(),
                scope,
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not persist code-mode correlation");
                CodeModeError::Unavailable
            })?;
        // No refresh credential. Covers the 30-second queue/run deadline plus
        // clock margin; a normal user token expires rather than revoking on exit.
        let token = self
            .signer
            .mint_for_agent(
                &actor,
                60,
                Some(identity.agent_id.as_uuid()),
                None,
                None,
                Some(SignedCorrelation {
                    id: correlation,
                    scope,
                }),
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        Ok(IssuedRun {
            environment: RunEnvironment {
                token,
                trace_headers: trace_headers(),
                endpoints: self.endpoints.clone(),
                session_id: Some(identity.session.as_uuid()),
                execution_id: Some(identity.execution.as_uuid()),
                unattended: None,
            },
            acting_user: actor,
        })
    }
}

/// Credentials for public MCP runs: the signed-in user, with no session, and
/// the agent the run's posts are attributed to: an agent caller (a self-hosted
/// agent's call through egress) as itself, any other caller as the Macro bot,
/// labelled with the MCP client's name - the same attribution the direct MCP
/// tools give. The MCP client asks the user before each tool call, so there is
/// no owner gate.
pub struct UserRunCredentials {
    pub signer: MacroApiTokenSigner,
    pub correlations: agent_correlation::outbound::PgCorrelationRepository,
    pub endpoints: SdkEndpoints,
    pub scopes: Arc<dyn SessionScopes>,
}

#[async_trait]
impl UserExecutionCredentials for UserRunCredentials {
    async fn issue(
        &self,
        user: &MacroUserIdStr<'static>,
        caller: &ai_toolset::ToolCaller,
        session: Option<uuid::Uuid>,
    ) -> Result<RunEnvironment, CodeModeError> {
        let agent = match caller {
            ai_toolset::ToolCaller::Agent(agent) => *agent,
            ai_toolset::ToolCaller::McpClient { .. } | ai_toolset::ToolCaller::ApiKey => {
                bot_id::MACRO_AI_BOT_ID
            }
        };
        let correlation = match session {
            Some(session) => {
                let scope = scope_of(self.scopes.as_ref(), session).await?;
                let id = self
                    .correlations
                    .create(session, agent.as_uuid(), scope)
                    .await
                    .map_err(|error| {
                        tracing::error!(?error, "could not persist code-mode correlation");
                        CodeModeError::Unavailable
                    })?;
                Some(SignedCorrelation { id, scope })
            }
            None => None,
        };
        // Same lifetime as session runs: the 30-second deadline plus clock margin.
        let token = self
            .signer
            .mint_for_agent(
                user,
                60,
                Some(agent.as_uuid()),
                caller.via().map(str::to_owned),
                None,
                correlation,
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not mint execution credential");
                CodeModeError::Unavailable
            })?;
        Ok(RunEnvironment {
            token,
            trace_headers: trace_headers(),
            endpoints: self.endpoints.clone(),
            session_id: None,
            execution_id: None,
            unattended: None,
        })
    }
}

/// The current trace context, for the SDK to forward on authenticated requests.
pub(crate) fn trace_headers() -> BTreeMap<String, String> {
    let mut headers = axum::http::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    headers
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_owned()))
        })
        .collect()
}

macro_env_var::env_var! { struct DocumentStorageServiceCloudfrontDistributionUrl; }

/// A host code mode's SDK reaches, named as the SDK names it. The test
/// `every_sdk_host_holds_a_scoped_credential_to_its_scope` says how each
/// host's service holds a scoped session's credential to its scope, and fails
/// for a host the SDK can reach that is missing here.
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, strum::EnumIter, strum::EnumString, strum::IntoStaticStr,
)]
#[strum(serialize_all = "kebab-case")]
enum SdkHost {
    DocumentContent,
    StaticContent,
    EditingWorker,
    Storage,
    Search,
    Properties,
    Auth,
    AgentHarness,
    Email,
    Calendar,
    Cognition,
    Notification,
    ScheduledAction,
    StaticFiles,
    Connection,
    Contacts,
    Unfurl,
}

impl SdkHost {
    /// Its base URL in this environment.
    fn url(self) -> anyhow::Result<String> {
        use macro_service_urls::*;
        Ok(match self {
            Self::DocumentContent => {
                DocumentStorageServiceCloudfrontDistributionUrl::new()?.to_string()
            }
            Self::StaticContent => StaticFilePublicUrl::new()?.to_string(),
            Self::EditingWorker => AiEditingWorkerUrl::new()?.to_string(),
            Self::Storage | Self::Search | Self::Properties => {
                DocumentStorageServiceUrl::new()?.to_string()
            }
            Self::Auth => AuthServiceUrl::new()?.to_string(),
            Self::AgentHarness => AgentHarnessServiceUrl::new()?.to_string(),
            Self::Email => EmailServiceUrl::new()?.to_string(),
            Self::Calendar => CalendarServiceUrl::new()?.to_string(),
            Self::Cognition => DocumentCognitionServiceUrl::new()?.to_string(),
            Self::Notification => NotificationServiceUrl::new()?.to_string(),
            Self::ScheduledAction => ScheduledActionServiceUrl::new()?.to_string(),
            Self::StaticFiles => StaticFileServiceUrl::new()?.to_string(),
            Self::Connection => ConnectionGatewayUrl::new()?.to_string(),
            Self::Contacts => ContactsServiceUrl::new()?.to_string(),
            Self::Unfurl => UnfurlServiceUrl::new()?.to_string(),
        })
    }
}

pub fn sdk_endpoints() -> anyhow::Result<SdkEndpoints> {
    use strum::IntoEnumIterator;
    let hosts = SdkHost::iter()
        .map(|host| Ok((<&'static str>::from(host).to_owned(), host.url()?)))
        .collect::<anyhow::Result<_>>()?;
    Ok(SdkEndpoints {
        hosts,
        web_app_url: macro_service_urls::AppServiceUrl::new()?.to_string(),
    })
}

pub mod connected_apps;
pub mod images;
pub mod reviews;
pub mod ui_commands;

async fn approve_run(
    gate: &dyn NativeToolGate,
    identity: &ExecutionIdentity,
    source: &str,
    cancel: &CancellationToken,
) -> Result<macro_user_id::user_id::MacroUserIdStr<'static>, CodeModeError> {
    let args = serde_json::json!({"source": source, "acting_as": identity.acting_as, "turn_id": identity.turn});
    let verdict = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(CodeModeError::Forbidden),
        verdict = async { gate.check(identity.session, "ExecuteCode", &args).await } => verdict,
    };
    match verdict {
        NativeToolVerdict::Run => Err(CodeModeError::Forbidden),
        NativeToolVerdict::RunAs(actor) => Ok(actor),
        NativeToolVerdict::Refuse(message) => Err(CodeModeError::Invalid(message)),
    }
}
#[cfg(test)]
mod test;
