//! Converting a Notion page's enhanced markdown into a new document's Loro
//! snapshot (`POST /snapshot/notion`).

use std::collections::HashMap;

use anyhow::{Context, Result};
use base64::Engine;

use super::LexicalClient;
use crate::parse_markdown::check_response;

/// A Notion page body and what its references resolve to.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct NotionSnapshotRequest<'a> {
    /// The page in Notion's enhanced markdown.
    pub markdown: &'a str,
    /// Where its page and people references point in Macro.
    pub links: NotionSnapshotLinks,
}

/// Notion ids (dashless, lowercase) mapped to the Macro objects they became.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub struct NotionSnapshotLinks {
    /// Notion page id → the Macro document it became.
    pub pages: HashMap<String, NotionSnapshotPage>,
    /// Notion user id → the Macro user they are.
    pub users: HashMap<String, NotionSnapshotUser>,
}

/// The Macro document a Notion page became.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionSnapshotPage {
    /// The document id.
    pub document_id: String,
    /// Its name.
    pub name: String,
}

/// The Macro user a Notion person is.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionSnapshotUser {
    /// The Macro user id.
    pub user_id: String,
    /// Their email.
    pub email: String,
}

/// A converted Notion page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotionSnapshot {
    /// The new document's Loro snapshot.
    pub snapshot: Vec<u8>,
    /// The same content as Macro markdown.
    pub markdown: String,
}

#[derive(serde::Deserialize)]
struct NotionSnapshotResponse {
    snapshot: String,
    markdown: String,
}

impl LexicalClient {
    /// Convert a Notion page to a new document's Loro snapshot.
    #[tracing::instrument(
        skip(self, request),
        fields(
            markdown_bytes = request.markdown.len(),
            pages = request.links.pages.len(),
            users = request.links.users.len()
        ),
        err
    )]
    pub async fn notion_to_loro_snapshot(
        &self,
        request: &NotionSnapshotRequest<'_>,
    ) -> Result<NotionSnapshot> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = check_response(
            self.client
                .post(format!("{}/snapshot/notion", self.url))
                .headers(headers)
                .json(request)
                .send()
                .await?,
        )
        .await?;
        let body: NotionSnapshotResponse = response.json().await.context("unexpected response")?;
        Ok(NotionSnapshot {
            snapshot: base64::engine::general_purpose::STANDARD
                .decode(body.snapshot)
                .context("snapshot is not base64")?,
            markdown: body.markdown,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_matches_the_lexical_service_schema() {
        let request = NotionSnapshotRequest {
            markdown: "See <mention-page url=\"https://www.notion.so/p\">Plan</mention-page>",
            links: NotionSnapshotLinks {
                pages: [(
                    "3fb607323e2e80629886fc0c028d50a7".to_string(),
                    NotionSnapshotPage {
                        document_id: "0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001".to_string(),
                        name: "Plan".to_string(),
                    },
                )]
                .into(),
                users: [(
                    "12345678123412341234123456789abc".to_string(),
                    NotionSnapshotUser {
                        user_id: "macro|teo@acme.test".to_string(),
                        email: "teo@acme.test".to_string(),
                    },
                )]
                .into(),
            },
        };

        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            serde_json::json!({
                "markdown": "See <mention-page url=\"https://www.notion.so/p\">Plan</mention-page>",
                "links": {
                    "pages": {
                        "3fb607323e2e80629886fc0c028d50a7": {
                            "documentId": "0e5b6a2c-7c39-4a63-9a0c-5c1f2f6c0001",
                            "name": "Plan"
                        }
                    },
                    "users": {
                        "12345678123412341234123456789abc": {
                            "userId": "macro|teo@acme.test",
                            "email": "teo@acme.test"
                        }
                    }
                }
            })
        );
    }
}
