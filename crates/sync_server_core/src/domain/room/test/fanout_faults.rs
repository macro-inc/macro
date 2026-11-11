use super::*;
use bebop::{Record, SliceWrapper};
use sync_protocol::{FromPeer, FromRemote};

#[test]
fn retry_after_mapping_ack_batch_send_or_delete_failure_delivers_the_retained_suffix() {
    block_on(async {
        for failure in ["map", "ack", "batch", "send", "delete", "alarm"] {
            let mut room = room();
            room.ports.store.archive_writes.set(true);
            let old_socket = connect_access(&mut room, AccessLevel::Edit).await;
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
            let baseline = writer.oplog_vv();
            writer.set_peer_id(88).unwrap();
            writer.get_text("content").push_str("parent").unwrap();
            writer.commit();
            let parent = writer.export(loro::ExportMode::updates(&baseline)).unwrap();
            let before = writer.oplog_vv();
            writer.set_peer_id(77).unwrap();
            writer.get_text("content").push_str("-child").unwrap();
            writer.commit();
            let suffix = writer.export(loro::ExportMode::updates(&before)).unwrap();
            room.on_frame(
                &old_socket,
                binary(FromPeer::PeerUpdate {
                    updates: vec![SliceWrapper::Raw(&suffix)],
                    id: "suffix",
                }),
            )
            .await
            .unwrap();
            let joining = connect_access(&mut room, AccessLevel::Edit).await;
            let observer = connect_access(&mut room, AccessLevel::View).await;
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
            room.ports.runtime.fail_map.set(failure == "map");
            *room.ports.runtime.fail_socket.borrow_mut() = match failure {
                "ack" => Some(joining.clone()),
                "send" => Some(old_socket.clone()),
                "alarm" => Some(observer.clone()),
                _ => None,
            };
            room.ports.store.fail_fanout_delete.set(failure == "delete");
            let mut updates = vec![SliceWrapper::Raw(&parent)];
            if failure == "batch" {
                updates.push(SliceWrapper::Raw(&[0]));
            }
            let result = room
                .on_frame(
                    &joining,
                    binary(FromPeer::PeerUpdate {
                        updates,
                        id: "parent",
                    }),
                )
                .await;
            assert_eq!(
                result.is_ok(),
                matches!(failure, "send" | "alarm"),
                "{failure}"
            );
            assert!(room.ports.store.fanout.borrow().is_some(), "{failure}");
            room.ports.runtime.fail_map.set(false);
            room.ports.runtime.fail_socket.borrow_mut().take();
            room.ports.store.fail_fanout_delete.set(false);
            room.ports.store.archive_writes.set(false);
            room.ports.runtime.sent.borrow_mut().clear();
            // Actual room memory loss: retain only durable ports and sockets.
            let mut cold = Room::new(room.ports, config());
            if failure == "alarm" {
                // No new input/edit/reconnect: the existing alarm alone heals
                // a joined read-only observer after the writer already got ACK.
                cold.on_alarm().await.unwrap();
            } else {
                cold.on_frame(
                    &joining,
                    binary(FromPeer::PeerUpdate {
                        updates: vec![SliceWrapper::Raw(&parent)],
                        id: "parent-retry",
                    }),
                )
                .await
                .unwrap();
            }
            for (socket, frame) in cold.ports.runtime.sent.borrow().iter() {
                let target = if failure == "alarm" {
                    &observer
                } else {
                    &joining
                };
                if socket != target {
                    continue;
                }
                if let FromRemote::RemoteUpdate { update } =
                    FromRemote::deserialize(&frame[1..]).unwrap()
                {
                    reader.import(&update).unwrap();
                }
            }
            assert_eq!(
                reader.get_deep_value(),
                writer.get_deep_value(),
                "{failure}"
            );
            assert_eq!(reader.oplog_vv(), writer.oplog_vv(), "{failure}");
            assert!(cold.ports.store.fanout.borrow().is_none(), "{failure}");
        }
    });
}
