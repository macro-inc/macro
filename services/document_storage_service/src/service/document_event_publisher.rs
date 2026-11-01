#[cfg(test)]
mod test;

use documents_hex::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use entity_access::domain::models::EntityAccessSource;
use macro_event_broker::{EventBrokerError, MacroEventBroker};

/// Schedules a document-purged event for asynchronous broker delivery. `audience`
/// is the document's grants before the purge removed them.
#[tracing::instrument(skip(event_broker, audience), fields(audience_count = audience.len()), err)]
pub(crate) fn publish_document_purged_event<B: MacroEventBroker>(
    event_broker: &B,
    document_id: &str,
    audience: Vec<EntityAccessSource>,
) -> Result<(), EventBrokerError> {
    let document_id = document_id.to_owned();
    let event = DocumentMacroEvent::purged(
        document_id.clone(),
        DocumentPurgedMetadata {
            document_id,
            audience,
        },
    );

    drop(event_broker.send_event(&event)?);
    Ok(())
}
