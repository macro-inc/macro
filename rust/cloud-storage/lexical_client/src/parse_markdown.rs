use super::LexicalClient;
use crate::types::{CognitionResponseData, CognitionV2ResponseData};

use anyhow::{Context, Result};
use models_search::document::MarkdownParseResult;
use serde::de::DeserializeOwned;

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

#[derive(Debug, serde::Serialize)]
struct MarkdownSnapshotRequest<'a> {
    markdown: &'a str,
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

async fn check_response(response: reqwest::Response) -> Result<reqwest::Response> {
    if response.status() == reqwest::StatusCode::OK {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await?;
    tracing::error!(body=%body, status=%status, "unexpected response from lexical service");
    anyhow::bail!(body);
}

impl LexicalClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown(&self, document_id: &str) -> Result<Vec<MarkdownParseResult>> {
        let url = format!("{}/search/{}", self.url, document_id);
        let response = check_response(self.client.get(&url).send().await?).await?;
        let data: LexicalResponse = response.json().await?;
        Ok(data.data.into_iter().map(Into::into).collect())
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown_for_ai(&self, document_id: &str) -> Result<CognitionResponseData> {
        let url = format!("{}/cognition/{}", self.url, document_id);
        self.get_json(&url).await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown_for_ai_from_url(
        &self,
        presigned_url: &str,
    ) -> Result<CognitionResponseData> {
        let url = format!("{}/cognition/presigned", self.url);
        let response = check_response(
            self.client
                .get(&url)
                .query(&[("url", presigned_url)])
                .send()
                .await?,
        )
        .await?;
        response.json().await.context("unexpected response")
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_cognition_v2(&self, document_id: &str) -> Result<CognitionV2ResponseData> {
        let url = format!("{}/cognitionv2/{}", self.url, document_id);
        self.get_json(&url).await
    }

    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn markdown_to_loro_snapshot(&self, markdown: &str) -> Result<Vec<u8>> {
        let url = format!("{}/snapshot/markdown", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&MarkdownSnapshotRequest { markdown })
                .send()
                .await?,
        )
        .await?;

        let bytes = response.bytes().await?;
        Ok(bytes.to_vec())
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let response = check_response(self.client.get(url).send().await?).await?;
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

    #[test]
    fn test_cognition_v2_deserialization() {
        use crate::types::{CognitionV2ResponseData, NewMdNode};

        let json_data = r##"
        {
            "data": [
                {
                    "type": "generic",
                    "nodeId": "abc123",
                    "content": "# Hello",
                    "tag": "heading"
                },
                {
                    "type": "staticImage",
                    "url": "https://example.com/image.png"
                },
                {
                    "type": "dssImage",
                    "id": "dss-image-456"
                },
                {
                    "type": "generic",
                    "nodeId": "def789",
                    "content": "Some paragraph text",
                    "tag": "paragraph"
                }
            ]
        }
        "##;

        let response: CognitionV2ResponseData = serde_json::from_str(json_data).unwrap();
        assert_eq!(response.data.len(), 4);

        match &response.data[0] {
            NewMdNode::Generic(node) => {
                assert_eq!(node.node_id, "abc123");
                assert_eq!(node.content, "# Hello");
                assert_eq!(node.tag, "heading");
            }
            _ => panic!("expected Generic node"),
        }

        match &response.data[1] {
            NewMdNode::StaticImage { url } => {
                assert_eq!(url, "https://example.com/image.png");
            }
            _ => panic!("expected StaticImage node"),
        }

        match &response.data[2] {
            NewMdNode::DssImage { id } => {
                assert_eq!(id, "dss-image-456");
            }
            _ => panic!("expected dssImage node"),
        }
    }
}
