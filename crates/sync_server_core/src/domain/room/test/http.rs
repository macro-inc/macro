use super::*;
use crate::domain::models::{GetSnapshotRequest, VersionIndicator};
use bebop::{Record, SliceWrapper};
use sync_protocol::{FromRemote, InitializeFromSnapshotRequest};

fn wire(snapshot: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    InitializeFromSnapshotRequest {
        snapshot: SliceWrapper::Raw(snapshot),
    }
    .serialize(&mut bytes)
    .unwrap();
    bytes
}
fn initialized_writer() -> loro::LoroDoc {
    let writer = loro::LoroDoc::new();
    writer.set_peer_id(7).unwrap();
    writer.get_text("content").push_str("base").unwrap();
    writer.commit();
    writer
}
#[test]
fn initialize_maps_system_peers_before_storing_and_does_not_publish_interaction() {
    block_on(async {
        let mut room = room();
        let writer = initialized_writer();
        let snapshot = writer.export(loro::ExportMode::Snapshot).unwrap();
        assert_eq!(
            room.initialize(SessionKey::new("document".into()), &wire(&snapshot))
                .await
                .unwrap(),
            InitializeOutcome::Initialized
        );
        let events = room.ports.store.events.borrow();
        assert!(
            events.iter().position(|e| *e == "map").unwrap()
                < events.iter().position(|e| *e == "snapshot").unwrap()
        );
        assert_eq!(*room.ports.runtime.mapped_users.borrow(), ["system"]);
        let publications = room.ports.runtime.publications.borrow();
        assert!(
            matches!(&publications[0], DocumentPublication::Snapshot { interaction: None, editors, .. } if editors.is_empty())
        );
    });
}
#[test]
fn delayed_initial_sync_reaches_sockets_accepted_before_initialize() {
    block_on(async {
        let mut room = room();
        room.config.create_default_state = false;
        let socket = connect_access(&mut room, AccessLevel::Edit).await;
        assert!(room.ports.runtime.sent.borrow().is_empty());
        let snapshot = initialized_writer()
            .export(loro::ExportMode::Snapshot)
            .unwrap();
        room.initialize(SessionKey::new("document".into()), &wire(&snapshot))
            .await
            .unwrap();
        let sent = room.ports.runtime.sent.borrow();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].0, socket);
        let FromRemote::RemoteInitialSync { snapshot, .. } =
            FromRemote::deserialize(&sent[0].1[1..]).unwrap()
        else {
            panic!("wrong message")
        };
        let loaded = crate::domain::state::DocumentState::try_from_snapshot(&snapshot).unwrap();
        assert_eq!(loaded.loro_doc.get_text("content").to_string(), "base");
    });
}
#[test]
fn exists_resets_operation_id_counter_quirk() {
    block_on(async {
        let mut room = room();
        connect_access(&mut room, AccessLevel::Edit).await;
        let first = update(1);
        let second = update(2);
        room.apply_update(&first, None).await.unwrap();
        assert!(
            room.exists(&SessionKey::new("document".into()))
                .await
                .unwrap()
        );
        room.apply_update(&second, None).await.unwrap();
        assert_eq!(room.ports.store.pending.borrow().len(), 1);
        assert_eq!(
            room.ports.store.pending.borrow().values().next().unwrap(),
            &second
        );
        let mut cold = Room::new(room.ports, config());
        cold.load_document().await.unwrap();
        assert_eq!(
            cold.memory
                .document
                .as_ref()
                .unwrap()
                .loro_doc
                .get_text("content")
                .to_string(),
            "edit"
        );
    });
}
#[test]
fn server_doc_never_shallow() {
    block_on(async {
        let mut room = room();
        let writer = initialized_writer();
        room.initialize(
            SessionKey::new("document".into()),
            &wire(&writer.export(loro::ExportMode::Snapshot).unwrap()),
        )
        .await
        .unwrap();
        assert!(!room.memory.document.as_ref().unwrap().loro_doc.is_shallow());
        let seen = writer.oplog_vv();
        writer.get_text("content").push_str(" edit").unwrap();
        room.apply_update(
            &writer.export(loro::ExportMode::updates(&seen)).unwrap(),
            None,
        )
        .await
        .unwrap();
        room.on_alarm().await.unwrap();
        assert!(!room.memory.document.as_ref().unwrap().loro_doc.is_shallow());
        let mut cold = Room::new(room.ports, config());
        cold.load_document().await.unwrap();
        assert!(!cold.memory.document.as_ref().unwrap().loro_doc.is_shallow());
    });
}
#[test]
fn initialize_accepts_shallow_quirk() {
    block_on(async {
        let mut room = room();
        let writer = initialized_writer();
        let shallow = writer
            .export(loro::ExportMode::ShallowSnapshot(std::borrow::Cow::Owned(
                writer.state_frontiers(),
            )))
            .unwrap();
        assert_eq!(
            room.initialize(SessionKey::new("document".into()), &wire(&shallow))
                .await
                .unwrap(),
            InitializeOutcome::Initialized
        );
        assert!(room.memory.document.as_ref().unwrap().loro_doc.is_shallow());
    });
}
#[test]
fn storage_preconditions_precede_body_reads_and_frontier_errors_precede_loads() {
    block_on(async {
        let mut room = room();
        let key = SessionKey::new("document".into());
        assert!(matches!(
            room.snapshot_with_body(
                &key,
                std::future::ready(Err::<Option<GetSnapshotRequest>, _>(io::Error::other(
                    "body unavailable"
                )))
            )
            .await
            .unwrap(),
            SnapshotOutcome::NotFound
        ));
        room.ports.snapshots.bytes.replace(Some(
            initialized_writer()
                .export(loro::ExportMode::Snapshot)
                .unwrap(),
        ));
        assert_eq!(
            room.initialize_with_body(
                key.clone(),
                std::future::ready(Err::<Vec<u8>, _>(io::Error::other("body unavailable")))
            )
            .await
            .unwrap(),
            InitializeOutcome::AlreadyInitialized
        );
        room.ports.snapshots.bytes.replace(Some(vec![0, 1, 2]));
        assert!(matches!(
            room.snapshot(
                &key,
                Some(GetSnapshotRequest {
                    version_id: Some(VersionIndicator {
                        peer: "invalid".into(),
                        counter: 1
                    })
                })
            )
            .await
            .unwrap(),
            SnapshotOutcome::BadRequest
        ));
        assert!(room.raw_json(&key).await.is_err());
    });
}
#[test]
fn request_gate_exempts_only_surface_and_migration_classes() {
    block_on(async {
        let mut room = room();
        room.memory.source_migration = Some(crate::domain::migration::SourceState::Freezing(
            uuid_types::Uuid::nil(),
        ));
        assert_eq!(
            room.gate_request(RouteClass::Document).await.unwrap(),
            RequestGate::SourceBlocked
        );
        assert_eq!(
            room.gate_request(RouteClass::Surface).await.unwrap(),
            RequestGate::Allowed
        );
        assert_eq!(
            room.gate_request(RouteClass::Migration).await.unwrap(),
            RequestGate::Allowed
        );
    });
}
#[test]
fn document_reads_keep_missing_and_present_outcomes_distinct() {
    block_on(async {
        let mut room = room();
        let key = SessionKey::new("document".into());
        assert!(room.raw_json(&key).await.unwrap().is_none());
        assert!(room.metadata(&key).await.unwrap().is_none());
        room.warm_up(&key).await.unwrap();
        room.initialize(
            key.clone(),
            &wire(
                &initialized_writer()
                    .export(loro::ExportMode::Snapshot)
                    .unwrap(),
            ),
        )
        .await
        .unwrap();
        assert_eq!(
            room.raw_json(&key).await.unwrap().unwrap(),
            "{\"content\":\"base\"}"
        );
        assert!(matches!(
            room.snapshot(&key, None).await.unwrap(),
            SnapshotOutcome::Snapshot(_)
        ));
        assert_eq!(room.metadata(&key).await.unwrap().unwrap().id, "document");
        assert_eq!(room.peer_user(&key, PeerId(1)).await.unwrap(), "test-user");
        assert!(matches!(
            room.peer_user(&key, PeerId(2)).await,
            Err(RoomError::MissingPeer)
        ));
        assert!(room.blame("node").await.unwrap().is_none());
        assert!(room.active_peers(true).await.unwrap().is_empty());
        room.warm_up(&key).await.unwrap();
    });
}
