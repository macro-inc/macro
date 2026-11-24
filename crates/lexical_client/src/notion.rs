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
    /// Page-local database card placements.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub databases: Vec<NotionSnapshotDatabaseOccurrence>,

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

/// An exact Notion source, and its selected view when present.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionLinkReference {
    /// Normalized page or container id.
    pub id: String,
    /// Normalized view id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view_id: Option<String>,
}

/// A verified Macro destination.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NotionLinkDestination {
    /// A confirmed imported page.
    Page {
        /// Document identity.
        document_id: String,
    },
    /// A confirmed imported database.
    Database {
        /// Database identity.
        database_id: String,
        /// Starter table identity.
        table_id: String,
        /// Saved view at the requested tab.
        #[serde(skip_serializing_if = "Option::is_none")]
        view_id: Option<String>,
    },
}

/// A replacement of one exact reference.
#[derive(Debug, Clone, serde::Serialize)]
pub struct NotionLinkReplacement {
    /// The exact Notion reference.
    #[serde(flatten)]
    pub source: NotionLinkReference,
    /// The confirmed Macro target.
    pub destination: NotionLinkDestination,
}

/// A snapshot's reference inventory and optional link-only update.
#[derive(Debug, serde::Deserialize)]
pub struct NotionLinkDelta {
    /// Base64 revision from the snapshot's version vector.
    pub revision: String,
    /// Exact Notion references in supported link nodes.
    pub references: Vec<NotionLinkReference>,
    /// Count of changed link nodes.
    pub rewritten: usize,
    /// Base64 of the update.
    pub update: Option<String>,
}

impl NotionLinkDelta {
    /// Decode the snapshot's expected revision.
    pub fn revision_bytes(&self) -> Result<Vec<u8>> {
        Ok(base64::engine::general_purpose::STANDARD.decode(&self.revision)?)
    }

    /// Decode the link delta when at least one hyperlink changed.
    pub fn update_bytes(&self) -> Result<Option<Vec<u8>>> {
        self.update
            .as_ref()
            .map(|update| Ok(base64::engine::general_purpose::STANDARD.decode(update)?))
            .transpose()
    }
}

impl LexicalClient {
    /// Inspect a bounded snapshot and optionally prepare an href-only Loro delta.
    #[tracing::instrument(skip_all, fields(snapshot_bytes = snapshot.len(), replacements = replacements.len()), err)]
    pub async fn notion_link_delta(
        &self,
        snapshot: &[u8],
        replacements: &[NotionLinkReplacement],
    ) -> Result<NotionLinkDelta> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(format!("{}/snapshot/notion-links", self.url))
            .headers(headers)
            .json(&serde_json::json!({
                "snapshot": base64::engine::general_purpose::STANDARD.encode(snapshot),
                "replacements": replacements,
            }))
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

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
mod test;

/// A page-local database placement.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotionSnapshotDatabaseOccurrence {
    /// Normalized external container identity.
    pub container_id: String,
    /// Placement number for this container.
    pub ordinal: usize,
    /// Card destination or named source fallback.
    pub target: NotionSnapshotDatabaseTarget,
}

/// A card requires both destination database and table identity.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum NotionSnapshotDatabaseTarget {
    /// Existing editable database.
    Resolved {
        /// Database identity.
        database_id: String,
        /// Table identity.
        table_id: String,
        /// Translated saved view.
        #[serde(skip_serializing_if = "Option::is_none")]
        view_id: Option<String>,
    },
    /// Retained source link.
    Fallback {
        /// Why this placement could not become a card.
        reason: NotionSnapshotDatabaseFallback,
    },
}

/// Reasons accepted by the database card converter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NotionSnapshotDatabaseFallback {
    /// The connection cannot read it.
    NoAccess,
    /// The source is missing.
    NotFound,
    /// The review did not import it as a database.
    NotImported,
    /// No unambiguous destination could be chosen.
    Unresolved,
}
