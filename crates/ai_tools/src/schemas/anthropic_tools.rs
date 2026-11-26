//! Schemas for the Anthropic code-execution tools Macro agents no longer
//! offer. Saved transcripts still hold their calls, so typegen keeps them.
use ai_toolset::schema::PhantomTool;
use anthropic::types::response::code_execution::{
    BashCodeExecutionResponse, TextEditorCodeExecutionResponse,
};
use schemars::JsonSchema;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[schemars(title = "BashCodeExecution")]
pub struct BashCodeExecution {
    /// The bash command or instruction to execute.
    pub input: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[schemars(title = "TextEditorCodeExecution")]
pub struct TextEditorCodeExecution {
    /// The text editing instruction.
    pub input: String,
}

pub fn bash_code_execution() -> PhantomTool<BashCodeExecution, BashCodeExecutionResponse> {
    PhantomTool::new("BashCodeExecution")
}

pub fn text_editor_code_execution()
-> PhantomTool<TextEditorCodeExecution, TextEditorCodeExecutionResponse> {
    PhantomTool::new("TextEditorCodeExecution")
}
