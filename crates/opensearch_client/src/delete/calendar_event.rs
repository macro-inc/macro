use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
};

/// Deletes a calendar event doc by id. The calendar events index is flat with
/// `_id` = event id, so this is a direct delete. A missing-doc 404 is a no-op
/// — the event was never indexed or is already gone. A missing-index 404
/// (`index_not_found_exception`) is a real outage and must propagate.
#[tracing::instrument(skip(client))]
pub async fn delete_calendar_event_by_id(
    client: &opensearch::OpenSearch,
    event_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::CalendarEvents.as_ref());
    let response = client
        .delete(opensearch::DeleteParts::IndexId(index, event_id))
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(
                OpensearchOperation::DeleteCalendarEventById,
                &err,
            )
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        return Ok(());
    }

    let body = response.text().await.map_err(|err| {
        OpensearchClientError::deserialization_failed(
            OpensearchOperation::DeleteCalendarEventById,
            &err,
        )
    })?;

    if status_code.as_u16() == 404 {
        let result = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["result"].as_str().map(str::to_owned));
        if result.as_deref() == Some("not_found") {
            tracing::debug!(event_id=%event_id, "calendar event not indexed; nothing to delete");
            return Ok(());
        }
    }

    tracing::error!(
        status_code = ?status_code,
        body = ?body,
        "error deleting calendar event by id"
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        operation: OpensearchOperation::DeleteCalendarEventById,
    })
}
