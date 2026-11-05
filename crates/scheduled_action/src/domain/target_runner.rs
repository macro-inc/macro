//! Run a routine's agent step without taking over session authorization or runtime policy.

use std::{sync::Arc, time::Duration};

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::{
    model::{AgentSessionId, SessionSource},
    routines::{
        PrepareRoutineSession, PromptRoutineSession, RoutineActionStatus, RoutineSessionAction,
        RoutineSessionError, RoutineSessions, ValidateRoutineSession,
    },
};
use anyhow::{Context, Result};
use bot_id::BotId;
use bots::domain::models::AgentMcpServer;
use macro_user_id::user_id::MacroUserIdStr;
use routine_program::AgentStep;
use trigger_context::TriggerContext;

use super::{
    execution::ExecutionHandle,
    models::{ExecutionResource, ExecutionResourceType, ResolvedTaskTarget, ScheduledAction},
    ports::RoutineAgents,
};

const INITIAL_POLL_DELAY: Duration = Duration::from_secs(1);
const MAX_POLL_DELAY: Duration = Duration::from_secs(10);
const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_STATUS_FAILURES: u8 = 5;

/// Executes agent steps through the agent-session domain.
/// The shared executor bounds preparation and polling by its original deadline,
/// drops in-flight reads on timeout/shutdown, and invokes `cancel` separately.
pub struct TargetRunner<Sessions> {
    sessions: Arc<Sessions>,
}

impl<Sessions> TargetRunner<Sessions> {
    pub fn new(sessions: Arc<Sessions>) -> Self {
        Self { sessions }
    }
}

impl<Sessions: RoutineSessions> RoutineAgents for TargetRunner<Sessions> {
    async fn prepare(
        &self,
        action: &ScheduledAction,
        step: &AgentStep,
        apps: &[AgentMcpServer],
        handle: &mut ExecutionHandle,
    ) -> Result<()> {
        let owner = action.owner_user()?;
        let (bot_id, model) = ResolvedTaskTarget::of(step)?.session_target();
        // Recorded before any await, so cleanup reaches a partially prepared session.
        handle.agent = Some(bot_id);
        let identity = session_action(owner, handle, bot_id);
        let prepared = self
            .sessions
            .prepare(PrepareRoutineSession {
                selection: ValidateRoutineSession {
                    owner: identity.owner.clone(),
                    bot_id,
                    model: model.map(str::to_owned),
                    mcp_servers: apps.to_vec(),
                },
                session_id: identity.session_id,
                source: SessionSource::Routine,
                visibility: action.run_visibility.into(),
            })
            .await;
        match prepared {
            Ok(prepared) if prepared.session_id == identity.session_id => {
                retain_resource(handle);
                Ok(())
            }
            Ok(_) => Err(RoutineSessionError::SessionMismatch.into()),
            // A definitive admission refusal created no session. Preserve the
            // shared type for HTTP mapping and resource-free executor cleanup.
            Err(RoutineSessionError::Admission(error)) => Err(error.into()),
            Err(error) => {
                // ModelMismatch proves the requested owner/session was established.
                // Other ambiguous failures may have persisted it too; a safe,
                // owner-checked snapshot can establish existence, never replay prepare.
                let uncertain = matches!(
                    error,
                    RoutineSessionError::OperationFailed
                        | RoutineSessionError::RuntimeUnavailable
                        | RoutineSessionError::SessionMismatch
                );
                if error == RoutineSessionError::ModelMismatch
                    || (uncertain
                        && matches!(
                            tokio::time::timeout(STATUS_TIMEOUT, self.sessions.status(identity))
                                .await,
                            Ok(Ok(_))
                        ))
                {
                    retain_resource(handle);
                }
                Err(error.into())
            }
        }
    }

    async fn run(
        &self,
        owner: &MacroUserIdStr<'static>,
        handle: &ExecutionHandle,
        prompt: String,
        context: Option<TriggerContext>,
    ) -> Result<()> {
        let bot_id = handle.agent.context("agent session was not prepared")?;
        let resource = handle
            .resource
            .as_ref()
            .context("agent session was not prepared")?;
        anyhow::ensure!(
            resource.resource_type == ExecutionResourceType::Agent
                && resource.id == handle.session_id.to_string(),
            "expected prepared agent session"
        );
        let identity = session_action(owner, handle, bot_id);
        let accepted = self
            .sessions
            .prompt(PromptRoutineSession {
                action: identity.clone(),
                prompt,
                context,
            })
            .await?;
        if accepted.action_id != identity.action_id {
            return Err(RoutineSessionError::PromptDeliveryUnknown.into());
        }
        self.await_completion(identity).await
    }

    async fn cancel(
        &self,
        owner: &MacroUserIdStr<'static>,
        handle: &ExecutionHandle,
    ) -> Result<()> {
        // Also stop partially prepared sessions; resource may still be None.
        let Some(bot_id) = handle.agent else {
            return Ok(());
        };
        self.sessions
            .cancel(session_action(owner, handle, bot_id))
            .await?;
        Ok(())
    }
}

impl<Sessions: RoutineSessions> TargetRunner<Sessions> {
    async fn await_completion(&self, identity: RoutineSessionAction) -> Result<()> {
        let mut delay = INITIAL_POLL_DELAY;
        let mut failures = 0;
        loop {
            // Snapshot immediately: a fast runtime may finish before prompt returns.
            // No detached tasks or fresh execution deadline: the executor's remaining
            // budget bounds this entire loop, including each read and backoff sleep.
            let status =
                tokio::time::timeout(STATUS_TIMEOUT, self.sessions.status(identity.clone()))
                    .await
                    .unwrap_or(Err(RoutineSessionError::OperationFailed));
            match status {
                Ok(RoutineActionStatus::Succeeded) => return Ok(()),
                Ok(RoutineActionStatus::Failed(reason)) => {
                    anyhow::bail!("initial agent action failed: {reason:?}");
                }
                Ok(RoutineActionStatus::Pending(_)) => failures = 0,
                Err(error) => {
                    failures += 1;
                    if !matches!(
                        error,
                        RoutineSessionError::OperationFailed
                            | RoutineSessionError::RuntimeUnavailable
                    ) || failures >= MAX_STATUS_FAILURES
                    {
                        return Err(error.into());
                    }
                }
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(MAX_POLL_DELAY);
        }
    }
}

fn session_action(
    owner: &MacroUserIdStr<'static>,
    handle: &ExecutionHandle,
    bot_id: BotId,
) -> RoutineSessionAction {
    RoutineSessionAction {
        owner: owner.clone(),
        bot_id,
        session_id: AgentSessionId::new_from_uuid(handle.session_id),
        action_id: AgentActionId::from_uuid(handle.action_id),
    }
}

fn retain_resource(handle: &mut ExecutionHandle) {
    handle.resource = Some(ExecutionResource {
        resource_type: ExecutionResourceType::Agent,
        id: handle.session_id.to_string(),
    });
}

#[cfg(test)]
mod test;
