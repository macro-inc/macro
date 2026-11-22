use super::*;
use std::sync::atomic::{AtomicI64, Ordering};

#[test]
fn default_clock_preserves_system_timestamp_and_zero_interval_behavior() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    assert!(undo.inner.lock().borrow().time_source.is_none());
    let before = get_sys_timestamp() as Timestamp;
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    let first = undo.inner.lock().borrow().last_undo_time;
    let after = get_sys_timestamp() as Timestamp;
    assert!((before..=after).contains(&first));
    doc.get_map("map").insert("value", 2).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.undo_count(), 2);
}

#[test]
fn injected_interval_is_strict_and_merged_records_do_not_slide_it() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let clock = Arc::new(AtomicI64::new(1000));
    let source = clock.clone();
    undo.set_time_source(Some(Arc::new(move || source.load(Ordering::Relaxed))));
    undo.set_merge_interval(400);
    for (time, count, recorded_at) in [(1000, 1, 1000), (1399, 1, 1000), (1400, 2, 1400)] {
        clock.store(time, Ordering::Relaxed);
        doc.get_map("map").insert("value", time).unwrap();
        doc.commit_then_renew();
        assert_eq!(undo.undo_count(), count);
        assert_eq!(undo.inner.lock().borrow().last_undo_time, recorded_at);
    }
}

#[test]
fn explicit_group_and_interval_merge_independently() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let clock = Arc::new(AtomicI64::new(1000));
    let source = clock.clone();
    undo.set_time_source(Some(Arc::new(move || source.load(Ordering::Relaxed))));
    undo.set_merge_interval(400);
    undo.group_start().unwrap();
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    undo.group_end();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
    clock.store(1100, Ordering::Relaxed);
    undo.group_start().unwrap();
    doc.get_map("map").insert("value", 2).unwrap();
    doc.commit_then_renew();
    assert_eq!(
        undo.undo_count(),
        1,
        "interval merges the first record of a new group"
    );
    clock.store(2000, Ordering::Relaxed);
    doc.get_map("map").insert("value", 3).unwrap();
    doc.commit_then_renew();
    assert_eq!(
        undo.undo_count(),
        1,
        "active group merges after interval expires"
    );
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
    undo.group_end();
    undo.group_start().unwrap();
    doc.get_map("map").insert("value", 4).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.undo_count(), 2);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 2000);
}

#[test]
fn navigation_clear_and_peer_change_do_not_rebase_recording_time() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let clock = Arc::new(AtomicI64::new(1000));
    let source = clock.clone();
    undo.set_time_source(Some(Arc::new(move || source.load(Ordering::Relaxed))));
    undo.set_merge_interval(400);
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    clock.store(1400, Ordering::Relaxed);
    doc.get_map("map").insert("value", 2).unwrap();
    doc.commit_then_renew();
    clock.store(1500, Ordering::Relaxed);
    assert!(undo.undo().unwrap());
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1400);
    assert!(undo.redo().unwrap());
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1400);
    undo.clear();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1400);
    doc.set_peer_id(2).unwrap();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1400);
    doc.get_map("map").insert("value", 3).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.undo_count(), 1);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1500);
}

#[test]
fn max_stack_eviction_still_advances_only_new_record_time() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let clock = Arc::new(AtomicI64::new(1000));
    let source = clock.clone();
    undo.set_time_source(Some(Arc::new(move || source.load(Ordering::Relaxed))));
    undo.set_merge_interval(400);
    undo.set_max_undo_steps(2);
    for (time, count, recorded_at) in [
        (1000, 1, 1000),
        (2000, 2, 2000),
        (3000, 2, 3000),
        (3399, 2, 3000),
    ] {
        clock.store(time, Ordering::Relaxed);
        doc.get_map("map").insert("value", time).unwrap();
        doc.commit_then_renew();
        assert_eq!(undo.undo_count(), count);
        assert_eq!(undo.inner.lock().borrow().last_undo_time, recorded_at);
    }
}

