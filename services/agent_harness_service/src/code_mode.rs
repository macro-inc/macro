//! Composition of code execution credentials with the harness's owner approval gate.
use agent_code_mode::domain::{
    CodeModeError, ExecutionCredentials, ExecutionIdentity, IssuedRun, UserExecutionCredentials,
};
use agent_correlation::domain::{CorrelationRepository, SessionScope};
use agent_egress::outbound::macro_mcp::{MacroApiTokenSigner, SignedCorrelation};
use agent_inmem::domain::tool_gate::{NativeToolGate, NativeToolVerdict};
use async_trait::async_trait;
use code_execution::domain::{Egress, RunEnvironment, SdkEndpoints};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

/// The flag that sends a user's runs through the host's forwarder.
pub const EGRESS_PROXY_FLAG: &str = "enable-code-execution-egress-proxy";

/// How a user's runs reach the SDK hosts: through the host's forwarder when
/// [`EGRESS_PROXY_FLAG`] is on for them, else directly. Fail-closed: with no
/// flag client, or when their flags can't be read, runs go directly, as
/// before.
#[derive(Clone)]
pub struct EgressRollout<Flags = feature_flags::outbound::posthog::PostHogFeatureFlags> {
    flags: Option<Flags>,
    /// Each user's answer for a while, so a run doesn't wait on PostHog: a
    /// read for [`EGRESS_FLAG_TTL`], a failed one (direct) for
    /// [`EGRESS_FLAG_FAILURE_TTL`].
    cached:
        Arc<std::sync::Mutex<std::collections::HashMap<String, (tokio::time::Instant, Egress)>>>,
}

/// How long a user's egress flags are reused.
const EGRESS_FLAG_TTL: std::time::Duration = std::time::Duration::from_secs(60);
/// How long a failed read sends the user's runs direct before asking again.
const EGRESS_FLAG_FAILURE_TTL: std::time::Duration = std::time::Duration::from_secs(10);
/// Users whose answers are kept at once; past it, expired ones are dropped,
/// then all of them.
const EGRESS_FLAG_USERS: usize = 10_000;

impl<Flags> EgressRollout<Flags> {
    /// Read the flags from `flags`; with none, every run goes direct.
    pub fn new(flags: Option<Flags>) -> Self {
        Self {
            flags,
            cached: Arc::default(),
        }
    }
}

impl<Flags: FeatureFlags> EgressRollout<Flags> {
    /// The egress for a run acting as `user` under `scope`. A run under a
    /// default-deny scope (one with an allowlist: a background job, a
    /// channel mention) always goes through the egress proxy, whatever the
    /// flag: the forwarder carries only the hosts the run was given, so its
    /// refusals hold outside the sandbox too. The forwarder is then a hard
    /// dependency: if it can't start, the run fails (`FailureCode::Egress`)
    /// and never goes direct. Other runs follow the flag until it rolls out.
    pub async fn egress_for(
        &self,
        user: &MacroUserIdStr<'_>,
        scope: Option<SessionScope>,
    ) -> Egress {
        if scope.is_some_and(|scope| scope.allowlist().is_some()) {
            return Egress::Proxied;
        }
        self.egress(user).await
    }

    /// The egress for runs acting as `user`.
    pub async fn egress(&self, user: &MacroUserIdStr<'_>) -> Egress {
        let Some(flags) = &self.flags else {
            return Egress::Direct;
        };
        let span = tracing::info_span!(
            "code_execution.egress_flag",
            cache = tracing::field::Empty,
            egress = tracing::field::Empty,
        );
        let now = tokio::time::Instant::now();
        let key = user.as_ref().to_owned();
        let hit = self
            .cached
            .lock()
            .ok()
            .and_then(|cached| cached.get(&key).copied())
            .filter(|(until, _)| *until > now)
            .map(|(_, egress)| egress);
        if let Some(egress) = hit {
            span.record("cache", "hit");
            span.record("egress", tracing::field::debug(egress));
            return egress;
        }
        span.record("cache", "miss");
        let (egress, ttl) = match flags.load(user).instrument(span.clone()).await {
            Ok(snapshot) if snapshot.is_enabled(EGRESS_PROXY_FLAG) => {
                (Egress::Proxied, EGRESS_FLAG_TTL)
            }
            Ok(_) => (Egress::Direct, EGRESS_FLAG_TTL),
            Err(error) => {
                tracing::warn!(parent: &span, ?error, "could not read the egress flag; the run goes direct");
                (Egress::Direct, EGRESS_FLAG_FAILURE_TTL)
            }
        };
        span.record("egress", tracing::field::debug(egress));
        if let Ok(mut cached) = self.cached.lock() {
            if cached.len() >= EGRESS_FLAG_USERS {
                cached.retain(|_, (until, _)| *until > now);
                if cached.len() >= EGRESS_FLAG_USERS {
                    cached.clear();
                }
            }
            cached.insert(key, (now + ttl, egress));
        }
        egress
    }
}

