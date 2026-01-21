use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ============================================================================
// Bash Code Execution Types
// ============================================================================

/// Response from bash_code_execution tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct BashCodeExecutionResponse {
    pub tool_use_id: String,
    pub content: BashCodeExecutionContent,
}

/// Content of a bash code execution response - either a result or an error
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BashCodeExecutionContent {
    BashCodeExecutionResult(BashCodeExecutionResult),
    #[serde(rename = "bash_code_execution_tool_result_error")]
    BashCodeExecutionToolResultError(BashCodeExecutionToolError),
}

/// Successful bash code execution result
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct BashCodeExecutionResult {
    /// Standard output from the command
    pub stdout: String,
    /// Standard error from the command
    pub stderr: String,
    /// Exit code (0 for success, non-zero for failure)
    pub return_code: i32,
    /// Files generated during execution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<CodeExecutionFile>>,
}

/// A file generated during code execution
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct CodeExecutionFile {
    /// File ID for retrieval via Files API
    pub file_id: String,
}

/// Error from bash code execution
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct BashCodeExecutionToolError {
    pub error_code: CodeExecutionErrorCode,
}

/// The expected shape of the streamed JSON following a `server_tool_use` for bash_code_execution
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct BashCodeExecutionToolCall {
    /// The bash command to execute
    pub command: String,
}

// ============================================================================
// Text Editor Code Execution Types
// ============================================================================

/// Response from text_editor_code_execution tool
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct TextEditorCodeExecutionResponse {
    pub tool_use_id: String,
    pub content: TextEditorCodeExecutionContent,
}

/// Content of a text editor code execution response - either a result or an error
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TextEditorCodeExecutionContent {
    #[serde(rename = "text_editor_code_execution_view_result")]
    TextEditorCodeExecutionViewResult(TextEditorCodeExecutionResult),
    #[serde(rename = "text_editor_code_execution_create_result")]
    TextEditorCodeExecutionCreateResult(TextEditorCodeExecutionResult),
    #[serde(rename = "text_editor_code_execution_str_replace_result")]
    TextEditorCodeExecutionStrReplaceResult(TextEditorCodeExecutionResult),
    #[serde(rename = "text_editor_code_execution_tool_result_error")]
    TextEditorCodeExecutionToolResultError(TextEditorCodeExecutionToolError),
}

/// Result from text editor operations (view, create, str_replace)
/// Fields are optional as different operations return different fields
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct TextEditorCodeExecutionResult {
    // View result fields
    /// Type of file (e.g., "text")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// File content (for view operations)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    /// Number of lines returned
    #[serde(rename = "numLines", skip_serializing_if = "Option::is_none")]
    pub num_lines: Option<u32>,
    /// Starting line number
    #[serde(rename = "startLine", skip_serializing_if = "Option::is_none")]
    pub start_line: Option<u32>,
    /// Total lines in file
    #[serde(rename = "totalLines", skip_serializing_if = "Option::is_none")]
    pub total_lines: Option<u32>,

    // Create result fields
    /// Whether the file already existed (true = update, false = create)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_file_update: Option<bool>,

    // Edit (str_replace) result fields
    /// Old content start line
    #[serde(rename = "oldStart", skip_serializing_if = "Option::is_none")]
    pub old_start: Option<u32>,
    /// Number of old lines changed
    #[serde(rename = "oldLines", skip_serializing_if = "Option::is_none")]
    pub old_lines: Option<u32>,
    /// New content start line
    #[serde(rename = "newStart", skip_serializing_if = "Option::is_none")]
    pub new_start: Option<u32>,
    /// Number of new lines
    #[serde(rename = "newLines", skip_serializing_if = "Option::is_none")]
    pub new_lines: Option<u32>,
    /// Diff lines (prefixed with +/-)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lines: Option<Vec<String>>,
}

/// Error from text editor code execution
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct TextEditorCodeExecutionToolError {
    pub error_code: CodeExecutionErrorCode,
}

/// The expected shape of the streamed JSON following a `server_tool_use` for text_editor_code_execution
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
pub struct TextEditorCodeExecutionToolCall {
    /// The command to execute: "view", "create", or "str_replace"
    pub command: String,
    /// Path to the file
    pub path: String,
    /// File content for create operations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_text: Option<String>,
    /// String to find for str_replace operations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_str: Option<String>,
    /// Replacement string for str_replace operations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_str: Option<String>,
}

// ============================================================================
// Shared Types
// ============================================================================

/// Error codes for code execution failures
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CodeExecutionErrorCode {
    /// The tool is temporarily unavailable
    Unavailable,
    /// Execution exceeded maximum time limit
    ExecutionTimeExceeded,
    /// Container expired and is no longer available
    ContainerExpired,
    /// Invalid parameters provided to the tool
    InvalidToolInput,
    /// Rate limit exceeded for tool usage
    TooManyRequests,
    /// File doesn't exist (for view/edit operations) - text_editor only
    FileNotFound,
    /// The old_str not found in file (for str_replace) - text_editor only
    StringNotFound,
}
