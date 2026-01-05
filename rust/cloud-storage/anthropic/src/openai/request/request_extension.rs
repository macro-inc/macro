use crate::types::request::WEB_SEARCH_TOOL;

/// Request extensions are functionality that is supported by the anthropic API but not supported by OpenAI/completions/v1
/// These will affect the request sent to anthropic
///
/// Server tools are the main features we need to support that are only supported by anthropic but not OpenAI

#[derive(Clone, Debug, Copy)]
pub enum AnthropicRequestExtension {
    /// <https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool>
    WebSearchTool,
    // https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool
    // FetchTool,
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

impl AnthropicRequestExtension {
    pub(crate) fn extend_request(
        &self,
        request: &mut crate::types::request::CreateMessageRequestBody,
    ) {
        match self {
            Self::WebSearchTool => {
                if let Some(ref mut tools) = request.tools {
                    let search = WEB_SEARCH_TOOL.clone().into();
                    if !tools.iter().any(|t| t == &search) {
                        tools.push(search);
                    }
                } else {
                    request.tools = Some(vec![WEB_SEARCH_TOOL.clone().into()])
                }
            }
        }
    }
}
