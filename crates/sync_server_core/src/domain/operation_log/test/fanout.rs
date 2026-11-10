use super::*;

#[test]
fn durable_fanout_survives_marker_parent_and_notification_crash_boundaries() {
    futures::executor::block_on(async {
        for boundary in ["marker", "parent", "fanout"] {
            let store = Store::default();
            store.archive_writes.set(true);
            let clock = TestClock(store.events.clone());
            let mut log = log();
            let mut state = DocumentState::new();
            let writer = loro::LoroDoc::new();
            writer.set_peer_id(77).unwrap();
            writer.get_map("fields").insert("parent", 1).unwrap();
            writer.commit();
            let parent = writer.export(loro::ExportMode::all_updates()).unwrap();
            let before = writer.oplog_vv();
            writer.get_map("fields").insert("child", 2).unwrap();
            writer.commit();
            let suffix = writer.export(loro::ExportMode::updates(&before)).unwrap();
            let pending = log
                .apply(&store, &mut state, &suffix, None, &clock)
                .await
                .unwrap();
            assert!(!pending.changed);
            assert!(pending.resolved_pending.is_none());
            let reader = loro::LoroDoc::new();
            reader
                .import(&state.export_snapshot(None).unwrap())
                .unwrap();
            store.fail_pending.set(boundary == "marker");
            store.fail_archive.set(boundary == "parent");
            let before_events = store.events.borrow().len();
            let result = log.apply(&store, &mut state, &parent, None, &clock).await;
            assert!(store.fanout.borrow().is_some(), "{boundary}");
            if boundary == "fanout" {
                let delta = result.unwrap().resolved_pending.unwrap();
                reader.import(&delta).unwrap();
                assert_eq!(reader.get_deep_value(), writer.get_deep_value());
                // Notifications succeeded; simulate losing the debt-delete callback.
            } else {
                assert!(result.is_err(), "{boundary}");
            }
            let events_guard = store.events.borrow();
            let events = &events_guard[before_events..];
            assert!(
                events
                    .iter()
                    .position(|event| *event == "fanout-put")
                    .unwrap()
                    < events
                        .iter()
                        .rposition(|event| *event == "pending")
                        .unwrap_or(events.len())
            );
            drop(events_guard);
            store.fail_pending.set(false);
            store.fail_archive.set(false);
            // The reader always understands activated debt, even with the writer
            // disabled during the reader-only deployment or a permitted rollback.
            store.archive_writes.set(false);
            let mut cold_log = super::log();
            let mut cold = DocumentState::new();
            cold_log.replay_pending(&store, &mut cold).await.unwrap();
            let retried = cold_log
                .apply(&store, &mut cold, &parent, None, &clock)
                .await
                .unwrap();
            let delta = retried
                .resolved_pending
                .expect("cold retry retains fanout debt");
            reader.import(&delta).unwrap();
            assert_eq!(reader.get_deep_value(), writer.get_deep_value());
            assert_eq!(reader.oplog_vv(), writer.oplog_vv());
            let value = reader.get_deep_value();
            let vv = reader.oplog_vv();
            reader.import(&delta).unwrap();
            assert_eq!(reader.get_deep_value(), value);
            assert_eq!(reader.oplog_vv(), vv);
            cold_log
                .complete_fanout(&store, &cold.loro_doc.oplog_vv())
                .await
                .unwrap();
            assert!(store.fanout.borrow().is_none());
            let mut after = super::log();
            after
                .replay_pending(&store, &mut DocumentState::new())
                .await
                .unwrap();
            assert!(after.fanout_debt.is_none());
        }
    });
}

#[test]
fn ordinary_updates_and_duplicates_create_no_fanout_io() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let mut log = log();
        let mut state = DocumentState::new();
        let update = writer().export(loro::ExportMode::all_updates()).unwrap();
        for _ in 0..2 {
            assert!(
                log.apply(&store, &mut state, &update, None, &clock)
                    .await
                    .unwrap()
                    .resolved_pending
                    .is_none()
            );
        }
        assert!(store.fanout.borrow().is_none());
        assert!(
            !store
                .events
                .borrow()
                .iter()
                .any(|event| event.starts_with("fanout"))
        );
    });
}

