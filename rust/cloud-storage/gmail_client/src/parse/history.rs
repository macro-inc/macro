use models_email::gmail;
use std::collections::HashSet;

pub fn map_history_list_response_to_history(
    response: gmail::HistoryListResponse,
) -> gmail::history::InboxChanges {
    let mut message_ids_to_upsert: HashSet<String> = HashSet::new();
    let mut message_ids_to_delete: HashSet<String> = HashSet::new();
    let mut labels_to_update: HashSet<String> = HashSet::new();

    // in summary: if a message needs to be upserted or deleted, we don't need to worry about updating
    // labels for it. if a message is in the "messages" list but no other lists, we need to upsert it.
    if let Some(history_records) = response.history {
        for history_record in history_records {
            // if the record has a message in the messages attribute that isn't in any of the other attributes,
            // this mean _something_ changed about the message, so we have to upsert it. add it to
            // message_ids_to_upsert to perform a full refresh of the message.
            if let Some(messages) = &history_record.messages {
                for m_item in messages {
                    let is_explicitly_handled_in_record = history_record
                        .messages_added
                        .as_ref()
                        .is_some_and(|msgs| msgs.iter().any(|x| x.message.id == m_item.id))
                        || history_record
                            .messages_deleted
                            .as_ref()
                            .is_some_and(|msgs| msgs.iter().any(|x| x.message.id == m_item.id))
                        || history_record
                            .labels_added
                            .as_ref()
                            .is_some_and(|labels| labels.iter().any(|x| x.message.id == m_item.id))
                        || history_record
                            .labels_removed
                            .as_ref()
                            .is_some_and(|labels| labels.iter().any(|x| x.message.id == m_item.id));

                    if !is_explicitly_handled_in_record
                        && !message_ids_to_delete.contains(&m_item.id)
                    {
                        message_ids_to_upsert.insert(m_item.id.clone());
                        labels_to_update.remove(&m_item.id);
                    }
                }
            }

            // if the record has message(s) in the messages_added attribute, that we aren't deleting already
            // add them to message_ids_to_upsert, and wipe labels_to_add and labels_to_remove
            if let Some(messages_added) = &history_record.messages_added {
                for message in messages_added {
                    if !message_ids_to_delete.contains(&message.message.id) {
                        message_ids_to_upsert.insert(message.message.id.clone());
                        labels_to_update.remove(&message.message.id);
                    }
                }
            }

            // if the record has message(s) in the messages_deleted attribute, add them to message_ids_to_delete
            // and wipe the other lists
            if let Some(messages_deleted) = &history_record.messages_deleted {
                for message in messages_deleted {
                    message_ids_to_delete.insert(message.message.id.clone());
                    message_ids_to_upsert.remove(&message.message.id);
                    labels_to_update.remove(&message.message.id);
                }
            }

            if let Some(labels_added) = &history_record.labels_added {
                for label_added in labels_added {
                    let msg_id = &label_added.message.id;
                    // ignore if we are already upserting/deleting/updating labels for the message
                    if !message_ids_to_upsert.contains(msg_id)
                        && !message_ids_to_delete.contains(msg_id)
                        && !labels_to_update.contains(msg_id)
                    {
                        labels_to_update.insert(msg_id.clone());
                    }
                }
            }

            if let Some(labels_removed) = &history_record.labels_removed {
                for label_removed in labels_removed {
                    let msg_id = &label_removed.message.id;
                    // ignore if we are already upserting/deleting/updating labels for the message
                    if !message_ids_to_upsert.contains(msg_id)
                        && !message_ids_to_delete.contains(msg_id)
                        && !labels_to_update.contains(msg_id)
                    {
                        labels_to_update.insert(msg_id.clone());
                    }
                }
            }
        }
    }

    gmail::history::InboxChanges {
        message_ids_to_upsert,
        message_ids_to_delete,
        labels_to_update,
        current_history_id: response.history_id,
    }
}
