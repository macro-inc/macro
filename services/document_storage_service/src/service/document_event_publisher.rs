#[cfg(test)]
mod test;

use documents_hex::domain::events::{DocumentMacroEvent, DocumentPurgedMetadata};
use macro_event_broker::{EventBrokerError, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;

/// Schedules a document-purged event for asynchronous broker delivery. `audience`
/// is who had access before the purge removed it.
#[tracing::instrument(skip(event_broker, audience), fields(audience_count = audience.len()), err)]
pub(crate) fn publish_document_purged_event<B: MacroEventBroker>(
    event_broker: &B,
    document_id: &str,
    audience: Vec<MacroUserIdStr<'static>>,
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
