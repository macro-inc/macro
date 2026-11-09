//! Admission for provider-backed turns, independent of the ACP transport.

use agent_session::domain::model::SessionMetering;
use ai_billing::domain::{AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use model_owner::Owner;

#[cfg(test)]
mod test;

/// Admit a new turn using the trusted session owner, never client metadata.
/// Non-user owners cannot run this runtime's user-scoped tools or be billed;
/// fail closed rather than substituting a system identity.
/// `feature` is the session's ([`session_feature`]), set by whoever opened it.
pub async fn admit_turn(
    admission: &dyn AiAdmissionService,
    owner: &Owner,
    feature: AiFeature,
) -> Result<(), AiAdmissionError> {
    let user = owner.as_user().ok_or(AiAdmissionError::Unavailable)?;
    admission.admit(user, feature).await
}

/// The feature a session's turns are admitted and metered as, from how
/// whoever opened it said to meter it.
#[must_use]
pub fn session_feature(metering: SessionMetering) -> AiFeature {
    match metering {
        SessionMetering::AgentSession => AiFeature::AgentSession,
        SessionMetering::RoutineSuggestions => AiFeature::RoutineSuggestions,
    }
}
