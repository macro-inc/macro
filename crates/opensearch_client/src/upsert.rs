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

/// Classify a `_bulk` answer. OpenSearch answers 200 while failing items, for
/// a full write queue (429) as for a mapping error, so any failed item fails
/// the call: the request's work is not done. A refused request or item is a
/// [`crate::error::WriteRefusal`] the caller can back off on.
pub(crate) fn classify_bulk_response(
    status: u16,
    body: &str,
    operation: OpensearchOperation,
) -> crate::Result<BulkUpsertResult> {
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

    let response = parsed.map_err(|error| OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        operation,
    })?;
    // A success without per-item results acknowledges nothing.
    let items = response["items"].as_array().ok_or_else(|| {
        OpensearchClientError::DeserializationFailed {
            details: "bulk response has no items array".to_owned(),
            operation,
        }
    })?;

    let mut successful = 0;
    let mut failed = 0;
    let mut refusal = None;
    let mut errors: Vec<String> = Vec::new();
    for item in items {
        // Each item is keyed by its action: `index`, `create`, `update` or `delete`.
        let Some(result) = item.as_object().and_then(|item| item.values().next()) else {
            failed += 1;
            continue;
        };
        let status = result["status"]
            .as_u64()
            .and_then(|status| u16::try_from(status).ok())
            .unwrap_or_default();
        if (200..300).contains(&status) {
            successful += 1;
            continue;
        }
        failed += 1;
        let error = &result["error"];
        refusal = refusal.or(write_refusal(status, error));
        let described = format!(
            "{}: {}",
            error["type"].as_str().unwrap_or("unknown"),
            error["reason"].as_str().unwrap_or_default()
        );
        if errors.len() < REPORTED_ITEM_ERRORS && !errors.contains(&described) {
            errors.push(described);
        }
    }

    if failed > 0 {
        return Err(OpensearchClientError::BulkItemsFailed {
            failed,
            total: items.len(),
            refusal,
            errors,
            operation,
        });
    }
    Ok(BulkUpsertResult { successful })
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
