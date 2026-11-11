use super::*;

#[test]
fn first_join_only_on_zero_to_one() {
    block_on(async {
        let mut room = room();
        room.connect(
            grant("document", SessionKind::Document),
            SessionKey::new("document".into()),
        )
        .await
        .unwrap();
        room.connect(
            grant("document", SessionKind::Document),
            SessionKey::new("document".into()),
        )
        .await
        .unwrap();
        let publications = room.ports.runtime.publications.borrow();
        assert_eq!(publications.len(), 1);
        assert!(matches!(
            publications[0],
            DocumentPublication::Interaction {
                reason: InteractionReason::FirstJoin,
                ..
            }
        ));
    });
}
#[test]
fn last_leave_while_closing_socket_is_listed() {
    block_on(async {
        let mut room = room();
        let ConnectOutcome::Accepted { socket } = room
            .connect(
                grant("document", SessionKind::Document),
                SessionKey::new("document".into()),
            )
            .await
            .unwrap()
        else {
            panic!("not accepted")
        };
        room.on_close(&socket).await.unwrap();
        assert_eq!(room.ports.runtime.sockets.borrow().len(), 1);
        let publications = room.ports.runtime.publications.borrow();
        assert!(matches!(
            publications[1],
            DocumentPublication::Snapshot {
                interaction: Some(InteractionReason::LastLeave),
                ..
            }
        ));
    });
}
#[test]
fn metadata_restored_after_new_object() {
    block_on(async {
        let mut room = room();
        let ConnectOutcome::Accepted { socket } = room
            .connect(
                grant("document", SessionKind::Document),
                SessionKey::new("document".into()),
            )
            .await
            .unwrap()
        else {
            panic!("not accepted")
        };
        room.ports
            .store
            .metadata
            .borrow_mut()
            .get_mut(&socket)
            .unwrap()
            .peer_ids
            .insert(42);
        let mut cold = Room::new(room.ports, config());
        assert!(cold.memory.connections.is_empty());
        assert_eq!(cold.connection_peers(&socket, true).await.unwrap(), [42]);
        assert_eq!(cold.session_key().await.unwrap().as_str(), "document");
    });
}
#[test]
fn forbidden_surface_socket_stays_accepted() {
    block_on(async {
        let mut room = room();
        room.ports
            .store
            .lifecycle
            .set(Some(SurfaceLifecycle::Ready));
        assert!(matches!(
            room.connect(
                grant("surface:id", SessionKind::Surface),
                SessionKey::new("surface:id".into())
            )
            .await
            .unwrap(),
            ConnectOutcome::Forbidden
        ));
        assert_eq!(room.ports.runtime.sockets.borrow().len(), 1);
        assert_eq!(room.ports.runtime.closed.borrow().len(), 1);
        assert_eq!(room.ports.store.metadata.borrow().len(), 1);
    });
}
