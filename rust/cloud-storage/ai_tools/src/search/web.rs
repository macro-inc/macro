use crate::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, JsonSchema, Serialize)]
pub struct SearchResult {
    pub url: String,
    pub name: String,
}

#[derive(Debug, Clone, JsonSchema, Serialize)]
pub struct SearchResults {
    pub content: String,
    pub results: Vec<SearchResult>,
}

const WEB_SEARCH_DESCRIPTION: &str = concat!(
    "Trigger an intelligent internet search tool with a search query. ",
    "Phrase the query as a natural language question. ",
    "The search tool only has the information passed into the query string to include any relevant context ",
    "from the conversation. Use this tool when the user specifically requests a web search, asks for resources, asks for links, asks you to read documentation",
    "When referencing links returned by search remember to use github markdown notation to format them like this [description](https://example.com)",
    r#"Our CEO describes when to use web search like this: I think some important criteria for choosing to search the web are",
    if the user is asking for time-sensitive information (sports scores, news, current happenings, etc) that would have changed since the knowledge cutoff date
        Specific questions that reference external sources, eg contain a hyperlink in the user message or explicitly say “use webmd” or “check arxiv”
        do not use web search for things that are likely to find SEO slop content; this will make it worse than if it didn’t do it
        the LLM is be allowed to guess an answer and then use the web search tool to check AFTER providing the answer, if it feels it’s necessary. E.g. user asks “when was Caesar stabbed” -> llm gives answer -> if needed use web to double check"
    "#,
    "do not use this tool many times in a single response, you think the user may need more information ask them before calling web search again. You should always share",
    "the results of your search with the user even if you are not sure if they are useful"
);

const WEB_SEARCH_SYSTEM_PROMPT: &str = concat!(
    "You are an internal search tool used for augmenting and grounding agentic responses.",
    "Be concise and informational in your responses. Format your responses with plaintext"
);

#[derive(Debug, Clone, JsonSchema, Deserialize)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = WEB_SEARCH_DESCRIPTION
)]
pub struct WebSearch {
    #[schemars(description = "The search string to search for. Should be long / descriptive")]
    pub query: String,
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for WebSearch {
    type Output = SearchResults;

    #[tracing::instrument(skip_all, fields(user_id=?_request_context.user_id), err)]
    async fn call(
        &self,
        _service_context: ToolServiceContext,
        _request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Web search params");

        let client = ai::web_search::PerplexityClient::from_env().map_err(|err| ToolCallError {
            description: "Search failed due to an internal error. Do not try to search again."
                .to_string(),
            internal_error: anyhow::Error::from(err),
        })?;

        let results = client
            .simple_search(self.query.as_str(), WEB_SEARCH_SYSTEM_PROMPT)
            .await
            .map_err(|err| ToolCallError {
                description: "web search failed due to an internal server error".to_string(),
                internal_error: err,
            })?;

        let content = results
            .choices
            .first()
            .ok_or_else(|| ToolCallError {
                description: "The search didn't return any results".to_string(),
                internal_error: anyhow::anyhow!("No choices returned by search"),
            })?
            .message
            .content
            .clone();

        let results = results
            .search_results
            .into_iter()
            .map(|result| SearchResult {
                name: result.title,
                url: result.url,
            })
            .collect();

        Ok(SearchResults { content, results })
    }
}
