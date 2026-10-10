//! Sandbox egress provisioner test double.

use std::sync::{Arc, Mutex};

use agent_egress::domain::model::McpServerSlug;
use agent_session::domain::model::{AgentMcpServers, AgentSessionId};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::error::Result;
use crate::domain::model::{ProvisionedEgress, SandboxEgress};
use crate::domain::ports::SandboxEgressProvisioner;

/// One recorded provisioning: session, owner, and the MCP selection it was
/// asked to advertise.
pub type RecordedProvisioning = (AgentSessionId, String, AgentMcpServers);

/// A [`SandboxEgressProvisioner`] that records who it was asked for and hands
/// back a fixed environment. Cloning shares one record.
#[derive(Clone, Default)]
pub struct EgressProvisionerMock {
    provisioned: Arc<Mutex<Vec<RecordedProvisioning>>>,
    /// The apps every environment advertises, as the owner's connections.
    connected: Arc<Mutex<Vec<McpServerSlug>>>,
}

impl EgressProvisionerMock {
    /// A provisioner that has provisioned nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Every provisioning recorded, as session, owner, and the MCP selection
    /// it was asked to advertise.
    #[must_use]
    pub fn provisioned(&self) -> Vec<RecordedProvisioning> {
        self.provisioned
            .lock()
            .expect("egress mock lock should not be poisoned")
            .clone()
    }

    /// Advertise `app` in every environment from now on, as an owner who has
    /// just connected it would see.
    pub fn connect(&self, app: &str) {
        self.connected
            .lock()
            .expect("egress mock lock should not be poisoned")
            .push(McpServerSlug::parse(app).expect("a valid app slug"));
    }

    fn egress(&self, session_token: String) -> SandboxEgress {
        SandboxEgress {
            session_token,
            mcp_servers: self
                .connected
                .lock()
                .expect("egress mock lock should not be poisoned")
                .clone(),
            ..test_egress()
        }
    }
}

impl SandboxEgressProvisioner for EgressProvisionerMock {
    async fn provision(
        &self,
        session: AgentSessionId,
        owner: &MacroUserIdStr<'static>,
        selection: &AgentMcpServers,
    ) -> Result<ProvisionedEgress> {
        self.provisioned
            .lock()
            .expect("egress mock lock should not be poisoned")
            .push((session, owner.to_string(), selection.clone()));

        Ok(ProvisionedEgress {
            sandbox: self.egress(test_egress().session_token),
            session_token_hash: "test-token-hash".to_owned(),
        })
    }

    async fn restore(
        &self,
        _owner: &MacroUserIdStr<'static>,
        session_token: String,
        _selection: &AgentMcpServers,
    ) -> Result<SandboxEgress> {
        Ok(self.egress(session_token))
    }
}

/// An egress environment for tests that only need one to exist.
#[must_use]
pub fn test_egress() -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.test".to_owned(),
        session_token: "test-session-token".to_owned(),
        mcp_servers: Vec::new(),
        custom_servers: Vec::new(),
    }
}
