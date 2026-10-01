//! Shared policy for user quota admission and prospective usage counting.

use macro_user_id::user_id::MacroUserIdStr;

use super::ports::{AiFeature, SYSTEM_USER_ID};

#[cfg(test)]
mod test;

/// Whether new user AI work is subject to quota admission and usage counting.
/// This policy does not enable financial settlement or payment collection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum AiUsageEnforcement {
    /// Skip quota admission and do not count new usage toward allowances.
    #[default]
    Disabled,
    /// Check quota and count billable, user-owned work.
    Enabled,
}

impl AiUsageEnforcement {
    /// Whether quota enforcement is enabled.
    pub const fn is_enabled(self) -> bool {
        matches!(self, Self::Enabled)
    }

    /// Whether this work requires quota admission and counts toward user usage.
    /// Callers must supply the trusted originating user and server-selected feature;
    /// the system identity is only for work with no originating end-user.
    pub fn should_count(self, user: &MacroUserIdStr<'_>, feature: AiFeature) -> bool {
        self.is_enabled() && is_billable_feature(feature) && user != &*SYSTEM_USER_ID
    }
}

/// Features whose provider costs are recorded but never consume allowances,
/// prepaid credits, or overage. Dictation is the Whispr transcription feature.
pub const NON_BILLABLE_AI_FEATURES: [AiFeature; 4] = [
    AiFeature::Memory,
    AiFeature::AiProjection,
    AiFeature::CallSummary,
    AiFeature::Dictation,
];

/// Whether a feature's usage is billable, independent of enforcement or identity.
/// Every new feature must explicitly choose its classification here.
pub const fn is_billable_feature(feature: AiFeature) -> bool {
    match feature {
        AiFeature::Memory
        | AiFeature::AiProjection
        | AiFeature::CallSummary
        | AiFeature::Dictation => false,
        AiFeature::Chat
        | AiFeature::Automation
        | AiFeature::DynamicCompletionsApi
        | AiFeature::ChatRename
        | AiFeature::ChannelBot
        | AiFeature::AiEditing
        | AiFeature::Import
        | AiFeature::AgentSession
        | AiFeature::AgentRepositoryChoice => true,
    }
}
