pub mod agent_session;
pub mod calendar_event;
pub mod call_record;
pub mod channel_message;
pub mod chat_message;
pub mod document;
pub mod email;
pub mod project;
pub mod properties;

use crate::error::{OpensearchClientError, OpensearchOperation, write_refusal};

/// How many distinct item errors a [`OpensearchClientError::BulkItemsFailed`]
/// keeps, so a bulk whose every item fails one way logs it once.
pub(crate) const REPORTED_ITEM_ERRORS: usize = 5;

/// Result of a bulk upsert whose every item OpenSearch wrote.
#[derive(Debug, Default)]
pub struct BulkUpsertResult {
    /// Number of documents written
    pub successful: usize,
}

/// The items of a `_bulk` answer, or the error a failed request is. A refused
/// request or item is a [`crate::error::WriteRefusal`] the caller can back
/// off on.
fn bulk_items(
    status: u16,
    body: &str,
    operation: OpensearchOperation,
) -> crate::Result<Vec<serde_json::Value>> {
    let parsed = serde_json::from_str::<serde_json::Value>(body);

    if !(200..300).contains(&status) {
        // A refusal from a proxy in front of OpenSearch has no JSON body.
        let error = parsed
            .map(|value| value["error"].clone())
            .unwrap_or_default();
        if let Some(cause) = write_refusal(status, &error) {
            return Err(OpensearchClientError::WritesRefused {
                details: body.to_owned(),
                cause,
                operation,
            });
        }
        tracing::error!(status, body, "bulk upsert failed");
        return Err(OpensearchClientError::Unknown {
            details: body.to_owned(),
            operation,
        });
    }

    let mut response = parsed.map_err(|error| OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        operation,
    })?;
    // A success without per-item results acknowledges nothing.
    match response["items"].take() {
        serde_json::Value::Array(items) => Ok(items),
        _ => Err(OpensearchClientError::DeserializationFailed {
            details: "bulk response has no items array".to_owned(),
            operation,
        }),
    }
}

/// One item of a `_bulk` answer: its action (`index`, `create`, `update` or
/// `delete`), status and result.
struct BulkItem<'a> {
    action: &'a str,
    status: u16,
    result: &'a serde_json::Value,
}

fn bulk_item(item: &serde_json::Value) -> Option<BulkItem<'_>> {
    let (action, result) = item.as_object()?.iter().next()?;
    let status = result["status"]
        .as_u64()
        .and_then(|status| u16::try_from(status).ok())
        .unwrap_or_default();
    Some(BulkItem {
        action,
        status,
        result,
    })
}

/// The failed items of a `_bulk` answer, kept to fail the call with.
#[derive(Default)]
struct FailedItems {
    failed: usize,
    refusal: Option<crate::error::WriteRefusal>,
    errors: Vec<String>,
}

impl FailedItems {
    fn record(&mut self, item: Option<&BulkItem<'_>>) {
        self.failed += 1;
        let Some(item) = item else {
            return;
        };
        let error = &item.result["error"];
        self.refusal = self.refusal.or(write_refusal(item.status, error));
        let described = format!(
            "{}: {}",
            error["type"].as_str().unwrap_or("unknown"),
            error["reason"].as_str().unwrap_or_default()
        );
        if self.errors.len() < REPORTED_ITEM_ERRORS && !self.errors.contains(&described) {
            self.errors.push(described);
        }
    }

    /// Any failed item fails the call: the request's work is not done.
    fn into_result(self, total: usize, operation: OpensearchOperation) -> crate::Result<()> {
        if self.failed == 0 {
            return Ok(());
        }
        Err(OpensearchClientError::BulkItemsFailed {
            failed: self.failed,
            total,
            refusal: self.refusal,
            errors: self.errors,
            operation,
        })
    }
}

/// Classify a `_bulk` answer. OpenSearch answers 200 while failing items, for
/// a full write queue (429) as for a mapping error, so any failed item fails
/// the call: the request's work is not done.
pub(crate) fn classify_bulk_response(
    status: u16,
    body: &str,
    operation: OpensearchOperation,
) -> crate::Result<BulkUpsertResult> {
    let items = bulk_items(status, body, operation)?;
    let mut successful = 0;
    let mut failed = FailedItems::default();
    for item in &items {
        let item = bulk_item(item);
        match &item {
            Some(item) if (200..300).contains(&item.status) => successful += 1,
            _ => failed.record(item.as_ref()),
        }
    }
    failed.into_result(items.len(), operation)?;
    Ok(BulkUpsertResult { successful })
}

/// Result of a versioned `_bulk` whose every item either applied or was
/// refused as stale.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct VersionedBulkResult {
    /// Documents written.
    pub(crate) indexed: usize,
    /// Documents deleted, or already absent.
    pub(crate) deleted: usize,
    /// Actions refused because the document holds a later version.
    pub(crate) refused_stale: usize,
}

/// Classify the answer to a `_bulk` of `external_gte` versioned actions. A
/// version conflict (409) is a stale action the index refused, which is
/// neither a failure nor a write; a delete of a document that is not there
/// (404 `not_found`) leaves it absent, which is what it asked for. Any other
/// failed item fails the call, as in [`classify_bulk_response`].
pub(crate) fn classify_versioned_bulk_response(
    status: u16,
    body: &str,
    operation: OpensearchOperation,
) -> crate::Result<VersionedBulkResult> {
    let items = bulk_items(status, body, operation)?;
    let mut result = VersionedBulkResult::default();
    let mut failed = FailedItems::default();
    for item in &items {
        let item = bulk_item(item);
        let Some(applied) = &item else {
            failed.record(None);
            continue;
        };
        let is_delete = applied.action == "delete";
        let not_found = applied.status == 404 && applied.result["result"] == "not_found";
        let stale = applied.status == 409
            && applied.result["error"]["type"] == "version_conflict_engine_exception";
        if stale {
            result.refused_stale += 1;
        } else if is_delete && ((200..300).contains(&applied.status) || not_found) {
            result.deleted += 1;
        } else if !is_delete && (200..300).contains(&applied.status) {
            result.indexed += 1;
        } else {
            failed.record(item.as_ref());
        }
    }
    failed.into_result(items.len(), operation)?;
    Ok(result)
}

pub(crate) async fn bulk_upsert_to_index(
    client: &opensearch::OpenSearch,
    index: &str,
    bulk_body: Vec<String>,
    operation: OpensearchOperation,
) -> crate::Result<BulkUpsertResult> {
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
        .body(bulk_body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(operation, &err))?;

    let status = response.status_code().as_u16();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(operation, &err))?;

    classify_bulk_response(status, &body, operation)
}

#[cfg(test)]
mod test;
