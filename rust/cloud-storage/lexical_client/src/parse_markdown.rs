use super::LexicalClient;
use crate::types::CognitionResponseData;

use anyhow::{Context, Result};
use models_search::document::MarkdownParseResult;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LexicalResponseItem {
    node_id: String,
    content: String,
    raw_content: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LexicalResponse {
    data: Vec<LexicalResponseItem>,
}

impl From<LexicalResponseItem> for MarkdownParseResult {
    fn from(result: LexicalResponseItem) -> MarkdownParseResult {
        MarkdownParseResult {
            node_id: result.node_id,
            content: result.content,
            raw_content: result.raw_content,
        }
    }
}

impl LexicalClient {
    pub async fn parse_markdown(&self, document_id: &str) -> Result<Vec<MarkdownParseResult>> {
        let full_url = format!("{}/search/{}", self.url, document_id);
        let response = self.client.get(&full_url).send().await?;

        let status_code = response.status();

        if status_code != reqwest::StatusCode::OK {
            let body: String = response.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service while getting raw document"
            );
            return Err(anyhow::anyhow!(body));
        }

        let data: LexicalResponse = response.json().await?;

        let results: Vec<MarkdownParseResult> =
            data.data.into_iter().map(|item| item.into()).collect();

        Ok(results)
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown_for_ai(&self, document_id: &str) -> Result<CognitionResponseData> {
        let full_url = format!("{}/cognition/{}", self.url, document_id);
        let response = self.client.get(&full_url).send().await?;

        let status_code = response.status();
        if status_code != reqwest::StatusCode::OK {
            let body: String = response.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service while getting raw document"
            );
            return Err(anyhow::anyhow!(body));
        }

        response.json().await.context("unexpected response")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lexical_response_to_markdown_results() {
        let json_data = r#"
        {
            "data": [
                {
                    "nodeId": "test-node-1",
                    "content": "Hello world",
                    "rawContent": "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Hello world\"}]}"
                },
                {
                    "nodeId": "test-node-2",
                    "content": "Test content",
                    "rawContent": "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Test content\"}]}"
                }
            ]
        }
        "#;

        let lexical_response: LexicalResponse = serde_json::from_str(json_data).unwrap();
        let results: Vec<MarkdownParseResult> = lexical_response
            .data
            .into_iter()
            .map(|item| item.into())
            .collect();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].node_id, "test-node-1");
        assert_eq!(results[0].content, "Hello world");
        assert_eq!(
            results[0].raw_content,
            "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Hello world\"}]}"
        );
        assert_eq!(results[1].node_id, "test-node-2");
        assert_eq!(results[1].content, "Test content");
    }
}
