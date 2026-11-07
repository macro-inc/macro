use super::*;
use crate::domain::test_support::*;
use std::cell::RefCell;
fn key() -> SessionKey {
    SessionKey::new("document".into())
}
fn log() -> OperationLog {
    OperationLog::new(key(), SessionKind::Document)
}
fn writer() -> loro::LoroDoc {
    let writer = loro::LoroDoc::new();
    writer.set_peer_id(1).unwrap();
    writer.get_text("content").push_str("base").unwrap();
    writer
}

#[test]
fn ids_keep_the_legacy_wall_time_counter_format_and_wrapping() {
    let mut ids = OrderedIds::default();
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000000");
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000001");
    ids.counter = usize::MAX;
    ids.next(10);
    assert_eq!(ids.next(10).as_str(), "000000000000000a.00000000");
}

#[test]
fn apply_imports_before_persisting_pending_archive_and_signed_attribution() {
    futures::executor::block_on(async {
        let store = Store::default();
        let clock = TestClock(store.events.clone());
        let mut log = log();
        let mut state = DocumentState::new();
        let update = writer().export(loro::ExportMode::all_updates()).unwrap();
        let attribution =
            DocumentAttribution::from_signed_claims("actor".into(), None, None).unwrap();
        let pending = log.apply(&store, &mut state, &update, Some(&attribution), &clock);
        assert_eq!(state.get_json(), "{\"content\":\"base\"}");
        assert_eq!(*store.events.borrow(), ["nanos", "monotonic"]);
        assert!(pending.await.unwrap().changed);
        assert_eq!(
            *store.events.borrow(),
            ["nanos", "monotonic", "pending", "archive", "attribution"]
        );
        assert_eq!(log.applied.len(), 1);
    });
}

#[test]
fn archive_failure_retains_the_already_persisted_applied_operation() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.fail_archive.set(true);
        let clock = TestClock(store.events.clone());
        let mut log = log();
        let mut state = DocumentState::new();
        let update = writer().export(loro::ExportMode::all_updates()).unwrap();
        assert!(
            log.apply(&store, &mut state, &update, None, &clock)
                .await
                .is_err()
        );
        assert_eq!(store.pending.borrow().len(), 1);
        assert_eq!(log.applied.len(), 1);
        store.delete_count.set(Some(0));
        log.clear_applied(&store).await.unwrap();
        assert!(log.applied.is_empty());
        assert_eq!(store.pending.borrow().len(), 1);
        let events = store.events.borrow().len();
        log.clear_applied(&store).await.unwrap();
        assert_eq!(store.events.borrow().len(), events);
    });
}

#[test]
fn loading_skips_unreadable_entries_and_replays_without_marking_an_update() {
    futures::executor::block_on(async {
        let store = Store::default();
        let writer = writer();
        let snapshot = writer.export(loro::ExportMode::Snapshot).unwrap();
        let before = writer.oplog_vv();
        writer.get_text("content").push_str(" tail").unwrap();
        store.pending.borrow_mut().insert(
            "stored".into(),
            writer.export(loro::ExportMode::updates(&before)).unwrap(),
        );
        store.unreadable.set(true);
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: RefCell::new(Some(snapshot)),
        };
        let mut log = log();
        let state = log
            .load_document_state(&store, &snapshots, false)
            .await
            .unwrap();
        assert_eq!(state.get_json(), "{\"content\":\"base tail\"}");
        assert_eq!(state.last_update, None);
        assert_eq!(
            log.applied,
            BTreeSet::from([OperationId::new("stored".into())])
        );
        assert_eq!(
            *store.events.borrow(),
            ["snapshot-read", "version-read", "pending-read"]
        );
    });
}

#[test]
fn snapshot_is_saved_before_its_version_vector() {
    futures::executor::block_on(async {
        let store = Store::default();
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: RefCell::new(None),
        };
        let state =
            DocumentState::try_from_snapshot(&writer().export(loro::ExportMode::Snapshot).unwrap())
                .unwrap();
        let log = log();
        log.store_snapshot(&store, &snapshots, &state)
            .await
            .unwrap();
        assert_eq!(*store.events.borrow(), ["snapshot", "version"]);
        assert_eq!(
            store.saved.borrow().as_ref().unwrap(),
            &state.loro_doc.oplog_vv().encode()
        );
        assert!(snapshots.bytes.borrow().is_some());
    });
}
