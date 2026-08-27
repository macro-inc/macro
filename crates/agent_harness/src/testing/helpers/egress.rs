//! Sandbox egress provisioner test double.

use std::sync::{Arc, Mutex};

use agent_session::domain::model::AgentSessionId;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::Result;
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;

/// A [`SandboxEgressProvisioner`] that records who it was asked for and hands
/// back a fixed environment. Cloning shares one record.
#[derive(Clone, Default)]
pub struct EgressProvisionerMock {
    provisioned: Arc<Mutex<Vec<(AgentSessionId, String, String)>>>,
}

impl EgressProvisionerMock {
    /// A provisioner that has provisioned nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every provisioning recorded, as session, owner, and repository URL.
    #[must_use]
    pub fn provisioned(&self) -> Vec<(AgentSessionId, String, String)> {
        self.provisioned
            .lock()
            .expect("egress mock lock should not be poisoned")
            .clone()
    }
}

impl SandboxEgressProvisioner for EgressProvisionerMock {
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        repo_url: &str,
    ) -> Result<ProvisionedEgress> {
        self.provisioned
            .lock()
            .expect("egress mock lock should not be poisoned")
            .push((session, owner.to_string(), repo_url.to_owned()));

        Ok(ProvisionedEgress {
            sandbox: test_egress(),
            session_token_hash: "test-token-hash".to_owned(),
        })
    }

    async fn restore(
        &self,
        _owner: &MacroUserIdStr<'static>,
        session_token: String,
    ) -> Result<SandboxEgress> {
        Ok(SandboxEgress {
            session_token,
            ..test_egress()
        })
    }
}

/// An egress environment for tests that only need one to exist.
#[must_use]
pub fn test_egress() -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.test".to_owned(),
        session_token: "test-session-token".to_owned(),
        mcp_servers: Vec::new(),
    }
}
