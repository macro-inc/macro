use super::*;

fn pending() -> Vec<Value> {
    let status = serde_json::to_vec(&OperationArchive::Incomplete { attribution: None }).unwrap();
    vec![
        json!({"port":"storage.transaction","args":[],"transaction":0}),
        json!({"port":"storage.transaction.begin","args":[],"transaction":0,"attempt":0}),
        json!({"port":"storage.transaction.put","args":["o/!archive-status-v1/test",status],"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction.put","value":{"undefined":true},"transaction":0,"attempt":0}),
        json!({"port":"storage.transaction.put","args":["o/test",[0,255]],"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction.put","value":{"undefined":true},"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction","value":null,"transaction":0}),
    ]
}

#[test]
fn committed_pending_plan_is_atomic_and_preserves_exact_bytes() {
    let rows = pending();
    let projected = project(&rows.iter().collect::<Vec<_>>()).unwrap();
    assert_eq!(projected.len(), 1);
    assert_eq!(projected[0]["port"], "storage.pending.put");
    assert_eq!(projected[0]["args"][1], json!([0, 255]));
    assert_eq!(projected[0]["args"][2], rows[2]["args"][1]);
}

#[test]
fn malformed_or_orphan_transaction_events_fail_closed() {
    for mutation in 0..10 {
        let mut rows = pending();
        match mutation {
            0 => {
                rows.remove(0);
            }
            1 => {
                rows[3]["return"] = json!("storage.transaction.delete");
            }
            2 => {
                rows[3]["attempt"] = json!(1);
            }
            3 => {
                rows[2]["args"].as_array_mut().unwrap().push(json!("extra"));
            }
            4 => {
                rows[6]["value"] = json!("changed");
            }
            5 => {
                rows[3]["value"] = json!("changed");
            }
            6 => {
                rows.insert(4, rows[3].clone());
            }
            7 => {
                rows[0]["args"] = json!(["extra"]);
            }
            8 => {
                rows[2]["port"] = json!("storage.transaction.unknown");
            }
            9 => {
                rows.push(json!({"return":"storage.transaction.put","value":null,"transaction":1,"attempt":0}));
            }
            _ => unreachable!(),
        }
        assert!(
            project(&rows.iter().collect::<Vec<_>>()).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn premature_ack_stays_before_commit_and_cannot_match_native_durable_order() {
    let mut rows = pending();
    rows.insert(6, json!({"out":"send","ws_id":"ws_id00000000-0000-0000-0000-00000000002a","frame_b64":"AQ=="}));
    let effects = super::super::projected(&rows.iter().collect::<Vec<_>>(), "document").unwrap();
    assert_eq!(effects[0].operation, "connections.send_binary");
    assert_eq!(effects[2].operation, "storage.pending.put");
    let native_durable_order = vec![effects[2].clone(), effects[0].clone(), effects[1].clone()];
    assert_ne!(effects, native_durable_order);
}

#[test]
fn gc_requires_matching_receipt_keys_and_exact_delete_returns() {
    let rows = vec![
        json!({"port":"storage.transaction","args":[],"transaction":0}),
        json!({"port":"storage.transaction.begin","args":[],"transaction":0,"attempt":0}),
        json!({"port":"storage.transaction.delete","args":[["o/test"]],"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction.delete","value":1,"transaction":0,"attempt":0}),
        json!({"port":"storage.transaction.delete","args":[["o/!archive-status-v1/test"]],"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction.delete","value":1,"transaction":0,"attempt":0}),
        json!({"return":"storage.transaction","value":null,"transaction":0}),
    ];
    assert_eq!(
        project(&rows.iter().collect::<Vec<_>>()).unwrap()[0]["port"],
        "storage.pending.delete_multiple"
    );
    for index in [3, 5] {
        let mut changed = rows.clone();
        changed[index]["value"] = json!(0);
        assert!(project(&changed.iter().collect::<Vec<_>>()).is_err());
    }
}

#[test]
fn atomic_bulk_append_requires_exact_receipt_archive_attribution_and_commit() {
    let attribution = DocumentAttribution::from_signed_claims("actor".into(), None, None).unwrap();
    let actor = serde_json::to_vec(&attribution).unwrap();
    let pending = json!([sync_server_core::domain::operation_chunks::INLINE_COMPLETE_TAG,{"bytes_b64":"AP8="}]);
    let rows = vec![
        json!({"port":"storage.put","args":[{"o/test":pending,"a/test":[0,255],"actor/test":actor}]}),
        json!({"return":"storage.put","value":{"undefined":true}}),
    ];
    assert_eq!(
        project(&rows.iter().collect::<Vec<_>>()).unwrap()[0],
        json!({"port":"storage.operation.put","args":["o/test",[0,255],attribution]})
    );
    for mutation in 0..5 {
        let mut changed = rows.clone();
        match mutation {
            0 => {
                changed[0]["args"][0]["a/test"] = json!([0, 254]);
            }
            1 => {
                changed[0]["args"][0]["o/test"] = json!([0, 255]);
            }
            2 => {
                changed[0]["args"][0]["extra"] = json!(0);
            }
            3 => {
                changed[1]["value"] = json!(null);
            }
            4 => {
                changed.remove(1);
            }
            _ => unreachable!(),
        }
        assert!(
            project(&changed.iter().collect::<Vec<_>>()).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn bulk_projection_never_discards_contradictory_fields_or_callback_ownership() {
    let pending = json!([sync_server_core::domain::operation_chunks::INLINE_COMPLETE_TAG,{"bytes_b64":"AP8="}]);
    let rows = vec![
        json!({"room":"document","callback":1,"port":"storage.put","args":[{"o/test":pending,"a/test":[0,255]}]}),
        json!({"room":"document","callback":1,"return":"storage.put","value":{"undefined":true}}),
    ];
    assert!(project(&rows.iter().collect::<Vec<_>>()).is_ok());
    for (index, key, value) in [
        (0, "value", json!(null)),
        (0, "return", json!("storage.put")),
        (1, "out", json!("send")),
        (1, "port", json!("storage.put")),
        (1, "args", json!([])),
        (1, "callback", json!(2)),
        (1, "room", json!("different")),
    ] {
        let mut changed = rows.clone();
        changed[index][key] = value;
        assert!(
            project(&changed.iter().collect::<Vec<_>>()).is_err(),
            "mutation {index}/{key}"
        );
    }
}

#[test]
fn tagged_projection_never_discards_contradictory_event_fields() {
    for (index, key) in [
        (0, "value"),
        (1, "value"),
        (2, "value"),
        (3, "args"),
        (6, "args"),
    ] {
        let mut rows = pending();
        rows[index][key] = json!(null);
        assert!(
            project(&rows.iter().collect::<Vec<_>>()).is_err(),
            "{index}/{key}"
        );
    }
}
