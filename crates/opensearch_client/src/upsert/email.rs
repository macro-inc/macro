use models_opensearch::SearchIndex;

use super::properties::IndexedProperty;
use crate::{
    Result,
    date_format::EpochMillis,
    error::{OpensearchClientError, OpensearchOperation},
    upsert::agent_session::external_version,
};

/// The arguments for upserting an email message into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertEmailArgs {
    /// The id of the email thread
    #[serde(rename = "entity_id")]
    pub thread_id: String,
    /// The id of the email message
    pub message_id: String,
    /// The sender of the email message
    pub sender: String,
    /// The display name of the sender
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_name: Option<String>,
    /// The reply-to address of the email message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    /// The recipients of the email message
    pub recipients: Vec<String>,
    /// The display names of the recipients
    pub recipient_names: Vec<String>,
    /// The cc of the email message
    pub cc: Vec<String>,
    /// The display names of the cc contacts
    pub cc_names: Vec<String>,
    /// The bcc of the email message
    pub bcc: Vec<String>,
    /// The display names of the bcc contacts
    pub bcc_names: Vec<String>,
    /// The labels of the email message
    pub labels: Vec<String>,
    /// The link id of the email message
    pub link_id: String,
    /// The user id of the email message
    pub user_id: String,
    /// The updated at time of the email message, in milliseconds
    pub updated_at_millis: EpochMillis,
    /// The subject of the email message
    pub subject: Option<String>,
    /// The sent at time of the email message, in milliseconds
    pub sent_at_millis: Option<EpochMillis>,
    /// The content of the email message
    pub content: String,
    /// Denormalized thread properties (e.g. tags) used for search filtering.
    /// Thread-level, so identical across every message doc of the thread.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<IndexedProperty>,
}

/// One email document, named by the thread and message it is keyed by: a
/// message has one document under each thread it was indexed under.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct EmailDocumentKey {
    /// The thread the document is indexed under (its `entity_id`).
    pub thread_id: String,
    /// The message the document holds.
    pub message_id: String,
}

impl EmailDocumentKey {
    fn document_id(&self) -> String {
        email_document_id(&self.thread_id, &self.message_id)
    }
}

/// What a versioned email write did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EmailWrites {
    /// Documents written.
    pub indexed: usize,
    /// Documents deleted, or found already absent.
    pub deleted: usize,
    /// Writes and deletes the index refused because it already holds a later
    /// version of the document: a newer writer got there first.
    pub refused_stale: usize,
}

/// The id of a message's document under a thread: one per thread it is
/// indexed under.
pub(crate) fn email_document_id(thread_id: &str, message_id: &str) -> String {
    format!("{thread_id}:{message_id}")
}

fn serialization_error(error: serde_json::Error) -> OpensearchClientError {
    OpensearchClientError::SerializationFailed {
        details: error.to_string(),
        operation: OpensearchOperation::WriteEmailDocuments,
    }
}

/// Writes `documents` and deletes `deletes` in one `_bulk` request, every
/// action carrying `version` as an `external_gte` version. The index refuses
/// an action on a document that already holds a later version, so a writer
/// that read its source before a newer writer cannot undo what that writer
/// wrote or deleted; a delete's version is remembered for the index's
/// `gc_deletes`. Each action names its document by id, so it needs no refresh
/// and a resend of the same request applies again rather than conflicting.
pub(crate) async fn write_email_documents(
    client: &opensearch::OpenSearch,
    version: u64,
    documents: &[UpsertEmailArgs],
    deletes: &[EmailDocumentKey],
    index_override: Option<&str>,
) -> Result<EmailWrites> {
    if documents.is_empty() && deletes.is_empty() {
        return Ok(EmailWrites::default());
    }
    let operation = OpensearchOperation::WriteEmailDocuments;
    let version = external_version(version, operation)?;

    let mut body = Vec::with_capacity(documents.len() * 2 + deletes.len());
    for document in documents {
        let id = email_document_id(&document.thread_id, &document.message_id);
        body.push(fenced_action("index", &id, version).to_string());
        body.push(serde_json::to_string(document).map_err(serialization_error)?);
    }
    for delete in deletes {
        body.push(fenced_action("delete", &delete.document_id(), version).to_string());
    }

    let index = index_override.unwrap_or(SearchIndex::Emails.as_ref());
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(operation, &err))?;
    let status = response.status_code().as_u16();
    let text = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(operation, &err))?;

    let items = super::classify_versioned_bulk_response(status, &text, operation)?;
    Ok(EmailWrites {
        indexed: items.indexed,
        deleted: items.deleted,
        refused_stale: items.refused_stale,
    })
}

fn fenced_action(action: &str, id: &str, version: i64) -> serde_json::Value {
    serde_json::json!({ action: {
        "_id": id,
        "version": version,
        "version_type": "external_gte",
    } })
}
