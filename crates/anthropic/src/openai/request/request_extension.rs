use crate::{
    prelude::{ServerTool, WEB_FETCH_TOOL},
    types::request::{CODE_EXECUTION_TOOL, WEB_SEARCH_TOOL},
};

/// Request extensions are functionality that is supported by the anthropic API but not supported by OpenAI/completions/v1
/// These will affect the request sent to anthropic
///
/// Server tools are the main features we need to support that are only supported by anthropic but not OpenAI

#[derive(Clone, Debug, Copy, PartialEq, Eq)]
pub enum AnthropicRequestExtension {
    /// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
    WebSearchTool,
    /// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool>
    FetchTool,
    /// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool>
    CodeExecutionTool,
}

#[derive(Clone, Debug)]
pub struct AnthropicRequestExtensions(pub Vec<AnthropicRequestExtension>);

impl AnthropicRequestExtensions {
    pub fn extend_request(
        &self,
        mut request: crate::types::request::CreateMessageRequestBody,
    ) -> crate::types::request::CreateMessageRequestBody {
        self.0
            .iter()
            .for_each(|extension| extension.extend_request(&mut request));
        request
    }
}

fn add_tool(tool: ServerTool, request: &mut crate::types::request::CreateMessageRequestBody) {
    if let Some(ref mut tools) = request.tools {
        let search = tool.into();
        if !tools.iter().any(|t| t == &search) {
            tools.push(search);
        }
    } else {
        request.tools = Some(vec![tool.into()])
    }
}

impl AnthropicRequestExtension {
    pub(crate) fn extend_request(
        &self,
        request: &mut crate::types::request::CreateMessageRequestBody,
    ) {
        match self {
            Self::WebSearchTool => add_tool(WEB_SEARCH_TOOL.clone(), request),
            Self::FetchTool => add_tool(WEB_FETCH_TOOL.clone(), request),
            Self::CodeExecutionTool => add_tool(CODE_EXECUTION_TOOL.clone(), request),
        }
    }
}
