//! Admission for provider-backed turns, independent of the ACP transport.

use ai_billing::domain::{AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use model_owner::Owner;

#[cfg(test)]
mod test;

/// Admit a new turn using the trusted session owner, never client metadata.
/// Non-user owners cannot run this runtime's user-scoped tools or be billed;
/// fail closed rather than substituting a system identity.
pub async fn admit_turn(
    admission: &dyn AiAdmissionService,
    owner: &Owner,
) -> Result<(), AiAdmissionError> {
    let user = owner.as_user().ok_or(AiAdmissionError::Unavailable)?;
    admission.admit(user, AiFeature::AgentSession).await
}
