use super::*;

#[test]
fn chunked_label_writes_fit_one_gmail_request_each() {
    let messages: Vec<GmailMessageRef> = (0..2001)
        .map(|index| GmailMessageRef {
            db_message_id: Uuid::from_u128(index),
            provider_message_id: format!("message-{index}"),
        })
        .collect();

    let write_id = Uuid::from_u128(7);
    let payloads = ModifyMessageLabelsBatchPayload::chunked(
        messages.clone(),
        vec![],
        vec!["INBOX".into()],
        write_id,
    );

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
                && payload.labels_to_remove == vec!["INBOX".to_string()]
                && payload.pending_write_id == Some(write_id))
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
        ModifyMessageLabelsBatchPayload::chunked(
            vec![],
            vec!["TRASH".into()],
            vec![],
            Uuid::from_u128(7)
        )
        .is_empty()
    );
}

#[test]
fn single_message_operations_keep_their_pending_write_as_a_batch() {
    let queued: GmailOpsPubsubMessage = serde_json::from_str(
        r#"{
            "linkId": "00000000-0000-0000-0000-000000000001",
            "operation": {"modify_message_labels": {
                "dbMessageId": "00000000-0000-0000-0000-000000000002",
                "providerMessageId": "message-2",
                "labelsToAdd": [],
                "labelsToRemove": ["INBOX"],
                "pendingWriteId": "00000000-0000-0000-0000-000000000007"
            }}
        }"#,
    )
    .unwrap();
    let GmailOpsOperation::ModifyMessageLabels(payload) = queued.operation else {
        panic!("expected a single-message label write");
    };

    let batch = ModifyMessageLabelsBatchPayload::from(payload);

    assert_eq!(batch.pending_write_id, Some(Uuid::from_u128(7)));
    assert_eq!(
        batch.messages,
        vec![GmailMessageRef {
            db_message_id: Uuid::from_u128(2),
            provider_message_id: "message-2".to_string(),
        }]
    );
}

#[test]
fn label_writes_queued_before_markers_still_decode() {
    let queued: GmailOpsPubsubMessage = serde_json::from_str(
        r#"{
            "linkId": "00000000-0000-0000-0000-000000000001",
            "operation": {"modify_message_labels_batch": {
                "messages": [{"dbMessageId": "00000000-0000-0000-0000-000000000002", "providerMessageId": "message-2"}],
                "labelsToAdd": ["TRASH"],
                "labelsToRemove": []
            }}
        }"#,
    )
    .unwrap();
    let GmailOpsOperation::ModifyMessageLabelsBatch(batch) = queued.operation else {
        panic!("expected a batched label write");
    };

    assert_eq!(batch.pending_write_id, None);
}

#[test]
fn debug_shows_the_operation_but_no_blocked_address() {
    let link_id = Uuid::from_u128(0x0195_f0a6_8a0e_7cc2_8f39_6f0b_5d6a_2e10);
    let block = GmailOpsPubsubMessage {
        link_id,
        operation: GmailOpsOperation::BlockSender(BlockSenderPayload {
            email_address: "sender@example.com".to_owned(),
        }),
    };
    let unblock = GmailOpsPubsubMessage {
        link_id,
        operation: GmailOpsOperation::UnblockSender(UnblockSenderPayload {
            email_address: "sender@example.com".to_owned(),
        }),
    };

    for message in [block, unblock] {
        let debug = format!("{message:?}");

        assert!(debug.contains("0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10"));
        assert!(debug.contains("Sender"));
        assert!(!debug.contains("example.com"));
    }
}
