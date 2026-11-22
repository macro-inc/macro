use super::*;

#[test]
fn replay_encoded_own_operations_does_not_create_another_row() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    let source = Doc::new(1);
    source.edit("encoded");
    let bytes = source.snapshot();
    h.core
        .append_bytes(bytes.clone(), false, Default::default(), now(0), &mut h.out);
    h.out = SyncOutput::default();
    assert_eq!(h.core.replay(now(0), &mut h.doc, &mut h.out), 1);
    assert_eq!(h.core.wal.entries.len(), 1);
    assert_eq!(h.core.wal.entries[0].bytes.as_ref(), bytes.as_slice());
    assert_eq!(h.core.wal.logged_vv, h.doc.oplog_vv());
    assert!(h.doc.calls.borrow().exports.is_empty());
    assert!(h.core.wal.append_due.is_none());
}

#[test]
fn replay_retains_own_fixups_before_and_after_the_encoded_range() {
    for prefix in [false, true] {
        let mut h = Harness::running(TransportKind::None, Persistence::Memory);
        let source = Doc::new(1);
        let (bytes, expected) = if prefix {
            source.edit("prefix");
            let start = source.oplog_vv();
            source.edit("tail");
            (
                source
                    .loro
                    .export(loro::ExportMode::updates(&start))
                    .unwrap(),
                "prefixtail",
            )
        } else {
            source.edit("encoded");
            (source.snapshot(), "encodedfix")
        };
        h.doc.replay_edit = Some(if prefix {
            ReplayEdit::Before("prefix")
        } else {
            ReplayEdit::After("fix")
        });
        h.core
            .append_bytes(bytes, false, Default::default(), now(0), &mut h.out);
        h.out = SyncOutput::default();
        h.core.replay(now(0), &mut h.doc, &mut h.out);
        assert_eq!(h.core.wal.entries.len(), 2);
        let repaired = &h.core.wal.entries[1].bytes;
        let cold = Doc::new(3);
        cold.loro.import(repaired).unwrap();
        assert_eq!(cold.loro.get_text("text").to_string(), expected);
        assert_eq!(cold.oplog_vv(), h.doc.oplog_vv());
        assert_eq!(h.core.wal.logged_vv, h.doc.oplog_vv());
        assert_eq!(h.core.last_local, Some(Millis(0)));
    }
}

#[test]
fn replay_partial_error_still_retains_an_import_side_effect() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    let source = Doc::new(2);
    source.edit("remote");
    h.core.append_bytes(
        source.snapshot(),
        true,
        Default::default(),
        now(0),
        &mut h.out,
    );
    h.doc.replay_edit = Some(ReplayEdit::AfterThenError("fix"));
    h.out = SyncOutput::default();
    assert_eq!(h.core.replay(now(0), &mut h.doc, &mut h.out), 0);
    assert_eq!(h.core.wal.entries.len(), 2);
    let cold = Doc::new(3);
    for entry in &h.core.wal.entries {
        cold.loro.import(&entry.bytes).unwrap();
    }
    assert_eq!(cold.loro.get_text("text").to_string(), "remotefix");
    assert_eq!(cold.oplog_vv(), h.doc.oplog_vv());
}

#[test]
fn replay_export_failure_preserves_the_cursor_and_blocks_snapshot_covers_until_append() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    let source = Doc::new(2);
    source.edit("remote");
    h.core.append_bytes(
        source.snapshot(),
        true,
        Default::default(),
        now(0),
        &mut h.out,
    );
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Ok(()),
    }));
    let before = h.core.wal.logged_vv.clone();
    h.doc.replay_edit = Some(ReplayEdit::After("fix"));
    h.doc.export_fails = true;
    h.out = SyncOutput::default();
    h.core.replay(now(0), &mut h.doc, &mut h.out);
    assert_eq!(h.core.wal.logged_vv, before);
    assert!(h.core.wal.append_due.is_some_and(|due| due > Millis(0)));
    assert!(h.out.io.iter().all(|effect| !matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
    h.doc.export_fails = false;
    h.at(25, SyncInput::Tick);
    assert_eq!(h.core.wal.entries.len(), 2);
    let id = h.storage_id();
    assert!(
        h.core
            .wal
            .entries
            .iter()
            .any(|entry| matches!(entry.state, EntryState::Writing(_)))
    );
    h.out = SyncOutput::default();
    h.core.save_snapshot(now(25), &mut h.doc, &mut h.out);
    assert!(h.out.io.iter().all(|effect| !matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave { .. },
            ..
        }
    )));
    h.send(SyncInput::Storage(StorageEvent::Done {
        id,
        result: Ok(()),
    }));
    h.out = SyncOutput::default();
    h.core.save_snapshot(now(25), &mut h.doc, &mut h.out);
    assert!(h.out.io.iter().any(|effect| matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::SnapshotSave {
                covers: Some((_, WalSeq(2))),
                ..
            },
            ..
        }
    )));
    assert_eq!(h.core.wal.logged_vv, h.doc.oplog_vv());
}

#[test]
fn replay_reset_does_not_overwrite_fixup_export_debt() {
    let mut h = Harness::running(TransportKind::None, Persistence::Memory);
    let source = Doc::new(7);
    source.edit("remote");
    let bytes = source.snapshot();
    h.core
        .append_bytes(bytes.clone(), true, Default::default(), now(0), &mut h.out);
    h.core.add_peer_ids([3]).unwrap();
    h.core.reset = Some(ResetState::WaitingPeer {
        rebase: false,
        snapshot: bytes,
    });
    h.doc.replay_edit = Some(ReplayEdit::After("fix"));
    h.doc.export_fails = true;
    h.out = SyncOutput::default();
    h.core.resume_reset(now(0), &mut h.doc, &mut h.out);
    assert_eq!(h.doc.peer_id(), 3);
    assert_eq!(h.doc.oplog_vv().get(&3), Some(&3));
    assert_eq!(h.core.wal.logged_vv.get(&3).copied().unwrap_or(0), 0);
    assert!(h.core.wal.append_due.is_some());
    h.doc.export_fails = false;
    h.at(25, SyncInput::Tick);
    assert_eq!(h.core.wal.entries.len(), 2);
    let cold = Doc::new(9);
    for entry in &h.core.wal.entries {
        cold.loro.import(&entry.bytes).unwrap();
    }
    assert_eq!(cold.loro.get_text("text").to_string(), "remotefix");
    assert_eq!(cold.oplog_vv(), h.doc.oplog_vv());
}
