use super::*;
use crate::domain::document::DocumentAccess;
use bebop::{Record, SliceWrapper};
use sync_protocol::{FromPeer, FromRemote};

#[test]
fn both_ingresses_fan_out_resolved_history_to_joined_readers_and_parent_sender() {
    block_on(async {
        for atomic in [false, true] {
            let mut room = room();
            room.ports.store.archive_writes.set(true);
            let first = connect_access(&mut room, AccessLevel::Edit).await;
            let writer = loro::LoroDoc::new();
            writer
                .import(
                    &room
                        .memory
                        .document
                        .as_ref()
                        .unwrap()
                        .export_snapshot(None)
                        .unwrap(),
                )
                .unwrap();
            writer.set_peer_id(77).unwrap();
            let baseline = writer.oplog_vv();
            writer.get_text("content").push_str("parent").unwrap();
            writer.commit();
            let parent = writer.export(loro::ExportMode::updates(&baseline)).unwrap();
            let before = writer.oplog_vv();
            writer.get_text("content").push_str("-child").unwrap();
            writer.commit();
            let child = writer.export(loro::ExportMode::updates(&before)).unwrap();
            room.on_frame(
                &first,
                binary(FromPeer::PeerUpdate {
                    updates: vec![SliceWrapper::Raw(&child)],
                    id: "pending-child",
                }),
            )
            .await
            .unwrap();
            let reader_socket = connect_access(&mut room, AccessLevel::Edit).await;
            let reader = loro::LoroDoc::new();
            reader
                .import(
                    &room
                        .memory
                        .document
                        .as_ref()
                        .unwrap()
                        .export_snapshot(None)
                        .unwrap(),
                )
                .unwrap();
            reader.import(&parent).unwrap();
            assert_ne!(reader.get_deep_value(), writer.get_deep_value());
            let writer_vv = writer.oplog_vv();
            let writer_value = writer.get_deep_value();
            if atomic {
                let key = SessionKey::new("document".into());
                let access = DocumentAccess::authorize("document", "document", true).unwrap();
                let (_, revision) = room
                    .read_document(&key, &access, false)
                    .await
                    .unwrap()
                    .unwrap();
                assert!(room.prepare_document_update(&key, &access).await.unwrap());
                let applied = room
                    .update_document(
                        &key,
                        &access,
                        grant("document", SessionKind::Document),
                        &revision,
                        &parent,
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    loro::VersionVector::decode(&applied.revision).unwrap(),
                    writer.oplog_vv()
                );
            } else {
                room.on_frame(
                    &reader_socket,
                    binary(FromPeer::PeerUpdate {
                        updates: vec![SliceWrapper::Raw(&parent)],
                        id: "parent",
                    }),
                )
                .await
                .unwrap();
            }
            let sent = room.ports.runtime.sent.borrow();
            let mut reader_updates = 0;
            for (socket, frame) in sent.iter() {
                let FromRemote::RemoteUpdate { update } =
                    FromRemote::deserialize(&frame[1..]).unwrap()
                else {
                    continue;
                };
                if socket == &reader_socket {
                    reader.import(&update).unwrap();
                    reader_updates += 1;
                } else if socket == &first {
                    writer.import(&update).unwrap();
                }
            }
            assert_eq!(reader_updates, if atomic { 2 } else { 1 });
            assert_eq!(reader.oplog_vv(), writer.oplog_vv());
            assert_eq!(reader.get_deep_value(), writer.get_deep_value());
            assert_eq!(writer.oplog_vv(), writer_vv);
            assert_eq!(writer.get_deep_value(), writer_value);
        }
    });
}
