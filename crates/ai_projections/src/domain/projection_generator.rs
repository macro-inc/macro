//! Outbound port for generating ai projection results via the AI toolset.

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::AiProjectionError;

/// The inputs for a single projection generation run.
#[derive(Debug, Clone, Copy)]
pub struct GenerationRequest<'a> {
    /// The projection definition id, used to name the output schema.
    pub projection_id: &'a str,
    /// The prompt to run against the AI toolset.
    pub prompt: &'a str,
    /// Optional `provider/model` id (e.g. `cerebras/llama-3.3-70b`). The
    /// default model is used when absent or unroutable.
    pub model: Option<&'a str>,
    /// Optional JSON schema the result must conform to. When set, the returned
    /// string is the JSON serialization of a value matching this schema.
    pub output_schema: Option<&'a serde_json::Value>,
}

/// Runs a projection's prompt against the AI toolset on behalf of a user and
/// returns the generated result text.
///
/// This is the seam that keeps the heavy agent/toolset dependencies out of the
/// domain crate: the service depends on this trait, and an outbound adapter
/// (`outbound::agent_generator`) implements it using the shared agent loop.
pub trait ProjectionGenerator: Clone + Send + Sync + 'static {
    /// Runs the request's prompt as `user_id` against the AI toolset, returning
    /// the generated result text (or schema-conforming JSON).
    fn generate(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: GenerationRequest<'_>,
    ) -> impl Future<Output = Result<String, AiProjectionError>> + Send;
}
