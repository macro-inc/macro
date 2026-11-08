use super::*;
#[test]
fn surface_revocation_is_durable_before_any_socket_close() {
    block_on(async {
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::Edit).await;
        room.ports.store.events.borrow_mut().clear();
        assert_eq!(room.revoke_surface().await.unwrap(), SurfaceStatus::Ok);
        assert_eq!(*room.ports.store.events.borrow(), ["lifecycle", "close"]);
        assert_eq!(
            room.ports.store.lifecycle.get(),
            Some(SurfaceLifecycle::Revoked)
        );
        assert_eq!(*room.ports.runtime.closed.borrow(), [socket.as_str()]);
        assert_eq!(
            room.surface_lifecycle().await.unwrap(),
            SurfaceLifecycle::Revoked
        );
    });
}
#[test]
fn cold_surface_validation_closes_an_expired_grant() {
    block_on(async {
        let mut room = room();
        let key = SessionKey::new("surface:id".into());
        room.ports
            .store
            .lifecycle
            .set(Some(SurfaceLifecycle::Ready));
        let grant = AuthToken::new(
            "surface:id".into(),
            AccessLevel::Edit,
            SessionKind::Surface,
            None,
            None,
            None,
            Some(1),
        );
        let ConnectOutcome::Accepted { socket } = room.connect(grant, key.clone()).await.unwrap()
        else {
            panic!("valid grant")
        };
        room.ports
            .store
            .metadata
            .borrow_mut()
            .get_mut(&socket)
            .unwrap()
            .expires_at = Some(0);
        let mut cold = Room::new(room.ports, config());
        assert!(!cold.validate_surface_sockets(Some(&socket)).await.unwrap());
        assert_eq!(*cold.ports.runtime.closed.borrow(), [socket.as_str()]);
        assert!(cold.active_sockets().is_empty());
    });
}
#[test]
fn failed_surface_initialization_reloads_durable_truth_before_retry() {
    block_on(async {
        let mut room = room();
        let key = SessionKey::new("surface:id".into());
        assert_eq!(
            room.prepare_surface(&key, SurfaceRequest::Initialize)
                .await
                .unwrap(),
            SurfacePreparation::Proceed
        );
        let seed = loro::LoroDoc::new()
            .export(loro::ExportMode::Snapshot)
            .unwrap();
        assert!(
            room.initialize_surface(
                &key,
                &seed,
                FaultPlan::StopAfter(FaultPoint::SurfaceSnapshot)
            )
            .await
            .is_err()
        );
        assert_eq!(room.memory.surface_lifecycle, None);
        assert_eq!(
            room.ports.snapshots.bytes.borrow().as_deref(),
            Some(seed.as_slice())
        );
        assert_eq!(
            room.initialize_surface(&key, &seed, FaultPlan::None)
                .await
                .unwrap(),
            SurfaceStatus::Ok
        );
        assert_eq!(
            room.ports.store.lifecycle.get(),
            Some(SurfaceLifecycle::Ready)
        );
        assert_eq!(
            room.prepare_surface(&key, SurfaceRequest::Read)
                .await
                .unwrap(),
            SurfacePreparation::Proceed
        );
        let snapshot = room.surface_snapshot().await.unwrap();
        assert!(
            !crate::domain::state::DocumentState::try_from_snapshot(&snapshot)
                .unwrap()
                .loro_doc
                .is_shallow()
        );
    });
}

#[test]
fn failed_surface_close_keeps_the_persisted_revocation_for_retry() {
    block_on(async {
        let mut room = room();
        let socket = connect_access(&mut room, AccessLevel::Edit).await;
        room.ports.runtime.fail_close.set(true);
        assert!(matches!(
            room.revoke_surface().await,
            Err(RoomError::Port {
                port: PortName::Connections,
                ..
            })
        ));
        assert_eq!(
            room.ports.store.lifecycle.get(),
            Some(SurfaceLifecycle::Revoked)
        );
        assert!(room.ports.runtime.closed.borrow().is_empty());
        room.ports.runtime.fail_close.set(false);
        assert_eq!(room.revoke_surface().await.unwrap(), SurfaceStatus::Ok);
        assert_eq!(*room.ports.runtime.closed.borrow(), [socket.as_str()]);
    });
}
