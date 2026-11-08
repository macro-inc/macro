use ai_toolset::schema::PhantomTool;
use anthropic::types::response::code_execution::{
    BashCodeExecutionResponse, BashCodeExecutionToolCall, TextEditorCodeExecutionResponse,
    TextEditorCodeExecutionToolCall,
};

pub fn bash_code_execution() -> PhantomTool<BashCodeExecutionToolCall, BashCodeExecutionResponse> {
    PhantomTool::new("bash_code_execution")
}

pub fn text_editor_code_execution()
-> PhantomTool<TextEditorCodeExecutionToolCall, TextEditorCodeExecutionResponse> {
    PhantomTool::new("text_editor_code_execution")
}
