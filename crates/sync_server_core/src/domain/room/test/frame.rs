use super::*;

#[test]
fn ack_follows_pending_put_archive_and_directory_map_and_stops_on_failures() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        for failure in ["none", "archive", "directory"] {
            let mut room = room();
            let socket = connect_access(&mut room, AccessLevel::Edit).await;
            room.ports.store.fail_archive.set(failure == "archive");
            room.ports.runtime.fail_map.set(failure == "directory");
            let update = update(7);
            let result = room
                .on_frame(
                    &socket,
                    binary(FromPeer::PeerUpdate {
                        updates: vec![SliceWrapper::Raw(&update)],
                        id: "operation",
                    }),
                )
                .await;
            if failure == "none" {
                result.unwrap();
                assert_eq!(
                    *room.ports.store.events.borrow(),
                    ["nanos", "monotonic", "pending", "archive", "map", "send"]
                );
                let sent = room.ports.runtime.sent.borrow();
                assert!(matches!(
                    FromRemote::deserialize(&sent[0].1[1..]).unwrap(),
                    FromRemote::RemoteUpdateAck { id: "operation" }
                ));
            } else {
                assert!(result.is_err());
                assert!(room.ports.runtime.sent.borrow().is_empty());
            }
        }
    });
}
#[test]
fn viewer_receives_no_ack_and_does_not_persist_updates() {
    block_on(async {
        use bebop::SliceWrapper;
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::View).await;
        let update = update(7);
        room.on_frame(
            &socket,
            binary(sync_protocol::FromPeer::PeerUpdate {
                updates: vec![SliceWrapper::Raw(&update)],
                id: "view",
            }),
        )
        .await
        .unwrap();
        assert!(room.ports.runtime.sent.borrow().is_empty());
        assert!(room.ports.store.pending.borrow().is_empty());
    });
}
#[test]
fn commenter_and_editor_comment_frames_fail_closed_on_gate_error_or_missing_root() {
    block_on(async {
        use bebop::SliceWrapper;
        use sync_protocol::FromPeer;
        for access in [AccessLevel::Comment, AccessLevel::Edit] {
            for has_root in [false, true] {
                let mut room = room();
                let writer = loro::LoroDoc::new();
                writer.set_peer_id(17).unwrap();
                if has_root {
                    writer.get_map("root").insert("type", "root").unwrap();
                    writer.commit();
                    *room.ports.snapshots.bytes.borrow_mut() =
                        Some(writer.export(loro::ExportMode::Snapshot).unwrap());
                }
                let seen = writer.oplog_vv();
                let socket = connect_access(&mut room, access.clone()).await;
                writer.get_map("root").insert("indent", 1).unwrap();
                let update = writer.export(loro::ExportMode::updates(&seen)).unwrap();
                *room.ports.runtime.gate_verdict.borrow_mut() =
                    Some(Err(io::Error::other("gate unavailable")));
                let updates = vec![SliceWrapper::Raw(&update)];
                let message = if access == AccessLevel::Edit {
                    FromPeer::PeerCommentUpdate {
                        updates,
                        id: "comment",
                    }
                } else {
                    FromPeer::PeerUpdate {
                        updates,
                        id: "comment",
                    }
                };
                room.on_frame(&socket, binary(message)).await.unwrap();
                assert_eq!(room.ports.runtime.gate_calls.get(), usize::from(has_root));
                assert!(room.ports.runtime.sent.borrow().is_empty());
                assert!(room.ports.store.pending.borrow().is_empty());
            }
        }
    });
}
#[test]
fn request_since_echoes_original_vector_bytes() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::View).await;
        let mut vv = loro::VersionVector::default();
        vv.set_end(loro::ID::new(91, 2));
        vv.set_end(loro::ID::new(12, 3));
        let encoded = vv.encode();
        room.on_frame(
            &socket,
            binary(FromPeer::PeerRequestSince {
                vv: SliceWrapper::Raw(&encoded),
            }),
        )
        .await
        .unwrap();
        let sent = room.ports.runtime.sent.borrow();
        let FromRemote::RemoteUpdateSince { vv, .. } =
            FromRemote::deserialize(&sent[0].1[1..]).unwrap()
        else {
            panic!("wrong response")
        };
        assert_eq!(*vv, encoded);
    });
}
#[test]
fn broadcast_skips_sender_and_survives_a_failing_peer() {
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_protocol::{FromPeer, FromRemote};
        let mut room = room();
        let sender = connect_access(&mut room, AccessLevel::Edit).await;
        let failed = connect_access(&mut room, AccessLevel::View).await;
        let receiver = connect_access(&mut room, AccessLevel::View).await;
        *room.ports.runtime.fail_socket.borrow_mut() = Some(failed);
        let update = update(3);
        room.on_frame(
            &sender,
            binary(FromPeer::PeerUpdate {
                updates: vec![SliceWrapper::Raw(&update)],
                id: "broadcast",
            }),
        )
        .await
        .unwrap();
        let sent = room.ports.runtime.sent.borrow();
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].0, sender);
        assert_eq!(sent[1].0, receiver);
        assert!(
            matches!(FromRemote::deserialize(&sent[1].1[1..]).unwrap(), FromRemote::RemoteUpdate { update: bytes } if *bytes == update)
        );
    });
}
#[test]
fn ping_needs_identity_but_never_loads_document_state() {
    block_on(async {
        let mut room = room();
        let socket = crate::domain::socket::WebSocketId::new(uuid_types::Uuid::from_u128(1));
        assert!(matches!(
            room.on_frame(&socket, InboundFrame::Text("ping".into()))
                .await,
            Err(RoomError::NoSession)
        ));
        room.ports
            .store
            .identity
            .replace(Some(SessionKey::new("document".into())));
        room.on_frame(&socket, InboundFrame::Text("ping".into()))
            .await
            .unwrap();
        assert_eq!(*room.ports.runtime.text.borrow(), ["pong"]);
        assert!(room.memory.document.is_none());
    });
}
