//! A computer that runs an agent teammate.
//!
//! This crate knows only which agent account a computer runs; the persona
//! (its credentials, workspace and prompt) belongs to `team_agents`. At
//! enrollment the operator asks an [`AgentEnrollmentSource`] for the agent's
//! environment and hands it to macrod inside the [`Enrollment`], which writes
//! it where the guest's brain reads it.
//!
//! [`Enrollment`]: crate::domain::enrollment::Enrollment

use std::{collections::BTreeMap, future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::{enrollment::EnrollmentGeneration, ids::ComputerId};

#[cfg(test)]
mod test;

/// An environment variable name an agent enrollment may set: upper-case
/// ASCII letters, digits and underscores, starting with a letter.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(transparent)]
pub struct AgentEnvKey(String);

/// The name is not a valid environment variable name.
#[derive(Debug, thiserror::Error)]
#[error("invalid agent environment variable name")]
pub struct InvalidAgentEnvKey;

impl AgentEnvKey {
    /// Validate a name.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidAgentEnvKey> {
        let value = value.into();
        let mut chars = value.chars();
        let valid = chars.next().is_some_and(|first| first.is_ascii_uppercase())
            && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidAgentEnvKey)
        }
    }

    /// The name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for AgentEnvKey {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// The agent's environment: credentials and addresses, one line each.
/// Debug shows only the names, and the values are wiped when dropped.
#[derive(Clone, Default, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct AgentEnv(BTreeMap<AgentEnvKey, String>);

/// A value spans lines, so it could inject another variable.
#[derive(Debug, thiserror::Error)]
#[error("agent environment values must be single lines")]
pub struct MultilineAgentEnvValue;

impl AgentEnv {
    /// Take validated names and single-line values.
    pub fn new(values: BTreeMap<AgentEnvKey, String>) -> Result<Self, MultilineAgentEnvValue> {
        let env = Self(values);
        if env
            .0
            .values()
            .any(|value| value.contains(['\n', '\r', '\0']))
        {
            return Err(MultilineAgentEnvValue);
        }
        Ok(env)
    }

    /// The variables, for writing the guest's environment file.
    pub fn expose(&self) -> &BTreeMap<AgentEnvKey, String> {
        &self.0
    }
}

impl<'de> Deserialize<'de> for AgentEnv {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(BTreeMap::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl std::fmt::Debug for AgentEnv {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentEnv")
            .field("keys", &self.0.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Drop for AgentEnv {
    fn drop(&mut self) {
        for value in self.0.values_mut() {
            zeroize::Zeroize::zeroize(value);
        }
    }
}

/// What macrod needs to run the agent a computer was bought for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentEnrollment {
    /// The agent's Macro account.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The environment the guest's brain runs with.
    pub env: AgentEnv,
}

/// Issuing an agent enrollment failed. Never carries a credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AgentEnrollmentError {
    /// No source is configured, so an agent computer cannot enroll.
    #[error("agent enrollment is not configured")]
    Unavailable,
    /// The computer or its agent no longer exists.
    #[error("agent computer not found")]
    NotFound,
    /// The source failed.
    #[error("agent enrollment issuance failed")]
    IssuanceFailed,
}

/// A boxed issuance, so the operator can hold any source.
pub type AgentEnrollmentFuture<'a> = Pin<
    Box<dyn Future<Output = Result<Option<AgentEnrollment>, AgentEnrollmentError>> + Send + 'a>,
>;

/// Issues the agent part of a computer's enrollment.
pub trait AgentEnrollmentSource: Send + Sync + 'static {
    /// The agent's enrollment for this guest creation, or `None` when the
    /// computer runs no agent. Each call may mint fresh credentials.
    fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> AgentEnrollmentFuture<'_>;
}

/// For deployments without agent teammates: every computer enrolls without
/// an agent.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoAgentEnrollment;

impl AgentEnrollmentSource for NoAgentEnrollment {
    fn issue(&self, _: ComputerId, _: EnrollmentGeneration) -> AgentEnrollmentFuture<'_> {
        Box::pin(async { Ok(None) })
    }
}

/// Which agent each computer runs.
pub trait ComputerAgents: Send + Sync + 'static {
    /// Storage failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// The agent a computer was bought for, if any.
    fn agent_of(
        &self,
        computer: ComputerId,
    ) -> impl Future<Output = Result<Option<MacroUserIdStr<'static>>, Self::Error>> + Send;

    /// The team's computer bought for this agent, if any.
    fn computer_for_agent(
        &self,
        team_id: uuid::Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<ComputerId>, Self::Error>> + Send;
}
