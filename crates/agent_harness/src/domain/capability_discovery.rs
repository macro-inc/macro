//! Domain vocabulary for fresh ACP capability discovery.

use std::future::Future;
use std::time::Duration;

use agent_client_protocol::schema::v1::SessionConfigOption as AcpSessionConfigOption;
use agent_fold::domain::session_config::{SessionConfigOption, session_config_options};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Provider selected by a capability-discovery request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityHarness {
    /// Macro's in-process agent.
    InMemory,
    /// The caller's Cursor account.
    Cursor,
    /// A paired macrod runtime.
    Macrod,
}

/// One fresh capability-discovery request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoverAgentCapabilities {
    /// Provider to inspect.
    pub harness: CapabilityHarness,
    /// Paired harness identity, required only for [`CapabilityHarness::Macrod`].
    pub harness_id: Option<HarnessId>,
    /// Selected model, when inspecting a preflight override.
    pub model: Option<String>,
}

/// Agent-advertised settings returned by the use case.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    /// Complete ordered ACP session configuration advertised by the agent.
    pub config_options: Vec<SessionConfigOption>,
}

impl AgentCapabilities {
    fn from_options(options: &[AcpSessionConfigOption]) -> Self {
        Self {
            config_options: session_config_options(options),
        }
    }

    /// A provider with no discoverable session configuration.
    #[must_use]
    pub fn unsupported() -> Self {
        Self {
            config_options: Vec::new(),
        }
    }
}

/// Raw outcome from a provider probe.
#[derive(Debug)]
pub enum RawCapabilityProbe {
    /// ACP session configuration advertised by the provider.
    Options(Vec<AcpSessionConfigOption>),
    /// This provider cannot advertise session configuration.
    Unsupported,
}

/// A provider probe failure.
#[derive(Debug, thiserror::Error)]
pub enum CapabilityProbeError {
    /// A required live runtime is not connected.
    #[error("the requested harness is disconnected")]
    Disconnected,
    /// Provider-specific probing failed.
    #[error("capability probe failed: {0}")]
    Failed(String),
}

/// Use-case failure.
#[derive(Debug, thiserror::Error)]
pub enum DiscoverAgentCapabilitiesError {
    /// The target shape is invalid.
    #[error("{0}")]
    BadRequest(String),
    /// The caller cannot use or see the target harness.
    #[error("forbidden")]
    Forbidden,
    /// A required runtime is disconnected.
    #[error("the requested harness is disconnected")]
    Disconnected,
    /// The bounded request expired.
    #[error("capability probe timed out")]
    Timeout,
    /// A provider failed.
    #[error("capability probe failed: {0}")]
    Probe(String),
}

/// Authorizes visibility and use of paired harnesses.
pub trait HarnessCapabilityAccess: Send + Sync + 'static {
    /// Whether `caller` may use and see `harness`.
    fn can_use(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> impl Future<Output = Result<bool, String>> + Send;
}

/// Discovers a harness's advertised configuration without persisting a session.
pub trait CapabilityProbe: Send + Sync + 'static {
    /// Identity needed by the adapter: a caller, a paired harness, or `()`.
    type Target: Sync;

    /// Probe fresh capabilities for a target authorized by the domain service.
    fn probe(
        &self,
        target: &Self::Target,
        model: Option<&str>,
    ) -> impl Future<Output = Result<RawCapabilityProbe, CapabilityProbeError>> + Send;
}

/// Authenticated agent-capability discovery use case.
pub trait AgentCapabilitiesService: Send + Sync + 'static {
    /// Discover one target's session settings without creating a persisted session.
    fn load(
        &self,
        caller: MacroUserIdStr<'static>,
        request: DiscoverAgentCapabilities,
    ) -> impl Future<Output = Result<AgentCapabilities, DiscoverAgentCapabilitiesError>> + Send;
}

/// Domain service coordinating authorization, dispatch, timeout, and projection.
pub struct AgentCapabilitiesServiceImpl<Access, InMemory, Cursor, Macrod> {
    access: Access,
    in_memory: InMemory,
    cursor: Cursor,
    macrod: Macrod,
    timeout: Duration,
}

impl<Access, InMemory, Cursor, Macrod>
    AgentCapabilitiesServiceImpl<Access, InMemory, Cursor, Macrod>
{
    /// Build the service from its outbound ports.
    pub fn new(
        access: Access,
        in_memory: InMemory,
        cursor: Cursor,
        macrod: Macrod,
        timeout: Duration,
    ) -> Self {
        Self {
            access,
            in_memory,
            cursor,
            macrod,
            timeout,
        }
    }
}

impl<Access, InMemory, Cursor, Macrod> AgentCapabilitiesService
    for AgentCapabilitiesServiceImpl<Access, InMemory, Cursor, Macrod>
where
    Access: HarnessCapabilityAccess,
    InMemory: CapabilityProbe<Target = ()>,
    Cursor: CapabilityProbe<Target = MacroUserIdStr<'static>>,
    Macrod: CapabilityProbe<Target = HarnessId>,
{
    async fn load(
        &self,
        caller: MacroUserIdStr<'static>,
        request: DiscoverAgentCapabilities,
    ) -> Result<AgentCapabilities, DiscoverAgentCapabilitiesError> {
        match (request.harness, request.harness_id) {
            (CapabilityHarness::InMemory, None) => {
                self.discover(&self.in_memory, &(), request.model.as_deref())
                    .await
            }
            (CapabilityHarness::Cursor, None) => {
                self.discover(&self.cursor, &caller, request.model.as_deref())
                    .await
            }
            (CapabilityHarness::Macrod, Some(harness)) => {
                let allowed = self
                    .access
                    .can_use(&caller, harness)
                    .await
                    .map_err(DiscoverAgentCapabilitiesError::Probe)?;
                if !allowed {
                    return Err(DiscoverAgentCapabilitiesError::Forbidden);
                }
                self.discover(&self.macrod, &harness, request.model.as_deref())
                    .await
            }
            (CapabilityHarness::Macrod, None) => Err(DiscoverAgentCapabilitiesError::BadRequest(
                "harnessId is required for macrod".to_owned(),
            )),
            (_, Some(_)) => Err(DiscoverAgentCapabilitiesError::BadRequest(
                "harnessId is only valid for macrod".to_owned(),
            )),
        }
    }
}

impl<Access, InMemory, Cursor, Macrod>
    AgentCapabilitiesServiceImpl<Access, InMemory, Cursor, Macrod>
{
    async fn discover<Probe: CapabilityProbe>(
        &self,
        adapter: &Probe,
        target: &Probe::Target,
        model: Option<&str>,
    ) -> Result<AgentCapabilities, DiscoverAgentCapabilitiesError> {
        let probe = tokio::time::timeout(self.timeout, adapter.probe(target, model))
            .await
            .map_err(|_| DiscoverAgentCapabilitiesError::Timeout)?;
        match probe {
            Ok(RawCapabilityProbe::Options(options)) => {
                Ok(AgentCapabilities::from_options(&options))
            }
            Ok(RawCapabilityProbe::Unsupported) => Ok(AgentCapabilities::unsupported()),
            Err(CapabilityProbeError::Disconnected) => {
                Err(DiscoverAgentCapabilitiesError::Disconnected)
            }
            Err(CapabilityProbeError::Failed(message)) => {
                Err(DiscoverAgentCapabilitiesError::Probe(message))
            }
        }
    }
}

impl<T: super::model_load::HarnessModelAccess> HarnessCapabilityAccess for T {
    async fn can_use(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<bool, String> {
        super::model_load::HarnessModelAccess::can_use(self, caller, harness).await
    }
}