#[test]
fn missing_prior_parent_does_not_block_independent_durable_progress_or_gc_recovery() {
    futures::executor::block_on(async {
        let store = Store::default();
        store.archive_writes.set(true);
        let clock = TestClock(store.events.clone());
        let a = loro::LoroDoc::new();
        a.set_peer_id(77).unwrap();
        a.get_text("first").push_str("one").unwrap();
        a.commit();
        let parent_a = a.export(loro::ExportMode::all_updates()).unwrap();
        let before = a.oplog_vv();
        a.get_text("first").push_str("-child").unwrap();
        a.commit();
        let child_a = a.export(loro::ExportMode::updates(&before)).unwrap();
        let mut log = log();
        let mut state = DocumentState::new();
        log.apply(&store, &mut state, &child_a, None, &clock)
            .await
            .unwrap();
        store.fail_pending.set(true);
        assert!(
            log.apply(&store, &mut state, &parent_a, None, &clock)
                .await
                .is_err()
        );
        store.fail_pending.set(false);
        // Discard the speculative imported parent, retaining only durable rows and debt.
        let mut state = DocumentState::new();
        let mut log = super::log();
        log.replay_pending(&store, &mut state).await.unwrap();
        let b = loro::LoroDoc::new();
        b.set_peer_id(88).unwrap();
        b.get_text("second").push_str("two").unwrap();
        b.commit();
        let parent_b = b.export(loro::ExportMode::all_updates()).unwrap();
        let before = b.oplog_vv();
        b.get_text("second").push_str("-child").unwrap();
        b.commit();
        let child_b = b.export(loro::ExportMode::updates(&before)).unwrap();
        log.apply(&store, &mut state, &child_b, None, &clock)
            .await
            .unwrap();
        let delta = log
            .apply(&store, &mut state, &parent_b, None, &clock)
            .await
            .unwrap()
            .resolved_pending
            .expect("independent resolved history must not wait for the absent first parent");
        let reader = loro::LoroDoc::new();
        reader.import(&delta).unwrap();
        assert_eq!(reader.get_text("second").to_string(), "two-child");
        assert_eq!(reader.get_text("first").to_string(), "");
        store.archive_writes.set(false);
        log.complete_fanout(&store, &state.loro_doc.oplog_vv())
            .await
            .unwrap();
        let advanced = store
            .fanout
            .borrow()
            .clone()
            .expect("first-parent debt remains");
        assert_eq!(advanced.vectors().unwrap().0, state.loro_doc.oplog_vv());
        let snapshots = Snapshots {
            events: store.events.clone(),
            bytes: RefCell::new(None),
        };
        log.store_snapshot(&store, &snapshots, &state)
            .await
            .unwrap();
        log.clear_applied(&store).await.unwrap();
        assert_eq!(
            store.pending.borrow().len(),
            1,
            "only the unresolved first child remains"
        );
        let mut cold = super::log();
        let mut recovered = cold
            .load_document_state(&store, &snapshots, false)
            .await
            .unwrap();
        let restored = cold
            .apply(&store, &mut recovered, &parent_a, None, &clock)
            .await
            .unwrap()
            .resolved_pending
            .unwrap();
        reader.import(&restored).unwrap();
        assert_eq!(reader.get_text("first").to_string(), "one-child");
        assert_eq!(reader.get_text("second").to_string(), "two-child");
        assert_eq!(reader.oplog_vv(), recovered.loro_doc.oplog_vv());
        cold.complete_fanout(&store, &recovered.loro_doc.oplog_vv())
            .await
            .unwrap();
        assert!(store.fanout.borrow().is_none());
    });
}

#[test]
fn corrupt_notification_vectors_fail_the_entire_cold_load() {
    futures::executor::block_on(async {
        let store = Store::default();
        *store.fanout.borrow_mut() = Some(crate::domain::fanout::FanoutDebt {
            base: vec![0xff],
            required: vec![0xff],
        });
        assert!(
            log()
                .replay_pending(&store, &mut DocumentState::new())
                .await
                .is_err()
        );
    });
}
