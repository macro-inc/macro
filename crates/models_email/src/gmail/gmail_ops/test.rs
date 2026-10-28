use super::*;

#[test]
fn chunked_label_writes_fit_one_gmail_request_each() {
    let messages: Vec<GmailMessageRef> = (0..2001)
        .map(|index| GmailMessageRef {
            db_message_id: Uuid::from_u128(index),
            provider_message_id: format!("message-{index}"),
        })
        .collect();

    let payloads =
        ModifyMessageLabelsBatchPayload::chunked(messages.clone(), vec![], vec!["INBOX".into()]);

    assert_eq!(
        payloads
            .iter()
            .map(|payload| payload.messages.len())
            .collect::<Vec<_>>(),
        vec![1000, 1000, 1]
    );
    assert!(
        payloads
            .iter()
            .all(|payload| payload.labels_to_add.is_empty()
                && payload.labels_to_remove == vec!["INBOX".to_string()])
    );
    assert_eq!(
        payloads
            .into_iter()
            .flat_map(|payload| payload.messages)
            .collect::<Vec<_>>(),
        messages
    );
}

#[test]
fn chunked_label_writes_without_messages_enqueue_nothing() {
    assert!(
        ModifyMessageLabelsBatchPayload::chunked(vec![], vec!["TRASH".into()], vec![]).is_empty()
    );
}
