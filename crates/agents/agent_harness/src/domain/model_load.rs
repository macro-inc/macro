//! Domain vocabulary for fresh agent-model discovery.

use std::future::Future;
use std::time::Duration;

use agent_client_protocol::schema::v1::SessionConfigOption;
use agent_fold::domain::model::ModelOption;
use agent_fold::domain::model_selection::model_selection;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Provider selected by a model-discovery request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelHarness {
    /// Macro's in-process agent.
    InMemory,
    /// The caller's Cursor account.
    Cursor,
    /// A paired macrod runtime.
    Macrod,
}

/// One fresh model-discovery request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadAgentModels {
    /// Provider to inspect.
    pub harness: ModelHarness,
    /// Paired harness identity, required only for [`ModelHarness::Macrod`].
    pub harness_id: Option<HarnessId>,
}

/// Availability of the requested provider's model picker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentModelsStatus {
    /// A model select was advertised.
    Available,
    /// The provider does not advertise a model select.
    Unsupported,
}

/// Model picker data returned by the use case.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModels {
    /// Whether model selection is available.
    pub status: AgentModelsStatus,
    /// Currently selected model, absent when unsupported.
    pub current_model: Option<String>,
    /// Ordered model choices.
    pub models: Vec<ModelOption>,
    /// When the runtime last reported this catalog, for one served from
    /// memory because its machine is off or unreachable; absent when live.
    pub cached_at: Option<DateTime<Utc>>,
}

impl AgentModels {
    fn from_options(options: &[SessionConfigOption]) -> Self {
        match model_selection(options) {
            Some(selection) => Self {
                status: AgentModelsStatus::Available,
                current_model: Some(selection.current),
                models: selection.options,
                cached_at: None,
            },
            None => Self::unsupported(),
        }
    }

    fn remembered(known: &KnownModels) -> Self {
        Self {
            cached_at: Some(known.observed_at),
            ..Self::from_options(&known.options)
        }
    }

    /// A provider with no model-selection capability.
    #[must_use]
    pub fn unsupported() -> Self {
        Self {
            status: AgentModelsStatus::Unsupported,
            current_model: None,
            models: Vec::new(),
            cached_at: None,
        }
    }
}

/// Raw outcome from a provider probe.
#[derive(Debug)]
pub enum RawModelProbe {
    /// ACP session configuration advertised by the provider.
    Options(Vec<SessionConfigOption>),
    /// This provider cannot advertise models.
    Unsupported,
}

/// A provider probe failure.
#[derive(Debug, thiserror::Error)]
pub enum ModelProbeError {
    /// A required live runtime, or the caller's Cursor account, is not connected.
    #[error("the requested harness is disconnected")]
    Disconnected,
    /// Provider-specific probing failed.
    #[error("model probe failed: {0}")]
    Failed(String),
}

/// Use-case failure.
#[derive(Debug, thiserror::Error)]
pub enum LoadAgentModelsError {
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
    #[error("model probe timed out")]
    Timeout,
    /// A provider failed.
    #[error("model probe failed: {0}")]
    Probe(String),
}

/// Whether a caller may use a paired harness, and whether it is reachable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HarnessModelReach {
    /// The caller cannot use or see it.
    Forbidden,
    /// Its daemon holds a runtime connection.
    Connected,
    /// Its daemon is not connected, e.g. a Macro computer that is powered off.
    Disconnected,
}

/// Authorizes visibility and use of paired harnesses.
pub trait HarnessModelAccess: Send + Sync + 'static {
    /// Whether `caller` may use and see `harness`, and whether it is connected.
    fn reach(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> impl Future<Output = Result<HarnessModelReach, String>> + Send;
}

/// The model configuration a paired runtime last reported.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownModels {
    /// Its ACP session configuration, as probed.
    pub options: Vec<SessionConfigOption>,
    /// When it was probed.
    pub observed_at: DateTime<Utc>,
}

/// The last model configuration each paired runtime reported, kept so its
/// agents stay editable while the machine is off.
pub trait KnownMacrodModels: Send + Sync + 'static {
    /// The last successful probe of `harness`.
    fn last_known(
        &self,
        harness: HarnessId,
    ) -> impl Future<Output = Result<Option<KnownModels>, String>> + Send;

    /// Record a successful probe of `harness`.
    fn remember(
        &self,
        harness: HarnessId,
        options: &[SessionConfigOption],
    ) -> impl Future<Output = Result<(), String>> + Send;
}

/// Fresh in-memory model probe.
pub trait InMemoryModelProbe: Send + Sync + 'static {
    /// Probe the running in-memory implementation.
    fn probe(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<RawModelProbe, ModelProbeError>> + Send;
}

/// Fresh Cursor model probe.
pub trait CursorModelProbe: Send + Sync + 'static {
    /// Probe using only the caller's own Cursor credential.
    fn probe(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<RawModelProbe, ModelProbeError>> + Send;
}

/// Fresh paired-macrod model probe.
pub trait MacrodModelProbe: Send + Sync + 'static {
    /// Probe the live runtime connection for `harness`.
    fn probe(
        &self,
        harness: HarnessId,
    ) -> impl Future<Output = Result<RawModelProbe, ModelProbeError>> + Send;
}

