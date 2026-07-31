#[cfg(test)]
mod test;

use documents_hex::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use macro_event_broker::{EventBrokerError, MacroEventBroker};

/// Schedules a document-purged event for asynchronous broker delivery.
#[tracing::instrument(skip(event_broker), err)]
pub(crate) fn publish_document_purged_event<B: MacroEventBroker>(
    event_broker: &B,
    document_id: &str,
) -> Result<(), EventBrokerError> {
    let document_id = document_id.to_owned();
    let event =
        DocumentMacroEvent::purged(document_id.clone(), DocumentPurgedMetadata { document_id });

    drop(event_broker.send_event(&event)?);
    Ok(())
}