#[test]
fn clock_callback_can_replace_itself_without_an_inner_borrow() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = Arc::new(UndoManager::new(&doc));
    let manager = Arc::downgrade(&undo);
    undo.set_time_source(Some(Arc::new(move || {
        let manager = manager.upgrade().unwrap();
        manager.set_time_source(None);
        manager.set_merge_interval(400);
        1000
    })));
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
    assert!(undo.inner.lock().borrow().time_source.is_none());
    let before = get_sys_timestamp() as Timestamp;
    doc.get_map("map").insert("value", 2).unwrap();
    doc.commit_then_renew();
    let recorded = undo.inner.lock().borrow().last_undo_time;
    assert!((before..=get_sys_timestamp() as Timestamp).contains(&recorded));
    assert_eq!(undo.undo_count(), 2);
}

#[test]
fn replacing_clock_drops_captured_values_outside_history_borrows_and_locks() {
    use std::sync::{atomic::AtomicBool, Weak};
    struct ReenterOnDrop {
        manager: Weak<UndoManager>,
        dropped: Arc<AtomicBool>,
    }
    impl Drop for ReenterOnDrop {
        fn drop(&mut self) {
            let manager = self.manager.upgrade().unwrap();
            manager.set_merge_interval(401);
            self.dropped.store(true, Ordering::Relaxed);
        }
    }
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = Arc::new(UndoManager::new(&doc));
    let dropped = Arc::new(AtomicBool::new(false));
    let capture = ReenterOnDrop {
        manager: Arc::downgrade(&undo),
        dropped: dropped.clone(),
    };
    undo.set_time_source(Some(Arc::new(move || {
        let _ = &capture;
        1000
    })));
    undo.set_time_source(Some(Arc::new(|| 2000)));
    assert!(dropped.load(Ordering::Relaxed));
    assert_eq!(undo.inner.lock().borrow().merge_interval_in_ms, 401);
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 2000);
}

#[test]
fn remote_import_and_checkout_do_not_change_last_local_record_time() {
    use crate::encoding::ExportMode;
    use std::sync::atomic::AtomicUsize;
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    undo.set_time_source(Some(Arc::new(move || {
        observed.fetch_add(1, Ordering::Relaxed);
        1000
    })));
    undo.set_merge_interval(400);
    doc.get_map("local").insert("value", 1).unwrap();
    doc.commit_then_renew();
    let remote = doc.fork();
    remote.set_peer_id(2).unwrap();
    remote.get_map("remote").insert("value", 9).unwrap();
    remote.commit_then_renew();
    doc.import(&remote.export(ExportMode::all_updates()).unwrap())
        .unwrap();
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
    assert_eq!(undo.undo_count(), 1);
    doc.checkout(&Frontiers::default()).unwrap();
    assert_eq!(undo.undo_count(), 0);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
    doc.checkout_to_latest();
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, 1000);
}

#[test]
fn extreme_clock_differences_preserve_the_signed_interval_rule_without_overflow() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    let undo = UndoManager::new(&doc);
    let clock = Arc::new(AtomicI64::new(i64::MIN));
    let source = clock.clone();
    undo.set_time_source(Some(Arc::new(move || source.load(Ordering::Relaxed))));
    undo.set_merge_interval(400);
    doc.get_map("map").insert("value", 1).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.inner.lock().borrow().last_undo_time, i64::MIN);
    clock.store(i64::MAX, Ordering::Relaxed);
    doc.get_map("map").insert("value", 2).unwrap();
    doc.commit_then_renew();
    assert_eq!(undo.undo_count(), 2);
    assert_eq!(undo.inner.lock().borrow().last_undo_time, i64::MAX);
    clock.store(i64::MIN, Ordering::Relaxed);
    doc.get_map("map").insert("value", 3).unwrap();
    doc.commit_then_renew();
    assert_eq!(
        undo.undo_count(),
        2,
        "backward clock remains inside signed interval"
    );
    assert_eq!(undo.inner.lock().borrow().last_undo_time, i64::MAX);
}
