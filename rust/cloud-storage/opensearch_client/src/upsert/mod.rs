pub mod channel_message;
pub mod chat_message;
pub mod document;
pub mod email;

use crate::error::OpensearchClientError;

/// Result of a bulk upsert operation
#[derive(Debug, Default)]
pub struct BulkUpsertResult {
    /// Number of successfully upserted documents
    pub successful: usize,
    /// Number of failed documents
    pub failed: usize,
    /// Number of version conflicts
    pub version_conflicts: usize,
    /// Error messages from failed documents
    pub errors: Vec<String>,
}

pub(crate) fn parse_bulk_response(response: &serde_json::Value) -> BulkUpsertResult {
    let mut result = BulkUpsertResult::default();

    if let Some(items) = response["items"].as_array() {
        for item in items {
            if let Some(index_result) = item["index"].as_object()
                && let Some(status) = index_result["status"].as_u64()
            {
                match status {
                    200..=299 => result.successful += 1,
                    409 => {
                        result.version_conflicts += 1;
                        result.failed += 1;
                        if let Some(error) = index_result["error"].as_object()
                            && let Some(reason) = error["reason"].as_str()
                        {
                            result.errors.push(reason.to_string());
                        }
                    }
                    _ => {
                        result.failed += 1;
                        if let Some(error) = index_result["error"].as_object()
                            && let Some(reason) = error["reason"].as_str()
                        {
                            result.errors.push(reason.to_string());
                        }
                    }
                }
            }
        }
    }

    result
}

pub(crate) async fn bulk_upsert_to_index(
    client: &opensearch::OpenSearch,
    index: &str,
    bulk_body: Vec<String>,
    method_name: &str,
) -> crate::Result<BulkUpsertResult> {
    let response = client
        .bulk(opensearch::BulkParts::Index(index))
        .body(bulk_body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some(method_name.to_string()),
        })?;

    let status_code = response.status_code();
    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some(method_name.to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            "bulk upsert failed"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some(method_name.to_string()),
        });
    }

    let response_body: serde_json::Value =
        response
            .json()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some(method_name.to_string()),
            })?;

    Ok(parse_bulk_response(&response_body))
}
