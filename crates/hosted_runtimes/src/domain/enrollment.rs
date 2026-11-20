//! What a computer reads at first boot to join Macro.
//!
//! The control plane hands one [`Enrollment`] as JSON to the Firecracker host,
//! which serves it to the guest through MMDS, or writes it into a file for
//! Docker computers, and deletes it once macrod connects.
//! These types are the contract between the control plane and
//! `macrod enroll`; macrod depends on this crate with default features off.

use crate::domain::ids::{ComputerId, PairingId};

use crate::domain::models::ComputerName;
use serde::{Deserialize, Serialize};

/// One-time join material. The device secret claims a pre-approved harness
/// pairing exactly once; a copy read after that claim is useless.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Enrollment {
    /// Computer this operation addresses.
    pub computer_id: ComputerId,
    /// Guest creation this one-time enrollment belongs to.
    pub generation: EnrollmentGeneration,
    /// One-time enrollment pairing.
    pub pairing_id: PairingId,
    /// Secret used to claim the pairing.
    #[serde(serialize_with = "serialize_device_secret")]
    pub device_secret: DeviceSecret,
    /// Display name the harness shows in Settings → Runtimes.
    pub name: ComputerName,
    /// The Macro deployment macrod joins, resolved when this enrollment was
    /// issued.
    pub deployment: Deployment,
    /// W3C context of the setup trace, so macrod's enrollment, claim and first
    /// reports join it. Opaque ids only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
    /// Whom the computer is for. Decides the guest image and what the guest
    /// grants its user; never changes for a computer. Carries no credential:
    /// an agent's environment arrives later over macrod's socket.
    pub role: ComputerRole,
}

/// The service addresses of the deployment a computer joins, as the guest
/// reaches them. Never persisted: each enrollment carries the current ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Deployment {
    /// agent_harness_service: macrod's runtime gateway and API.
    pub agent_harness_url: url::Url,
    /// document_storage_service: pairing claim and capability reports.
    pub document_storage_url: url::Url,
    /// The web app's origin, for links macrod prints.
    pub app_url: url::Url,
    /// Session egress: first-party MCP and the Anthropic gateway.
    pub egress_url: url::Url,
    /// OTLP/HTTP intake for the computer's own spans (macrod, the agent).
    /// Absent when the deployment has none the computer can reach.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub telemetry_url: Option<url::Url>,
}

/// The deployment could not be resolved; never carries a URL.
#[derive(Debug, thiserror::Error)]
#[error("the computer deployment addresses could not be resolved")]
pub struct DeploymentUnavailable;

/// Where the control plane reads the current deployment for an enrollment.
pub trait DeploymentSource: Send + Sync + 'static {
    /// The deployment as a computer reaches it now.
    fn deployment(&self) -> Result<Deployment, DeploymentUnavailable>;
}

pub use computer_types::{ComputerRole, EnrollmentGeneration};

/// Issuing an enrollment failed; never carries the pairing secret.
#[derive(Debug, thiserror::Error)]
#[error("computer enrollment issuance failed")]
pub struct EnrollmentIssueError;

/// A pairing credential, exposed only explicitly and wiped when dropped.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct DeviceSecret(String);

impl DeviceSecret {
    /// Take ownership of a credential received from the harness registry.
    pub fn new(value: String) -> Self {
        Self(value)
    }
    /// Expose the credential for enrollment transport or pairing.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for DeviceSecret {
    fn drop(&mut self) {
        zeroize::Zeroize::zeroize(&mut self.0);
    }
}

impl std::fmt::Debug for DeviceSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("DeviceSecret(**redacted**)")
    }
}

impl std::fmt::Display for DeviceSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

fn serialize_device_secret<S: serde::Serializer>(
    secret: &DeviceSecret,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(secret.expose())
}
