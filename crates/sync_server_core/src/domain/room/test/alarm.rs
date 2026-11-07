use super::*;

#[test]
fn alarm_saves_only_changed_documents_and_compacts_after_snapshot() {
    block_on(async {
        let mut room = room();
        connect_access(&mut room, AccessLevel::Edit).await;
        assert_eq!(room.on_alarm().await.unwrap(), AlarmOutcome::Completed);
        assert!(!room.ports.store.events.borrow().contains(&"snapshot"));
        room.apply_update(&update(1), None).await.unwrap();
        room.ports.store.events.borrow_mut().clear();
        room.on_alarm().await.unwrap();
        assert_eq!(
            *room.ports.store.events.borrow(),
            ["snapshot", "version", "delete", "monotonic"]
        );
        assert!(room.ports.store.pending.borrow().is_empty());
        assert_eq!(
            *room.ports.runtime.kept_alive.borrow(),
            [Duration::from_secs(60)]
        );
        room.ports.store.events.borrow_mut().clear();
        room.on_alarm().await.unwrap();
        assert!(!room.ports.store.events.borrow().contains(&"snapshot"));
    });
}
#[test]
fn failed_state_load_skips_alarm_rearm_and_blame_flush() {
    block_on(async {
        let mut room = room();
        room.ports
            .store
            .identity
            .replace(Some(SessionKey::new("document".into())));
        room.ports.snapshots.bytes.replace(Some(vec![0, 1, 2]));
        room.memory.pending_blame.push(BlameEvent {
            document_id: "document".into(),
            node_id: "node".into(),
            peer_id: 1,
            timestamp_ms: 1,
        });
        assert_eq!(room.on_alarm().await.unwrap(), AlarmOutcome::Skipped);
        assert_eq!(room.ports.runtime.alarms.get(), 0);
        assert!(room.ports.runtime.blame.borrow().is_empty());
        assert_eq!(room.memory.pending_blame.len(), 1);
    });
}
#[test]
fn blame_is_flushed_on_every_tick_even_without_a_snapshot_save() {
    block_on(async {
        let mut room = room();
        connect_access(&mut room, AccessLevel::Edit).await;
        for time in [1, 2] {
            room.memory.pending_blame.push(BlameEvent {
                document_id: "document".into(),
                node_id: "node".into(),
                peer_id: 1,
                timestamp_ms: time,
            });
            room.on_alarm().await.unwrap();
            assert!(room.memory.pending_blame.is_empty());
        }
        assert_eq!(room.ports.runtime.blame.borrow().len(), 2);
        assert!(!room.ports.store.events.borrow().contains(&"snapshot"));
    });
}
#[test]
fn pending_import_survives_compaction() {
    block_on(async {
        let mut room = room();
        connect_access(&mut room, AccessLevel::Edit).await;
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(7).unwrap();
        writer.get_text("content").push_str("base").unwrap();
        writer.commit();
        let base = writer.export(loro::ExportMode::all_updates()).unwrap();
        let seen = writer.oplog_vv();
        writer.get_text("content").push_str(" pending").unwrap();
        let pending = writer.export(loro::ExportMode::updates(&seen)).unwrap();
        room.apply_update(&pending, None).await.unwrap();
        assert!(
            room.memory
                .document
                .as_ref()
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string()
                .is_empty()
        );
        let trigger = loro::LoroDoc::new();
        trigger.set_peer_id(8).unwrap();
        trigger.get_text("other").push_str("save trigger").unwrap();
        room.apply_update(
            &trigger.export(loro::ExportMode::all_updates()).unwrap(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(room.ports.store.pending.borrow().len(), 2);
        room.on_alarm().await.unwrap();
        // An unrelated import must not make the unresolved key compactable.
        assert_eq!(room.ports.store.pending.borrow().len(), 1);
        let mut cold = Room::new(room.ports, config());
        cold.load_document().await.unwrap();
        cold.apply_update(&base, None).await.unwrap();
        assert_eq!(
            cold.memory
                .document
                .as_ref()
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string(),
            "base pending"
        );
        // The dependency write must not overwrite the pending tail even if the
        // restored allocator sees the identical wall timestamp.
        let mut cold_again = Room::new(cold.ports, config());
        cold_again.load_document().await.unwrap();
        assert_eq!(
            cold_again
                .memory
                .document
                .as_ref()
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string(),
            "base pending"
        );
        trigger
            .get_text("other")
            .push_str(" after recovery")
            .unwrap();
        cold_again
            .apply_update(
                &trigger.export(loro::ExportMode::all_updates()).unwrap(),
                None,
            )
            .await
            .unwrap();
        cold_again.on_alarm().await.unwrap();
        assert!(cold_again.ports.store.pending.borrow().is_empty());
        let mut compacted = Room::new(cold_again.ports, config());
        compacted.load_document().await.unwrap();
        assert_eq!(
            compacted
                .memory
                .document
                .as_ref()
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string(),
            "base pending"
        );
    });
}
