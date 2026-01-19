use ai::tool::schema::PhantomTool;
use anthropic::types::response::code_execution::{
    BashCodeExecutionResponse, BashCodeExecutionToolCall, TextEditorCodeExecutionResponse,
    TextEditorCodeExecutionToolCall,
};
use lazy_static::lazy_static;

lazy_static! {
    pub static ref anthropic_bash_code_execution_tool: PhantomTool<BashCodeExecutionToolCall, BashCodeExecutionResponse> =
        PhantomTool::new("bash_code_execution");
    pub static ref anthropic_text_editor_code_execution_tool: PhantomTool<TextEditorCodeExecutionToolCall, TextEditorCodeExecutionResponse> =
        PhantomTool::new("text_editor_code_execution");
}
