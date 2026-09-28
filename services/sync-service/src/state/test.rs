use super::*;

#[test]
fn concurrent_branches_survive_session_snapshot_roundtrip() {
    for heads in 1..=9 {
        let state = DocumentState::new();
        for peer in 1..=heads {
            let branch = LoroDoc::new();
            branch.set_peer_id(peer).unwrap();
            branch
                .get_map("values")
                .insert(&peer.to_string(), peer as i64)
                .unwrap();
            state
                .loro_doc
                .import(&branch.export(ExportMode::all_updates()).unwrap())
                .unwrap();
        }

        let snapshot = state.export_shallow_snapshot().unwrap();
        let restored = LoroDoc::new();
        restored.import(&snapshot).unwrap();
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
        assert_eq!(restored.oplog_frontiers(), state.loro_doc.oplog_frontiers());

        restored
            .get_map("values")
            .insert("after-reconnect", true)
            .unwrap();
        state
            .loro_doc
            .import(
                &restored
                    .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
                    .unwrap(),
            )
            .unwrap();
        state
            .loro_doc
            .get_map("values")
            .insert("remote-edit", true)
            .unwrap();
        restored
            .import(
                &state
                    .loro_doc
                    .export(ExportMode::updates(&restored.oplog_vv()))
                    .unwrap(),
            )
            .unwrap();
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
    }
}

#[test]
fn shared_history_still_compacts_with_concurrent_heads() {
    for heads in [2, 3, 5] {
        let state = DocumentState::new();
        let text = state.loro_doc.get_text("content");
        text.insert(0, &"discarded history ".repeat(10_000))
            .unwrap();
        state.loro_doc.commit();
        text.delete(0, text.len_unicode()).unwrap();
        text.insert(0, "Saved content").unwrap();
        state.loro_doc.commit();
        let root = state.loro_doc.oplog_frontiers();
        let common = state.export_snapshot(None).unwrap();
        for peer in 1..=heads {
            let branch = LoroDoc::from_snapshot(&common).unwrap();
            branch.set_peer_id(peer).unwrap();
            branch
                .get_map("values")
                .insert(&peer.to_string(), peer as i64)
                .unwrap();
            state
                .loro_doc
                .import(
                    &branch
                        .export(ExportMode::updates(&state.loro_doc.oplog_vv()))
                        .unwrap(),
                )
                .unwrap();
        }
        assert_eq!(state.loro_doc.oplog_frontiers().len(), heads as usize);

        let full = state.export_snapshot(None).unwrap();
        let compact = state.export_shallow_snapshot().unwrap();
        let restored = LoroDoc::from_snapshot(&compact).unwrap();
        assert!(restored.is_shallow());
        assert_eq!(restored.shallow_since_frontiers(), root);
        assert_eq!(restored.get_deep_value(), state.loro_doc.get_deep_value());
        assert_eq!(restored.oplog_vv(), state.loro_doc.oplog_vv());
        assert!(compact.len() < full.len() / 2);
    }
}
