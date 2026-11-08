use super::*;
#[test]
fn deletion_closes_before_directory_snapshot_alarm_and_storage_and_retains_mapped_peers_quirk() {
    block_on(async {
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::Edit).await;
        room.memory.mapped_writing_peers.insert(PeerId(9));
        room.memory.awareness.set("9", "present", UnixMillis(0));
        room.apply_update(&update(9), None).await.unwrap();
        room.ports.store.events.borrow_mut().clear();
        room.delete(&SessionKey::new("document".into()))
            .await
            .unwrap();
        assert_eq!(
            *room.ports.store.events.borrow(),
            [
                "close",
                "delete-peers",
                "prepare",
                "delete-snapshot",
                "cancel",
                "delete-all"
            ]
        );
        assert_eq!(*room.ports.runtime.closed.borrow(), [socket.as_str()]);
        assert!(room.memory.document.is_none());
        assert!(room.memory.operation_log.is_none());
        assert!(room.memory.session_key.is_none());
        assert!(room.memory.connections.is_empty());
        assert!(room.ports.store.identity.borrow().is_none());
        assert!(room.ports.store.metadata.borrow().is_empty());
        assert!(room.ports.store.pending.borrow().is_empty());
        assert_eq!(room.memory.awareness.get("9"), None);
        assert!(room.memory.mapped_writing_peers.contains(&PeerId(9)));
        assert!(
            !room
                .exists(&SessionKey::new("document".into()))
                .await
                .unwrap()
        );
        // Closing sockets remain runtime-visible through their later close callback.
        assert_eq!(room.ports.runtime.sockets.borrow().as_slice(), [socket]);
    });
}
