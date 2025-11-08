use ai::traits::Metadata;
use ai::types::Model;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub static REWRITE_MODEL: Model = Model::OpenAIGPT4o;
pub static PROMPT: &str = concat!(
    "export const rewritePrompt: string = `Using the provided list of nodeKeys (unique identifiers for nodes in a Lexical markdown editor)",
    " and their associated markdown content, generate a structured set of document diffs (revisions) to follow the users change directives",
    " Return your response as a JSON object following the AI diffs schema format with an array of diff objects, each containing: an 'operation' field",
    " (either 'INSERT_AFTER', 'INSERT_BEFORE', 'DELETE', or 'MODIFY'), a 'node_id' field (must be one of the provided nodeKeys), and a 'text' field (",
    " containing new or modified content, or empty for DELETE operations). Create meaningful diffs that add transitions between disconnected paragraphs",
    ", break up lengthy text, insert relevant subheadings, fix errors, ensure consistent formatting, remove redundancies, enhance clarity of technical ",
    " explanations, add illustrative examples, or insert concise summaries after complex sections, while only using existing nodeKeys and maintaining",
    "overall document coherence. Maintain the markdown syntax. Respect the XML components when possible, as they contain custom elements supported by our app.`;"
);

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AIDiffResponse {
    pub diffs: Vec<Diff>,
}

#[derive(Serialize, Deserialize, JsonSchema, ToSchema, Debug)]
#[serde(deny_unknown_fields)]
pub struct Diff {
    pub operation: String,
    pub node_key: String,
    pub markdown_text: String,
}

impl Metadata for AIDiffResponse {
    fn name() -> String {
        "AIDiffResponse".to_string()
    }
    fn description() -> Option<String> {
        Some("An list of diffs to be applied to a markdown document.".to_string())
    }
}
