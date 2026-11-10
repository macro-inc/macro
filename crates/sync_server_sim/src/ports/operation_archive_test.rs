use super::*;

#[test]
fn receipt_reader_rejects_malformed_orphan_and_explicit_legacy_status() {
    for bytes in [b"not-json".as_slice(), br#"{"state":"legacy"}"#.as_slice()] {
        let ports = SimPorts::new();
        ports.put("o/!archive-status-v1/orphan", bytes).unwrap();
        assert!(futures::executor::block_on(ports.pending_operations()).is_err());
    }
}

#[test]
fn writer_off_reader_accepts_all_valid_states_and_skips_orphan_complete_receipts() {
    futures::executor::block_on(async {
        let ports = SimPorts::new();
        for id in ["legacy", "incomplete", "complete"] {
            ports
                .put_pending_operation(&OperationId::new(id.into()), b"update", None)
                .await
                .unwrap();
        }
        ports
            .put(
                "o/!archive-status-v1/incomplete",
                br#"{"state":"incomplete","attribution":null}"#.as_slice(),
            )
            .unwrap();
        ports
            .put(
                "o/!archive-status-v1/complete",
                br#"{"state":"complete"}"#.as_slice(),
            )
            .unwrap();
        ports
            .put(
                "o/!archive-status-v1/orphan",
                br#"{"state":"complete"}"#.as_slice(),
            )
            .unwrap();
        ports
            .put("o/tuple", json!([0x53430001u32,{"bytes_b64":"dXBkYXRl"}]))
            .unwrap();
        let entries = ports
            .pending_operations()
            .await
            .unwrap()
            .into_iter()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].archive, OperationArchive::Complete);
        assert_eq!(
            entries[1].archive,
            OperationArchive::Incomplete { attribution: None }
        );
        assert_eq!(entries[2].archive, OperationArchive::Legacy);
        assert_eq!(entries[3].id.as_str(), "tuple");
        assert_eq!(entries[3].archive, OperationArchive::Complete);
        assert_eq!(entries[3].update, b"update");
        assert!(!ports.operation_archive_writes());
    });
}

#[test]
fn pending_receipt_and_bytes_share_one_durable_generation_and_gc_removes_both() {
    futures::executor::block_on(async {
        let ports = SimPorts::new();
        ports.set_operation_archive_writes(true);
        let id = OperationId::new("atomic".into());
        ports
            .put_pending_operation(&id, b"update", None)
            .await
            .unwrap();
        let cold = ports.fork_durable();
        assert!(cold.operation_archive_writes());
        let entries = cold.pending_operations().await.unwrap();
        let entry = entries[0].as_ref().unwrap();
        assert_eq!(entry.update, b"update");
        assert_eq!(
            entry.archive,
            OperationArchive::Incomplete { attribution: None }
        );
        cold.complete_operation_archive(&id).await.unwrap();
        assert_eq!(
            cold.pending_operations().await.unwrap()[0]
                .as_ref()
                .unwrap()
                .archive,
            OperationArchive::Complete
        );
        assert_eq!(cold.delete_pending_operations(&[id]).await.unwrap(), 1);
        assert!(cold.pending_operations().await.unwrap().is_empty());
        assert!(
            cold.0
                .borrow()
                .data
                .values
                .keys()
                .all(|key| !key.starts_with(OPERATION_ARCHIVE_PREFIX))
        );
    });
}

#[test]
fn atomic_success_embeds_completion_without_a_sidecar_and_shares_one_generation() {
    futures::executor::block_on(async {
        let ports = SimPorts::new();
        ports.set_operation_archive_writes(true);
        let id = OperationId::new("atomic-complete".into());
        ports
            .put_complete_operation(&id, b"update", None)
            .await
            .unwrap();
        let cold = ports.fork_durable();
        let entries = cold.pending_operations().await.unwrap();
        let entry = entries[0].as_ref().unwrap();
        assert_eq!(entry.update, b"update");
        assert_eq!(entry.archive, OperationArchive::Complete);
        assert!(
            cold.0
                .borrow()
                .data
                .values
                .keys()
                .all(|key| !key.starts_with(OPERATION_ARCHIVE_PREFIX))
        );
        assert_eq!(
            cold.operation_storage_proof("a/atomic-complete", b"update")
                .unwrap(),
            (Vec::new(), true)
        );
        let puts = ports.take_completed_puts();
        assert_eq!(puts.len(), 2);
        assert_eq!(puts[0].2, puts[1].2);
        // Reader-only rollback must prune an inline receipt as one logical row,
        // while retaining the unchanged archive. Never decode its tag as u8.
        cold.set_operation_archive_writes(false);
        assert_eq!(cold.delete_pending_operations(&[id]).await.unwrap(), 1);
        assert!(cold.pending_operations().await.unwrap().is_empty());
        assert_eq!(
            cold.operation_storage_proof("a/atomic-complete", b"update")
                .unwrap(),
            (Vec::new(), true)
        );
    });
}

#[test]
fn typed_inline_receipts_reject_wrong_version_shape_or_byte_buffer() {
    for value in [
        json!([0x53430002u32,{"bytes_b64":"dXBkYXRl"}]),
        json!([0x53430001u32, [1, 2]]),
        json!([0x53430001u32,{"bytes_b64":""}]),
        json!([0x53430001u32,{"bytes_b64":"dXBkYXRl"},0]),
    ] {
        assert!(inline_receipt(&value).is_err());
    }
    assert!(
        inline_receipt(&json!([108, 111, 114, 111]))
            .unwrap()
            .is_none()
    );
    assert_eq!(
        inline_receipt(&json!([0x53430001u32,{"bytes_b64":"dXBkYXRl"}]))
            .unwrap()
            .unwrap(),
        b"update"
    );
}
