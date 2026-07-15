use std::collections::BTreeSet;

use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use super::properties::IndexedProperty;
use crate::{
    Result,
    date_format::{EpochMillis, EpochSeconds},
    error::OpensearchClientError,
};

#[cfg(test)]
mod test;

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
    /// The updated at time of the email message
    pub updated_at_seconds: EpochSeconds,
    /// The updated at time of the email message, in milliseconds
    pub updated_at_millis: EpochMillis,
    /// The subject of the email message
    pub subject: Option<String>,
    /// The sent at time of the email message
    pub sent_at_seconds: Option<EpochSeconds>,
    /// The sent at time of the email message, in milliseconds
    pub sent_at_millis: Option<EpochMillis>,
    /// The content of the email message
    pub content: String,
    /// Denormalized thread properties (e.g. tags) used for search filtering.
    /// Thread-level, so identical across every message doc of the thread.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<IndexedProperty>,
}

/// Derived search tokens for an email's address fields. Domains carry their
/// dot-suffixes with at least two labels (`x@mail.foo.com` yields
/// `mail.foo.com` and `foo.com`), local parts carry their dot/plus segments
/// (`jane.doe` yields `jane` and `doe` too). Everything is
/// lowercased; addresses without a non-empty local part and domain are
/// skipped.
fn address_search_fields<'a>(
    addresses: impl IntoIterator<Item = &'a str>,
) -> (Vec<String>, Vec<String>) {
    let mut domains = BTreeSet::new();
    let mut local_parts = BTreeSet::new();
    for address in addresses {
        let address = address.trim().to_lowercase();
        let Some((local, domain)) = address.rsplit_once('@') else {
            continue;
        };
        if local.is_empty() || domain.is_empty() {
            continue;
        }
        local_parts.insert(local.to_string());
        for segment in local.split(['.', '+']).filter(|s| !s.is_empty()) {
            local_parts.insert(segment.to_string());
        }
        let labels: Vec<&str> = domain.split('.').filter(|l| !l.is_empty()).collect();
        if labels.len() <= 1 {
            domains.extend(labels.iter().map(|l| l.to_string()));
        } else {
            for start in 0..labels.len() - 1 {
                domains.insert(labels[start..].join("."));
            }
        }
    }
    (
        domains.into_iter().collect(),
        local_parts.into_iter().collect(),
    )
}

/// Serializes the upsert args and injects the derived `domains` and
/// `local_parts` fields so every write path indexes them.
fn to_index_document(args: &UpsertEmailArgs) -> Result<serde_json::Value> {
    let mut doc =
        serde_json::to_value(args).map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("to_index_document".to_string()),
        })?;
    let addresses = std::iter::once(args.sender.as_str())
        .chain(args.reply_to.as_deref())
        .chain(args.recipients.iter().map(String::as_str))
        .chain(args.cc.iter().map(String::as_str))
        .chain(args.bcc.iter().map(String::as_str));
    let (domains, local_parts) = address_search_fields(addresses);
    let map = doc
        .as_object_mut()
        .ok_or_else(|| OpensearchClientError::DeserializationFailed {
            details: "UpsertEmailArgs did not serialize to an object".to_string(),
            method: Some("to_index_document".to_string()),
        })?;
    map.insert("domains".to_string(), serde_json::json!(domains));
    map.insert("local_parts".to_string(), serde_json::json!(local_parts));
    Ok(doc)
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_email_message(
    client: &opensearch::OpenSearch,
    args: &UpsertEmailArgs,
) -> Result<()> {
    let id = format!("{}:{}", args.thread_id, args.message_id);
    let doc = to_index_document(args)?;
    let response = client
        .index(opensearch::IndexParts::IndexId(
            SearchIndex::Emails.as_ref(),
            &id,
        ))
        .body(&doc)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_email_message".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "email message upserted successfully");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_email_message".to_string()),
                })?;

        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting email message",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_email_message".to_string()),
        });
    }
    Ok(())
}

#[tracing::instrument(skip(client, messages), err)]
pub(crate) async fn bulk_upsert_email_messages(
    client: &opensearch::OpenSearch,
    messages: &[UpsertEmailArgs],
    index_override: Option<&str>,
) -> Result<BulkUpsertResult> {
    if messages.is_empty() {
        return Ok(BulkUpsertResult::default());
    }

    let mut bulk_body = Vec::new();

    for msg in messages {
        let id = format!("{}:{}", msg.thread_id, msg.message_id);

        let action = serde_json::json!({
            "index": {
                "_id": id
            }
        });

        bulk_body.push(action.to_string());
        bulk_body.push(to_index_document(msg)?.to_string());
    }

    let index = index_override.unwrap_or(SearchIndex::Emails.as_ref());

    super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_email_messages").await
}

/// Update only the denormalized `properties` on every message doc of a
/// thread, without touching content. The emails index is flat (one doc per
/// message sharing the thread's `entity_id`), so this is an update-by-query
/// rather than a single-doc update. Zero matched docs is a no-op — the
/// thread isn't indexed yet, so the next full index will include the
/// properties. Version conflicts proceed: a concurrent full reindex writes
/// the same freshly-fetched values.
pub(crate) async fn update_email_thread_properties(
    client: &opensearch::OpenSearch,
    thread_id: &str,
    properties: &[IndexedProperty],
) -> Result<()> {
    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("update_email_thread_properties".to_string()),
        })?;
    let body = serde_json::json!({
        "query": { "term": { "entity_id": thread_id } },
        "script": {
            "source": "ctx._source.properties = params.properties",
            "lang": "painless",
            "params": { "properties": properties_value }
        }
    });

    let response = client
        .update_by_query(opensearch::UpdateByQueryParts::Index(&[
            SearchIndex::Emails.as_ref(),
        ]))
        .conflicts(opensearch::params::Conflicts::Proceed)
        .refresh(true) // Ensure the index reflects changes immediately
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_email_thread_properties".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        // A 200 can still carry per-document failures in the body.
        let body: serde_json::Value =
            response
                .json()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_email_thread_properties".to_string()),
                })?;
        if let Some(failures) = body.get("failures").and_then(|f| f.as_array())
            && !failures.is_empty()
        {
            tracing::error!(
                thread_id=%thread_id,
                failures=?failures,
                "update_by_query reported failures updating email thread properties",
            );
            return Err(OpensearchClientError::Unknown {
                details: format!("update_by_query failures: {failures:?}"),
                method: Some("update_email_thread_properties".to_string()),
            });
        }
        tracing::trace!(thread_id=%thread_id, "email thread properties updated");
        return Ok(());
    }
    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_email_thread_properties".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        thread_id=%thread_id,
        "error updating email thread properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_email_thread_properties".to_string()),
    })
}
