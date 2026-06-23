//! Outbound port for generating ai projection results via the AI toolset.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::AiProjectionError;

/// Runs a projection's prompt against the AI toolset on behalf of a user and
/// returns the generated result text.
///
/// This is the seam that keeps the heavy agent/toolset dependencies out of the
/// domain crate: the service depends on this trait, and an outbound adapter
/// (`outbound::agent_generator`) implements it using the shared agent loop.
pub trait ProjectionGenerator: Clone + Send + Sync + 'static {
    /// Runs `prompt` as `user_id` against the AI toolset, returning the
    /// generated result text.
    fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        prompt: &str,
    ) -> impl Future<Output = Result<String, AiProjectionError>> + Send;
}