pub struct RunCredentials {
    pub egress: EgressRollout,
    /// Which turns may start background jobs.
    pub detach: Arc<dyn jobs::MayDetach>,
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
        SessionScope::Generation
        | SessionScope::NoSend
        | SessionScope::DryRun
        | SessionScope::Job => matches!(
            tool,
            "ExecuteCode"
                | "DescribeCodeTools"
                | "ReadCodeDocs"
                | "CancelJob"
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
                    NativeToolVerdict::Refuse(SCOPE_UNREAD.to_owned())
                }
            }
        })
    }

    /// A scoped session calls no remote MCP server's tool directly
    /// (connected apps, custom servers, previews): the egress proxy that
    /// carries the call knows nothing of the scope, and a tool's read-only
    /// hint is its server's own claim. Its code's route to connected apps is
    /// refused by the scope too.
    fn refuse_remote_mcp<'a>(
        &'a self,
        session: agent_session::domain::model::AgentSessionId,
        tool: &'a str,
    ) -> std::pin::Pin<Box<dyn Future<Output = Option<String>> + Send + 'a>> {
        Box::pin(async move {
            match self.scopes.scope(session.as_uuid()).await {
                Ok(Some(_)) => Some(format!(
                    "This session can't use {tool}; it reaches no app outside Macro."
                )),
                Ok(None) => self.inner.refuse_remote_mcp(session, tool).await,
                Err(error) => {
                    tracing::error!(?error, "could not read a session's scope");
                    Some(SCOPE_UNREAD.to_owned())
                }
            }
        })
    }
}

/// What the model hears when a session's scope can't be read.
const SCOPE_UNREAD: &str = "Whether this tool may run could not be checked; nothing was done.";

impl RunCredentials {
    /// Mint the credential for a run approved to act as `actor`, signing a
    /// fresh correlation, and capture the current trace so the program's SDK
    /// calls land under the span it runs in.
    async fn mint(
        &self,
        identity: &ExecutionIdentity,
        actor: macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Result<IssuedRun, CodeModeError> {
        let scope = scope_of(self.scopes.as_ref(), identity.session.as_uuid()).await?;
        // A background job's credential lasts minutes and no one watches its
        // calls, so it makes only the requests on a job's lists, whatever its
        // session's own scope (hidden sessions can't start jobs anyway).
        let scope = match identity.lifetime {
            agent_code_mode::domain::RunLifetime::Job { .. } => Some(SessionScope::Job),
            agent_code_mode::domain::RunLifetime::Foreground => scope,
        };
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
        // No refresh credential. Covers the 30-second queue/run deadline, or
        // what is left of a background job's deadline once it holds a slot,
        // plus clock margin; a normal user token expires rather than
        // revoking on exit. A job's token is held only by its process, which
        // is killed when the job settles.
        let lifetime = match identity.lifetime {
            agent_code_mode::domain::RunLifetime::Foreground => 60,
            agent_code_mode::domain::RunLifetime::Job { deadline } => {
                usize::try_from((deadline - chrono::Utc::now()).num_seconds()).unwrap_or(0) + 60
            }
        };
        let token = self
            .signer
            .mint_for_agent(
                &actor,
                lifetime,
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
            correlation_id: correlation,
            environment: RunEnvironment {
                token,
                trace_headers: trace_headers(),
                endpoints: run_endpoints(&self.endpoints, scope.is_some()),
                session_id: Some(identity.session.as_uuid()),
                execution_id: Some(identity.execution.as_uuid()),
                unattended: None,
                egress: self.egress.egress_for(&actor, scope).await,
            },
            acting_user: actor,
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
        self.mint(identity, actor).await
    }

    async fn approve_job(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        cancel: CancellationToken,
    ) -> Result<macro_user_id::user_id::MacroUserIdStr<'static>, CodeModeError> {
        approve_run(self.gate.as_ref(), identity, source, &cancel).await
    }

    async fn mint_job(
        &self,
        identity: &ExecutionIdentity,
        acting_user: &macro_user_id::user_id::MacroUserIdStr<'static>,
    ) -> Result<IssuedRun, CodeModeError> {
        self.mint(identity, acting_user.clone()).await
    }

    async fn revoke_job(&self, correlation: macro_uuid::Uuid) -> Result<(), CodeModeError> {
        self.correlations
            .revoke(correlation)
            .await
            .map_err(|error| {
                tracing::error!(?error, "could not revoke a job credential");
                CodeModeError::Unavailable
            })
    }

    async fn may_detach(
        &self,
        identity: &ExecutionIdentity,
    ) -> Result<agent_code_mode::domain::Detach, CodeModeError> {
        self.detach.decide(identity).await
    }
}

/// Credentials for public MCP runs: the signed-in user, with no session, and
/// the agent the run's posts are attributed to: an agent caller (a self-hosted
/// agent's call through egress) as itself, any other caller as the Macro bot,
/// labelled with the MCP client's name - the same attribution the direct MCP
/// tools give. The MCP client asks the user before each tool call, so there is
/// no owner gate.
pub struct UserRunCredentials {
    pub egress: EgressRollout,
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
        let scoped = correlation
            .as_ref()
            .is_some_and(|signed| signed.scope.is_some());
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
            endpoints: run_endpoints(&self.endpoints, scoped),
            session_id: None,
            execution_id: None,
            unattended: None,
            egress: self
                .egress
                .egress_for(user, correlation.as_ref().and_then(|signed| signed.scope))
                .await,
        })
    }
}

/// The SDK hosts a run reaches. A scoped run (a hidden session, a scoped
/// public-MCP run, a routine's dry run, a background job) gets no unfurl
/// host: unfurl fetches what its caller names from Macro's servers and
/// takes no credential, so no scope can refuse it there. Where the boundary
/// is is written once, in `agent_correlation`'s AGENTS.md: the forwarder for
/// an allowlisted scope ([`EgressRollout::egress_for`]), the run bootstrap's
/// in-process guard for other scoped runs going direct.
pub(crate) fn run_endpoints(endpoints: &SdkEndpoints, scoped: bool) -> SdkEndpoints {
    let mut endpoints = endpoints.clone();
    if scoped {
        endpoints
            .hosts
            .remove(<&'static str>::from(SdkHost::Unfurl));
    }
    endpoints
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
pub mod jobs;
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
