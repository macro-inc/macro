//! Group C: application commands that apply AI-edit operations natively.
use lexical_model::*;

mod ai_ops;

/// Install the group C plugins.
pub fn register(builder: EditorBuilder) -> EditorBuilder {
    ai_ops::register(builder)
}

/// Decode a group C application command.
pub fn decode_command(name: &str, json: &str, generation: u32) -> Result<Option<Command>, Error> {
    ai_ops::decode(name, json, generation)
}

/// Answer a group C bulk query.
pub fn query(
    name: &str,
    data: &serde_json::Value,
    generation: u32,
    state: &EditorState,
) -> Result<Option<serde_json::Value>, Error> {
    ai_ops::query(name, data, generation, state)
}
