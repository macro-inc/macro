use models_email::gmail::{HistoryListResponse, HistoryRecord};

use crate::domain::models::{ChangeBatch, InboxChanges, SyncCursor};

pub(crate) fn map_history_list_response_to_changes(response: HistoryListResponse) -> ChangeBatch {
    let mut changes = InboxChanges::default();

    for record in response.history.unwrap_or_default() {
        apply_history_record(&mut changes, &record);
    }

    ChangeBatch::new(changes, SyncCursor::gmail(response.history_id))
}

fn apply_history_record(changes: &mut InboxChanges, record: &HistoryRecord) {
    for message in record.messages.iter().flatten() {
        let explicitly_handled = record
            .messages_added
            .iter()
            .flatten()
            .any(|item| item.message.id == message.id)
            || record
                .messages_deleted
                .iter()
                .flatten()
                .any(|item| item.message.id == message.id)
            || record
                .labels_added
                .iter()
                .flatten()
                .any(|item| item.message.id == message.id)
            || record
                .labels_removed
                .iter()
                .flatten()
                .any(|item| item.message.id == message.id);

        if !explicitly_handled && !changes.message_ids_to_delete.contains(&message.id) {
            mark_for_upsert(changes, &message.id);
        }
    }

    for added in record.messages_added.iter().flatten() {
        if !changes.message_ids_to_delete.contains(&added.message.id) {
            mark_for_upsert(changes, &added.message.id);
        }
    }

    for deleted in record.messages_deleted.iter().flatten() {
        changes
            .message_ids_to_delete
            .insert(deleted.message.id.clone());
        changes.message_ids_to_upsert.remove(&deleted.message.id);
        changes.labels_to_update.remove(&deleted.message.id);
    }

    for message_id in record
        .labels_added
        .iter()
        .flatten()
        .map(|item| &item.message.id)
        .chain(
            record
                .labels_removed
                .iter()
                .flatten()
                .map(|item| &item.message.id),
        )
    {
        if !changes.message_ids_to_upsert.contains(message_id)
            && !changes.message_ids_to_delete.contains(message_id)
        {
            changes.labels_to_update.insert(message_id.clone());
        }
    }
}

fn mark_for_upsert(changes: &mut InboxChanges, message_id: &str) {
    changes.message_ids_to_upsert.insert(message_id.to_owned());
    changes.labels_to_update.remove(message_id);
}

#[cfg(test)]
mod test;
