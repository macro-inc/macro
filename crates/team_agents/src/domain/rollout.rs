//! One fail-closed rollout policy for every team-agent administrator operation.

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// Shared frontend/backend rollout key. This never replaces team authorization.
pub const TEAM_AGENTS_FLAG: &str = "enable-team-agents";

/// Loads one immutable snapshot for the authenticated administrator per operation.
/// Agent self-service, credentials and runtime traffic must never consult it.
pub struct TeamAgentRollout<Flags> {
    flags: Option<Flags>,
}

impl<Flags> std::fmt::Debug for TeamAgentRollout<Flags> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TeamAgentRollout").finish_non_exhaustive()
    }
}

impl<Flags> TeamAgentRollout<Flags> {
    /// A missing provider closes the administrative feature.
    pub fn new(flags: Option<Flags>) -> Self {
        Self { flags }
    }
}

impl<Flags: FeatureFlags> TeamAgentRollout<Flags> {
    /// Load exactly once and synchronously read the shared rollout key. Missing
    /// provider, missing key, disabled values and load errors all close the gate.
    pub async fn enabled(&self, caller: &MacroUserIdStr<'_>) -> bool {
        let Some(flags) = &self.flags else {
            return false;
        };
        flags.load(caller).await
            .inspect_err(|error| tracing::warn!(error = ?error, "could not load feature flags; team agents stay closed"))
            .is_ok_and(|snapshot| snapshot.is_enabled(TEAM_AGENTS_FLAG))
    }
}

#[cfg(feature = "outbound")]
impl<Flags: FeatureFlags + 'static> agent_secrets::domain::admin::AgentAdminRollout
    for TeamAgentRollout<Flags>
{
    async fn enabled(&self, caller: &MacroUserIdStr<'_>) -> bool {
        self.enabled(caller).await
    }
}

#[cfg(test)]
mod test;

#[cfg(feature = "outbound")]
impl<Flags: FeatureFlags + 'static> teams::domain::agent_invites::AgentInviteRollout
    for TeamAgentRollout<Flags>
{
    fn enabled<'a>(
        &'a self,
        caller: &'a MacroUserIdStr<'_>,
    ) -> teams::domain::agent_invites::AgentInviteDecision<'a> {
        Box::pin(self.enabled(caller))
    }
}