/// Authenticated agent-model discovery use case.
pub trait AgentModelsService: Send + Sync + 'static {
    /// Load one target's model catalog without creating a persisted session.
    fn load(
        &self,
        caller: MacroUserIdStr<'static>,
        request: LoadAgentModels,
    ) -> impl Future<Output = Result<AgentModels, LoadAgentModelsError>> + Send;
}

/// Domain service coordinating authorization, dispatch, timeout, and projection.
pub struct AgentModelsServiceImpl<Access, InMemory, Cursor, Macrod, Known> {
    access: Access,
    in_memory: InMemory,
    cursor: Cursor,
    macrod: Macrod,
    known: Known,
    timeout: Duration,
}

impl<Access, InMemory, Cursor, Macrod, Known>
    AgentModelsServiceImpl<Access, InMemory, Cursor, Macrod, Known>
{
    /// Build the service from its outbound ports.
    pub fn new(
        access: Access,
        in_memory: InMemory,
        cursor: Cursor,
        macrod: Macrod,
        known: Known,
        timeout: Duration,
    ) -> Self {
        Self {
            access,
            in_memory,
            cursor,
            macrod,
            known,
            timeout,
        }
    }
}

impl<Access, InMemory, Cursor, Macrod, Known>
    AgentModelsServiceImpl<Access, InMemory, Cursor, Macrod, Known>
where
    Access: HarnessModelAccess,
    Macrod: MacrodModelProbe,
    Known: KnownMacrodModels,
{
    /// A paired runtime's catalog: probed live when it is connected and
    /// remembered, otherwise the last one it reported.
    async fn load_macrod(
        &self,
        caller: &MacroUserIdStr<'static>,
        harness: HarnessId,
    ) -> Result<AgentModels, LoadAgentModelsError> {
        let reach = self
            .access
            .reach(caller, harness)
            .await
            .map_err(LoadAgentModelsError::Probe)?;
        let probe = match reach {
            HarnessModelReach::Forbidden => return Err(LoadAgentModelsError::Forbidden),
            HarnessModelReach::Disconnected => Err(LoadAgentModelsError::Disconnected),
            HarnessModelReach::Connected => {
                match tokio::time::timeout(self.timeout, self.macrod.probe(harness)).await {
                    Err(_) => Err(LoadAgentModelsError::Timeout),
                    Ok(Ok(RawModelProbe::Options(options))) => {
                        if let Err(error) = self.known.remember(harness, &options).await {
                            tracing::warn!(%harness, error, "could not remember a runtime's models");
                        }
                        return Ok(AgentModels::from_options(&options));
                    }
                    Ok(Ok(RawModelProbe::Unsupported)) => return Ok(AgentModels::unsupported()),
                    Ok(Err(ModelProbeError::Disconnected)) => {
                        Err(LoadAgentModelsError::Disconnected)
                    }
                    Ok(Err(ModelProbeError::Failed(message))) => {
                        Err(LoadAgentModelsError::Probe(message))
                    }
                }
            }
        };
        match self
            .known
            .last_known(harness)
            .await
            .map_err(LoadAgentModelsError::Probe)?
        {
            Some(known) => Ok(AgentModels::remembered(&known)),
            None => probe,
        }
    }
}

impl<Access, InMemory, Cursor, Macrod, Known> AgentModelsService
    for AgentModelsServiceImpl<Access, InMemory, Cursor, Macrod, Known>
where
    Access: HarnessModelAccess,
    InMemory: InMemoryModelProbe,
    Cursor: CursorModelProbe,
    Macrod: MacrodModelProbe,
    Known: KnownMacrodModels,
{
    async fn load(
        &self,
        caller: MacroUserIdStr<'static>,
        request: LoadAgentModels,
    ) -> Result<AgentModels, LoadAgentModelsError> {
        let probe = match (request.harness, request.harness_id) {
            (ModelHarness::InMemory, None) => {
                tokio::time::timeout(self.timeout, self.in_memory.probe(&caller))
                    .await
                    .map_err(|_| LoadAgentModelsError::Timeout)?
            }
            (ModelHarness::Cursor, None) => {
                tokio::time::timeout(self.timeout, self.cursor.probe(&caller))
                    .await
                    .map_err(|_| LoadAgentModelsError::Timeout)?
            }
            (ModelHarness::Macrod, Some(harness)) => {
                return self.load_macrod(&caller, harness).await;
            }
            (ModelHarness::Macrod, None) => {
                return Err(LoadAgentModelsError::BadRequest(
                    "harnessId is required for macrod".to_owned(),
                ));
            }
            (_, Some(_)) => {
                return Err(LoadAgentModelsError::BadRequest(
                    "harnessId is only valid for macrod".to_owned(),
                ));
            }
        };

        match probe {
            Ok(RawModelProbe::Options(options)) => Ok(AgentModels::from_options(&options)),
            Ok(RawModelProbe::Unsupported) => Ok(AgentModels::unsupported()),
            Err(ModelProbeError::Disconnected) => Err(LoadAgentModelsError::Disconnected),
            Err(ModelProbeError::Failed(message)) => Err(LoadAgentModelsError::Probe(message)),
        }
    }
}
