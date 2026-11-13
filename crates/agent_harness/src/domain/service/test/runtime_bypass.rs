//! Stopping a session's asking changes the runtime first, then the agent, and
//! reports a runtime that allows bypass while its agent still asks.

use super::*;
use crate::domain::model::PermissionPolicyConfig;
use crate::domain::runtime_bypass::{
    AgentChoiceChange, RuntimeBypassError, RuntimeBypassFacts, RuntimeBypassService,
    RuntimeBypassSettings, StoppedAsking,
};

struct AsksOnRuntime;

impl crate::domain::ports::PermissionPolicySource for AsksOnRuntime {
    async fn permission_policy(&self, _: BotId) -> anyhow::Result<PermissionPolicyConfig> {
        Ok(PermissionPolicyConfig::Persona {
            kind: AgentKind::External,
            harness_allows_bypass: Some(false),
            auto_accept_permissions: None,
        })
    }
}

/// Settings where the caller manages both the runtime and an agent that asks.
/// Each change is recorded in order, and fails when told to.
struct RecordingSettings {
    harness: harness_id::HarnessId,
    runtime_change_fails: bool,
    agent_change_fails: bool,
    changes: Mutex<Vec<&'static str>>,
}

#[async_trait::async_trait]
impl RuntimeBypassSettings for RecordingSettings {
    async fn facts(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _bot: BotId,
    ) -> anyhow::Result<Option<RuntimeBypassFacts>> {
        Ok(Some(RuntimeBypassFacts {
            harness: self.harness,
            runtime_allows_bypass: false,
            caller_manages_runtime: true,
            agent_auto_accepts: false,
            caller_manages_agent: true,
        }))
    }

    async fn allow_runtime_bypass(
        &self,
        _caller: &MacroUserIdStr<'static>,
        harness: harness_id::HarnessId,
    ) -> Result<(), RuntimeBypassError> {
        assert_eq!(harness, self.harness);
        self.changes.lock().unwrap().push("runtime");
        if self.runtime_change_fails {
            return Err(RuntimeBypassError::Forbidden);
        }
        Ok(())
    }

    async fn auto_accept_permissions(
        &self,
        _caller: &MacroUserIdStr<'static>,
        _bot: BotId,
    ) -> Result<(), RuntimeBypassError> {
        self.changes.lock().unwrap().push("agent");
        if self.agent_change_fails {
            return Err(RuntimeBypassError::Forbidden);
        }
        Ok(())
    }
}

#[tokio::test]
async fn stopping_the_asking_turns_on_the_runtime_then_the_agent() {
    let harness = harness_id::HarnessId::new_from_uuid(Uuid::new_v4());
    let settings = Arc::new(RecordingSettings {
        harness,
        runtime_change_fails: false,
        agent_change_fails: false,
        changes: Mutex::new(Vec::new()),
    });
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_runtime_bypass(AsksOnRuntime, settings.clone());
    let id = AgentSessionId::new();
    live_sandboxed_coder_session(&service, &containers, id).await;

    let stopped = service
        .stop_asking_on_runtime(&staff_sender(), id)
        .await
        .expect("both changes are the caller's");

    assert_eq!(
        stopped,
        StoppedAsking {
            harness,
            agent: AgentChoiceChange::SetToBypass,
        }
    );
    assert_eq!(*settings.changes.lock().unwrap(), vec!["runtime", "agent"]);
}

#[tokio::test]
async fn a_refused_runtime_change_changes_nothing() {
    let harness = harness_id::HarnessId::new_from_uuid(Uuid::new_v4());
    let settings = Arc::new(RecordingSettings {
        harness,
        runtime_change_fails: true,
        agent_change_fails: false,
        changes: Mutex::new(Vec::new()),
    });
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_runtime_bypass(AsksOnRuntime, settings.clone());
    let id = AgentSessionId::new();
    live_sandboxed_coder_session(&service, &containers, id).await;

    let stopped = service.stop_asking_on_runtime(&staff_sender(), id).await;

    assert!(matches!(stopped, Err(RuntimeBypassError::Forbidden)));
    assert_eq!(*settings.changes.lock().unwrap(), vec!["runtime"]);
}

#[tokio::test]
async fn a_failed_agent_change_reports_the_runtime_on_and_the_agent_asking() {
    let harness = harness_id::HarnessId::new_from_uuid(Uuid::new_v4());
    let settings = Arc::new(RecordingSettings {
        harness,
        runtime_change_fails: false,
        agent_change_fails: true,
        changes: Mutex::new(Vec::new()),
    });
    let ((service, _repo, containers, _announcer, _runtimes), _turns) =
        harness_with_runtime_bypass(AsksOnRuntime, settings.clone());
    let id = AgentSessionId::new();
    live_sandboxed_coder_session(&service, &containers, id).await;

    let stopped = service
        .stop_asking_on_runtime(&staff_sender(), id)
        .await
        .expect("the runtime change stands");

    assert_eq!(
        stopped,
        StoppedAsking {
            harness,
            agent: AgentChoiceChange::StillAsks,
        }
    );
    assert_eq!(*settings.changes.lock().unwrap(), vec!["runtime", "agent"]);
}
