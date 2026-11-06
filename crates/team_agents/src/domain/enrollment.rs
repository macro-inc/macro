//! Trusted facts held under the agent's enrollment issuance lock.

use hosted_runtimes::domain::{ids::ComputerId, persona_credentials::PersonaCredentialError};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::PersonaSeed;

/// The account bound to a computer; credentials are never stored here.
pub struct EnrollmentAgent {
    /// Registered agent account.
    pub user_id: MacroUserIdStr<'static>,
    /// Current team identity.
    pub team_id: Uuid,
    /// Owning account is marked as an agent.
    pub is_agent: bool,
    /// Non-secret repository recovery inputs.
    pub seed: PersonaSeed,
}

/// Keeps issuance serialized until all credential providers finish.
pub struct EnrollmentContext<Guard> {
    /// Account linked to the computer, if any.
    pub agent: Option<EnrollmentAgent>,
    /// Lease retained until issuance finishes.
    pub guard: Guard,
}

/// Loads the actual account/computer binding and locks that agent across replicas.
pub trait EnrollmentAccounts: Send + Sync + 'static {
    /// Adapter-owned lock spanning credential providers.
    type Guard: Send;

    /// Read trusted facts while serializing issuance for this agent.
    fn enrollment_context(
        &self,
        computer: ComputerId,
        candidate: Option<&MacroUserIdStr<'_>>,
        team: Uuid,
    ) -> impl Future<Output = Result<EnrollmentContext<Self::Guard>, PersonaCredentialError>> + Send;
    /// Commit the trusted binding while releasing the issuance lock.
    fn finish_enrollment(
        &self,
        guard: Self::Guard,
        computer: ComputerId,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), PersonaCredentialError>> + Send;
}

/// Computer facts read only through the owning runtime domain.
pub trait EnrollmentComputers: Send + Sync + 'static {
    /// Read the durable computer and generation for trusted fleet issuance.
    fn enrollment_computer(
        &self,
        computer: ComputerId,
    ) -> impl Future<
        Output = Result<hosted_runtimes::domain::models::Computer, PersonaCredentialError>,
    > + Send;
}
