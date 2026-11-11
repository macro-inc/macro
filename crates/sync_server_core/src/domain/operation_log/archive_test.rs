use super::*;
use crate::domain::test_support::*;

fn log() -> OperationLog {
    OperationLog::new(SessionKey::new("document".into()), SessionKind::Document)
}

#[test]
fn completed_modern_duplicates_write_nothing_warm_or_after_cold_replay() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer.get_text("content").push_str("durable").unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let mut state = DocumentState::new();
        let mut first = log();
        assert!(
            first
                .apply(&store, &mut state, &update, None, &clock)
                .await
                .unwrap()
                .changed
        );
        let id = store.pending.borrow().keys().next().unwrap().clone();
        assert_eq!(
            store.archive_status.borrow()[&id],
            OperationArchive::Complete
        );
        for cold in [false, true] {
            if cold {
                first = log();
                state = DocumentState::new();
                first.replay_pending(&store, &mut state).await.unwrap();
            }
            store.events.borrow_mut().clear();
            assert!(
                !first
                    .apply(&store, &mut state, &update, None, &clock)
                    .await
                    .unwrap()
                    .changed
            );
            assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
            assert_eq!(store.pending.borrow().len(), 1);
            assert_eq!(store.archives.borrow().len(), 1);
        }
        first.clear_applied(&store).await.unwrap();
        assert!(store.pending.borrow().is_empty());
        assert!(store.archive_status.borrow().is_empty());
        assert_eq!(store.archives.borrow().len(), 1);
    });
}

#[test]
fn failed_archive_survives_cold_replay_and_repairs_original_signed_write_before_success() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        store.fail_archive.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer.get_text("content").push_str("durable").unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let original =
            DocumentAttribution::from_signed_claims("original".into(), None, None).unwrap();
        let retry = DocumentAttribution::from_signed_claims("retry".into(), None, None).unwrap();
        let mut state = DocumentState::new();
        assert!(
            log()
                .apply(&store, &mut state, &update, Some(&original), &clock)
                .await
                .is_err()
        );
        let id = store.pending.borrow().keys().next().unwrap().clone();
        assert_eq!(
            store.archive_status.borrow()[&id],
            OperationArchive::Incomplete {
                attribution: Some(original.clone())
            }
        );
        assert!(store.archives.borrow().is_empty());
        let mut cold = log();
        state = DocumentState::new();
        cold.replay_pending(&store, &mut state).await.unwrap();
        assert!(cold.clear_applied(&store).await.is_err());
        assert_eq!(
            store.pending.borrow().len(),
            1,
            "GC must retain archive debt"
        );
        store.events.borrow_mut().clear();
        assert!(
            cold.apply(&store, &mut state, &update, Some(&retry), &clock)
                .await
                .is_err()
        );
        assert!(!cold.archive_debt.is_empty());
        store.fail_archive.set(false);
        store.events.borrow_mut().clear();
        assert!(
            !cold
                .apply(&store, &mut state, &update, Some(&retry), &clock)
                .await
                .unwrap()
                .changed
        );
        assert_eq!(
            *store.events.borrow(),
            [
                "nanos",
                "monotonic",
                "archive",
                "attribution",
                "archive-complete"
            ]
        );
        assert_eq!(store.pending.borrow().len(), 1);
        assert_eq!(store.archives.borrow()[&id], update);
        assert_eq!(
            store.archive_status.borrow()[&id],
            OperationArchive::Complete
        );
        assert!(cold.archive_debt.is_empty());
        assert_eq!(store.attributions.borrow()[&id], original);
    });
}

#[test]
fn legacy_rows_repair_once_whether_the_archive_is_missing_or_already_present() {
    futures::executor::block_on(async {
        for archive_present in [false, true] {
            let store = Store::default();
            store.archive_writes.set(true);
            let clock = TestClock(store.events.clone());
            let writer = loro::LoroDoc::new();
            writer.set_peer_id(1).unwrap();
            writer.get_text("content").push_str("legacy").unwrap();
            let update = writer.export(loro::ExportMode::all_updates()).unwrap();
            store
                .pending
                .borrow_mut()
                .insert("legacy".into(), update.clone());
            if archive_present {
                store
                    .archives
                    .borrow_mut()
                    .insert("legacy".into(), update.clone());
            }
            let mut state = DocumentState::new();
            let mut cold = log();
            cold.replay_pending(&store, &mut state).await.unwrap();
            store.events.borrow_mut().clear();
            cold.apply(&store, &mut state, &update, None, &clock)
                .await
                .unwrap();
            assert_eq!(
                *store.events.borrow(),
                ["nanos", "monotonic", "archive", "archive-complete"]
            );
            assert_eq!(store.archives.borrow().len(), 1);
            assert_eq!(store.archives.borrow()["legacy"], update);
            assert_eq!(
                store.archive_status.borrow()["legacy"],
                OperationArchive::Complete
            );
            let mut again = log();
            let mut state = DocumentState::new();
            again.replay_pending(&store, &mut state).await.unwrap();
            store.events.borrow_mut().clear();
            again
                .apply(&store, &mut state, &update, None, &clock)
                .await
                .unwrap();
            assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
            assert_eq!(store.pending.borrow().len(), 1);
        }
    });
}

