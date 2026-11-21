//! An install's egress policy, put in place before its agent starts: a
//! fresh holder owns the install's network namespace, the guard loads the
//! ruleset rendered for what that namespace and the host look like now, and
//! macrod reads it back and checks it. Engine-agnostic: the engine supplies
//! the holder, the facts and the guard.

use super::egress::{self, Allow, NetworkFacts};
use super::engine::{Engine, EngineError, GuardError, HolderSpec, HostNetwork, holder_name};
use agent_runtime_protocol::domain::schema::v0::{IsolationProblem, TeammateInstallId};

/// Why an install's policy isn't in place.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum IsolationError {
    /// The engine failed a step; it may pass (backed off like a crash).
    #[error("the engine could not set up isolation: {0}")]
    Engine(EngineError),
    /// The policy can't be put in place, or didn't read back as rendered:
    /// the agent must not start.
    #[error("the egress policy is not in place ({problem:?}): {detail}")]
    Unavailable {
        /// Which step.
        problem: IsolationProblem,
        /// What it said.
        detail: String,
    },
}

impl IsolationError {
    /// The problem a host report names.
    pub fn problem(&self) -> IsolationProblem {
        match self {
            Self::Engine(_) => IsolationProblem::EngineFailed,
            Self::Unavailable { problem, .. } => *problem,
        }
    }
}

impl From<GuardError> for IsolationError {
    fn from(error: GuardError) -> Self {
        match error {
            GuardError::Engine(error) => Self::Engine(error),
            GuardError::Refused(detail) => Self::Unavailable {
                problem: IsolationProblem::GuardRefused,
                detail,
            },
        }
    }
}

/// What isolating one install needs.
#[derive(Debug, Clone)]
pub struct Isolation<'allow> {
    /// The install.
    pub install_id: TeammateInstallId,
    /// The pinned image the holder and the guard run.
    pub image_id: String,
    /// The networks the holder joins.
    pub networks: Vec<String>,
    /// The explicit exceptions.
    pub allow: &'allow [Allow],
    /// On a local stack, the service address and port pairs the agent was
    /// given: allowed one by one, never the stack's subnet.
    pub services: &'allow [(String, u16)],
}

/// Replace the install's holder with a fresh one, load and check its
/// ruleset; the holder's id, for the agent to join.
pub async fn isolate<EngineImpl: Engine>(
    engine: &EngineImpl,
    isolation: &Isolation<'_>,
) -> Result<String, IsolationError> {
    let name = holder_name(&isolation.install_id);
    engine
        .remove_container(&name)
        .await
        .map_err(IsolationError::Engine)?;
    let holder_id = engine
        .run_holder(&HolderSpec {
            install_id: isolation.install_id.clone(),
            image_id: isolation.image_id.clone(),
            networks: isolation.networks.clone(),
        })
        .await
        .map_err(IsolationError::Engine)?;
    let facts = facts(engine, &holder_id, isolation).await?;
    let allow = allowed(engine, &holder_id, isolation).await;
    let ruleset = egress::ruleset(&allow, &facts);
    let readback = engine
        .guard(&holder_id, &isolation.image_id, Some(&ruleset))
        .await?;
    egress::verify(&readback, &allow, &facts).map_err(|mismatch| IsolationError::Unavailable {
        problem: IsolationProblem::ReadbackMismatch,
        detail: mismatch.to_string(),
    })?;
    Ok(holder_id)
}

/// Check that a running holder still has the ruleset rendered for now (an
/// adopted agent): read back only, nothing loaded.
pub async fn check<EngineImpl: Engine>(
    engine: &EngineImpl,
    holder_id: &str,
    isolation: &Isolation<'_>,
) -> Result<(), IsolationError> {
    let facts = facts(engine, holder_id, isolation).await?;
    let allow = allowed(engine, holder_id, isolation).await;
    let readback = engine.guard(holder_id, &isolation.image_id, None).await?;
    egress::verify(&readback, &allow, &facts).map_err(|mismatch| IsolationError::Unavailable {
        problem: IsolationProblem::ReadbackMismatch,
        detail: mismatch.to_string(),
    })
}

/// The explicit exceptions, then each local-stack service resolved in the
/// holder's namespace, one address and port each. A service that doesn't
/// resolve, or resolves somewhere no exception may go, is left out (and
/// unreachable, which the agent shows).
async fn allowed<EngineImpl: Engine>(
    engine: &EngineImpl,
    holder_id: &str,
    isolation: &Isolation<'_>,
) -> Vec<Allow> {
    let mut allow = isolation.allow.to_vec();
    for (host, port) in isolation.services {
        let addresses = match host.parse::<std::net::IpAddr>() {
            Ok(address) => vec![address],
            Err(_) => match engine.resolve(holder_id, host).await {
                Ok(addresses) => addresses,
                Err(error) => {
                    tracing::warn!(host, error = %error, "a local stack's service doesn't resolve for the teammate");
                    continue;
                }
            },
        };
        for address in addresses {
            match Allow::new(ipnet::IpNet::from(address), vec![*port]) {
                Ok(entry) if !allow.contains(&entry) => allow.push(entry),
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(host, error = %error, "a local stack's service isn't allowed")
                }
            }
        }
    }
    allow
}

async fn facts<EngineImpl: Engine>(
    engine: &EngineImpl,
    holder_id: &str,
    isolation: &Isolation<'_>,
) -> Result<NetworkFacts, IsolationError> {
    let mut facts = engine
        .network_facts(holder_id, &isolation.networks)
        .await
        .map_err(IsolationError::Engine)?;
    facts.host_prefixes = host_network(engine).await?.prefixes;
    Ok(facts)
}

/// The host's addresses and routes. A host whose addresses can't be read
/// can't be protected: refused.
pub async fn host_network<EngineImpl: Engine>(
    engine: &EngineImpl,
) -> Result<HostNetwork, IsolationError> {
    engine
        .host_network()
        .await
        .map_err(|error| IsolationError::Unavailable {
            problem: IsolationProblem::HostUnreadable,
            detail: error.to_string(),
        })
}
