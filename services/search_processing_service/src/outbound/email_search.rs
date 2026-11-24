//! OpenSearch adapter for the email indexing port: versioned writes and the
//! search for a message's documents under other threads.

use std::sync::Arc;

use chrono::Utc;
use opensearch_client::{
    OpensearchClient,
    date_format::EpochMillis,
    error::OpensearchClientError,
    upsert::{
        email::{self as index_email, UpsertEmailArgs},
        properties::IndexedProperty,
    },
};
use opentelemetry::{KeyValue, metrics::Counter};
use rootcause::Report;
use uuid::Uuid;

use crate::domain::{
    email_index::{
        EmailDocument, EmailDocumentKey, EmailSearchIndex, EmailWriter, EmailWrites,
        IndexWriteError,
    },
    fence::ProjectionVersion,
};

const METER_NAME: &str = "search_processing_service";
pub const REFUSED_STALE: &str = "search.index.refused_stale";

pub struct OpenSearchEmailIndex {
    client: Arc<OpensearchClient>,
    refused: Counter<u64>,
}

impl OpenSearchEmailIndex {
    pub fn new(client: Arc<OpensearchClient>) -> Self {
        Self {
            client,
            refused: opentelemetry::global::meter(METER_NAME)
                .u64_counter(REFUSED_STALE)
                .with_description(
                    "Index writes refused because the document holds a later writer's version",
                )
                .build(),
        }
    }
}

/// Builds the search document for a message. A message without a From contact
/// is indexed with an empty sender so its content stays searchable.
fn document_args(document: EmailDocument, now_millis: EpochMillis) -> UpsertEmailArgs {
    let EmailDocument {
        message,
        content,
        thread,
    } = document;
    let sent_at_millis = message
        .internal_date_ts
        .and_then(|date| EpochMillis::plausible(date.timestamp_millis()));

    UpsertEmailArgs {
        message_id: message.db_id.to_string(),
        link_id: message.link_id.to_string(),
        user_id: thread.owner,
        thread_id: message.thread_db_id.to_string(),
        subject: message.subject,
        sender: message
            .from
            .as_ref()
            .map(|f| f.email.to_lowercase())
            .unwrap_or_default(),
        sender_name: message.from.as_ref().and_then(|f| f.name.clone()),
        reply_to: message.reply_to.map(|r| r.to_lowercase()),
        recipients: message
            .to
            .iter()
            .map(|to| to.email.to_lowercase())
            .collect(),
        recipient_names: message.to.iter().filter_map(|to| to.name.clone()).collect(),
        cc: message
            .cc
            .iter()
            .map(|cc| cc.email.to_lowercase())
            .collect(),
        cc_names: message.cc.iter().filter_map(|cc| cc.name.clone()).collect(),
        bcc: message
            .bcc
            .iter()
            .map(|bcc| bcc.email.to_lowercase())
            .collect(),
        bcc_names: message
            .bcc
            .iter()
            .filter_map(|bcc| bcc.name.clone())
            .collect(),
        labels: message
            .labels
            .iter()
            .map(|label| label.name.clone())
            .collect(),
        content,
        updated_at_millis: sent_at_millis.unwrap_or(now_millis),
        sent_at_millis,
        // A full index overwrites the document, so the thread's properties
        // ride along or a reindex would drop them.
        properties: thread
            .properties
            .into_iter()
            .map(|property| IndexedProperty {
                definition_id: property.definition_id,
                values: property.values,
                number_value: property.number_value,
                date_value: property.date_value,
            })
            .collect(),
    }
}

fn index_key(key: EmailDocumentKey) -> index_email::EmailDocumentKey {
    index_email::EmailDocumentKey {
        thread_id: key.thread_id.to_string(),
        message_id: key.message_id.to_string(),
    }
}

/// Items failed inside an applied request leave the rest written; anything
/// else, a refusal included, means the write cannot be told to have applied.
fn write_error(error: OpensearchClientError) -> IndexWriteError {
    let items_failed = error.failed_items() > 0 && error.refusal().is_none();
    let report = Report::new(error).into_dynamic();
    if items_failed {
        IndexWriteError::ItemsFailed(report)
    } else {
        IndexWriteError::Failed(report)
    }
}

impl EmailSearchIndex for OpenSearchEmailIndex {
    async fn write(
        &self,
        version: ProjectionVersion,
        documents: Vec<EmailDocument>,
        deletes: Vec<EmailDocumentKey>,
        index_override: Option<&str>,
        writer: EmailWriter,
    ) -> Result<EmailWrites, IndexWriteError> {
        let now_millis = EpochMillis::new(Utc::now().timestamp_millis())
            .map_err(|error| IndexWriteError::Failed(Report::new(error).into_dynamic()))?;
        let documents: Vec<UpsertEmailArgs> = documents
            .into_iter()
            .map(|document| document_args(document, now_millis))
            .collect();
        let deletes: Vec<index_email::EmailDocumentKey> =
            deletes.into_iter().map(index_key).collect();

        let writes = self
            .client
            .write_email_documents(version.get(), &documents, &deletes, index_override)
            .await
            .map_err(write_error)?;
        if writes.refused_stale > 0 {
            self.refused.add(
                u64::try_from(writes.refused_stale).unwrap_or(u64::MAX),
                &[
                    KeyValue::new("entity_type", "email"),
                    KeyValue::new("writer", <&'static str>::from(writer)),
                ],
            );
        }
        Ok(EmailWrites {
            indexed: writes.indexed,
            deleted: writes.deleted,
            refused_stale: writes.refused_stale,
        })
    }

    async fn message_documents(
        &self,
        message_ids: &[Uuid],
        keep_thread_ids: &[Uuid],
        index_override: Option<&str>,
    ) -> Result<Vec<EmailDocumentKey>, Report> {
        let message_ids: Vec<String> = message_ids.iter().map(Uuid::to_string).collect();
        let keep: Vec<String> = keep_thread_ids.iter().map(Uuid::to_string).collect();
        let found = self
            .client
            .email_message_documents(&message_ids, &keep, index_override)
            .await?;
        Ok(found
            .into_iter()
            .filter_map(|key| {
                let parsed = Uuid::parse_str(&key.thread_id)
                    .and_then(|thread_id| Ok((thread_id, Uuid::parse_str(&key.message_id)?)));
                match parsed {
                    Ok((thread_id, message_id)) => Some(EmailDocumentKey {
                        thread_id,
                        message_id,
                    }),
                    Err(error) => {
                        tracing::warn!(error = %error, "an email document is keyed by a non-uuid id");
                        None
                    }
                }
            })
            .collect())
    }
}
