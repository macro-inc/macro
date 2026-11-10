use crate::{
    ports::{Fault, SimPorts},
    replay::SimRoom,
};
use bebop::{Record, SliceWrapper};
use futures::executor::block_on;
use sync_server_core::domain::{ports::RoomStorage, types::SessionKey};

#[test]
fn failed_import_persistence_reloads_only_durable_history_and_retains_log_ids() {
    block_on(async {
        // First pending put fails, or pending succeeds and archive fails.
        for failed_call in [0, 1] {
            let ports = SimPorts::new();
            let key = SessionKey::new("document".into());
            let doc = loro::LoroDoc::new();
            doc.set_peer_id(7).unwrap();
            let snapshot = doc.export(loro::ExportMode::Snapshot).unwrap();
            let mut wire = Vec::new();
            sync_protocol::InitializeFromSnapshotRequest {
                snapshot: SliceWrapper::Raw(&snapshot),
            }
            .serialize(&mut wire)
            .unwrap();
            let mut room = SimRoom::new(ports.clone());
            room.room_mut()
                .initialize(key.clone(), &wire)
                .await
                .unwrap();
            room.room_mut().load_document().await.unwrap();
            doc.get_text("content").push_str("first").unwrap();
            doc.commit();
            let update = doc.export(loro::ExportMode::all_updates()).unwrap();
            ports.fault_after_calls(
                failed_call,
                Fault::Error("injected persistence failure".into()),
            );
            assert!(room.room_mut().apply_update(&update, None).await.is_err());
            room.room_mut().load_document().await.unwrap();
            let loaded = loro::LoroDoc::new();
            loaded
                .import(
                    &room
                        .room()
                        .memory_view()
                        .document
                        .unwrap()
                        .export_snapshot(None)
                        .unwrap(),
                )
                .unwrap();
            assert_eq!(
                loaded.get_text("content").to_string(),
                if failed_call == 0 { "" } else { "first" }
            );
            let pending = ports.pending_operations().await.unwrap();
            assert_eq!(pending.len(), failed_call);
            let old_id = pending
                .entries
                .into_iter()
                .next()
                .map(|entry| entry.unwrap().id);
            // Same activation/time: retain the allocator and every durable prefix.
            room.room_mut().apply_update(&update, None).await.unwrap();
            let pending = ports.pending_operations().await.unwrap();
            assert_eq!(pending.len(), failed_call + 1);
            if let Some(old_id) = old_id {
                assert!(
                    pending
                        .iter()
                        .any(|entry| entry.as_ref().unwrap().id == old_id)
                );
            }
            let mut cold = SimRoom::new(ports.fork_durable());
            cold.room_mut().load_document().await.unwrap();
            let recovered = loro::LoroDoc::new();
            recovered
                .import(
                    &cold
                        .room()
                        .memory_view()
                        .document
                        .unwrap()
                        .export_snapshot(None)
                        .unwrap(),
                )
                .unwrap();
            assert_eq!(recovered.oplog_vv(), doc.oplog_vv());
        }
    });
}