#[test]
fn unchanged_causal_pending_update_is_not_a_duplicate_and_remains_durable() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer.get_text("content").push_str("base").unwrap();
        let before = writer.oplog_vv();
        let base = writer.export(loro::ExportMode::all_updates()).unwrap();
        writer.get_text("content").push_str(" tail").unwrap();
        let tail = writer.export(loro::ExportMode::updates(&before)).unwrap();
        let mut state = DocumentState::new();
        let mut first = log();
        assert!(
            !first
                .apply(&store, &mut state, &tail, None, &clock)
                .await
                .unwrap()
                .changed
        );
        assert_eq!(store.pending.borrow().len(), 1);
        first.clear_applied(&store).await.unwrap();
        assert_eq!(store.pending.borrow().len(), 1);
        let mut cold = log();
        state = DocumentState::new();
        cold.replay_pending(&store, &mut state).await.unwrap();
        cold.clear_applied(&store).await.unwrap();
        assert_eq!(store.pending.borrow().len(), 1);
        cold.apply(&store, &mut state, &base, None, &clock)
            .await
            .unwrap();
        assert_eq!(state.get_json(), "{\"content\":\"base tail\"}");
        assert_eq!(store.pending.borrow().len(), 2);
        cold.clear_applied(&store).await.unwrap();
        assert!(store.pending.borrow().is_empty());
    });
}

#[test]
fn reader_only_rollback_reads_legacy_incomplete_and_complete_and_retains_incomplete_debt() {
    futures::executor::block_on(async {
        let store = Store::default();
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer.get_text("content").push_str("durable").unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        for id in ["legacy", "incomplete", "complete"] {
            store.pending.borrow_mut().insert(id.into(), update.clone());
        }
        store.archive_status.borrow_mut().insert(
            "incomplete".into(),
            OperationArchive::Incomplete { attribution: None },
        );
        store
            .archive_status
            .borrow_mut()
            .insert("complete".into(), OperationArchive::Complete);
        let mut state = DocumentState::new();
        let mut rollback = log();
        rollback.replay_pending(&store, &mut state).await.unwrap();
        assert_eq!(state.get_json(), "{\"content\":\"durable\"}");
        assert_eq!(*store.events.borrow(), ["pending-read"]);
        rollback.clear_applied(&store).await.unwrap();
        assert_eq!(
            store
                .pending
                .borrow()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["incomplete"]
        );
        assert_eq!(
            store.archive_status.borrow()["incomplete"],
            OperationArchive::Incomplete { attribution: None }
        );
        assert!(store.archives.borrow().is_empty());
    });
}

#[test]
fn snapshot_origin_duplicate_has_no_pending_archive_debt_and_does_not_rewrite_snapshot() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer
            .get_text("content")
            .push_str("snapshot history")
            .unwrap();
        let snapshot = writer.export(loro::ExportMode::Snapshot).unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: std::cell::RefCell::new(Some(snapshot.clone())),
        };
        let mut log = log();
        let mut state = log
            .load_document_state(&store, &snapshots, false)
            .await
            .unwrap();
        store.events.borrow_mut().clear();
        assert!(
            !log.apply(&store, &mut state, &update, None, &clock)
                .await
                .unwrap()
                .changed
        );
        assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
        assert!(store.pending.borrow().is_empty());
        assert!(store.archives.borrow().is_empty());
        assert_eq!(
            snapshots.bytes.borrow().as_deref(),
            Some(snapshot.as_slice())
        );
    });
}

#[test]
fn cold_duplicate_after_snapshot_and_pending_gc_has_zero_writes() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer
            .get_text("content")
            .push_str("compacted history")
            .unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let mut state = DocumentState::new();
        let mut first = log();
        first
            .apply(&store, &mut state, &update, None, &clock)
            .await
            .unwrap();
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: std::cell::RefCell::new(None),
        };
        first
            .store_snapshot(&store, &snapshots, &state)
            .await
            .unwrap();
        first.clear_applied(&store).await.unwrap();
        assert!(store.pending.borrow().is_empty());
        assert!(store.archive_status.borrow().is_empty());
        let snapshot = snapshots.bytes.borrow().clone();
        let archive = store.archives.borrow().clone();
        let mut cold = log();
        let mut state = cold
            .load_document_state(&store, &snapshots, false)
            .await
            .unwrap();
        store.events.borrow_mut().clear();
        assert!(
            !cold
                .apply(&store, &mut state, &update, None, &clock)
                .await
                .unwrap()
                .changed
        );
        assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
        assert_eq!(*store.archives.borrow(), archive);
        assert_eq!(*snapshots.bytes.borrow(), snapshot);
    });
}

#[test]
fn atomic_pending_stage_failure_has_no_visible_rows_and_no_fallback() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        store.fail_pending.set(true);
        let clock = TestClock(store.events.clone());
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(1).unwrap();
        writer
            .get_text("content")
            .push_str("retain only after staging")
            .unwrap();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let mut state = DocumentState::new();
        assert!(
            log()
                .apply(&store, &mut state, &update, None, &clock)
                .await
                .is_err()
        );
        assert!(store.pending.borrow().is_empty());
        assert!(store.archives.borrow().is_empty());
        assert!(store.archive_status.borrow().is_empty());
        assert_eq!(*store.events.borrow(), ["nanos", "monotonic", "append"]);
    });
}
