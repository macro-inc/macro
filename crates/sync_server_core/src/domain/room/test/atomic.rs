use super::*;
use crate::domain::document::{DocumentAccess, DocumentError};
use bebop::Record;
use sync_protocol::FromRemote;

#[test]
fn atomic_update_broadcasts_to_every_socket_and_maps_service_writers_to_system() {
    block_on(async {
        let mut room = room();
        let first = connect_access(&mut room, AccessLevel::Edit).await;
        let second = connect_access(&mut room, AccessLevel::View).await;
        let key = SessionKey::new("document".into());
        let access = DocumentAccess::authorize("document", "document", true).unwrap();
        let (snapshot, revision) = room
            .read_document(&key, &access, false)
            .await
            .unwrap()
            .unwrap();
        let writer = loro::LoroDoc::new();
        writer.import(&snapshot).unwrap();
        writer.set_peer_id(9).unwrap();
        let baseline = writer.oplog_vv();
        writer.get_text("content").push_str("atomic").unwrap();
        writer.commit();
        let update = writer
            .export(loro::ExportMode::Updates {
                from: std::borrow::Cow::Owned(baseline),
            })
            .unwrap();
        let service = AuthToken::new(
            "document".into(),
            AccessLevel::Edit,
            SessionKind::Document,
            None,
            None,
            None,
            None,
        );
        room.ports.runtime.sent.borrow_mut().clear();
        room.ports.store.events.borrow_mut().clear();
        assert!(room.prepare_document_update(&key, &access).await.unwrap());
        let result = room
            .update_document(&key, &access, service, &revision, &update)
            .await
            .unwrap();
        assert!(result.applied);
        let sent = room.ports.runtime.sent.borrow();
        assert_eq!(
            sent.iter().map(|(socket, _)| socket).collect::<Vec<_>>(),
            [&first, &second]
        );
        for (_, frame) in sent.iter() {
            let FromRemote::RemoteUpdate { update: bytes } =
                FromRemote::deserialize(&frame[1..]).unwrap()
            else {
                panic!("wrong atomic broadcast")
            };
            assert_eq!(&*bytes, &update);
        }
        assert_eq!(*room.ports.runtime.mapped_users.borrow(), ["system"]);
        let events = room.ports.store.events.borrow();
        assert!(
            events.iter().position(|e| *e == "archive").unwrap()
                < events.iter().position(|e| *e == "send").unwrap()
        );
        assert!(
            events.iter().rposition(|e| *e == "send").unwrap()
                < events.iter().position(|e| *e == "map").unwrap()
        );
    });
}

#[test]
fn atomic_viewer_refusal_precedes_storage_and_invalid_update_has_no_effects() {
    block_on(async {
        let mut room = room();
        let key = SessionKey::new("document".into());
        let viewer = DocumentAccess::authorize("document", "document", false).unwrap();
        assert!(matches!(
            room.prepare_document_update(&key, &viewer).await,
            Err(RoomError::Document(DocumentError::Forbidden))
        ));
        assert!(room.ports.store.events.borrow().is_empty());
        connect_access(&mut room, AccessLevel::Edit).await;
        let access = DocumentAccess::authorize("document", "document", true).unwrap();
        let (_, revision) = room
            .read_document(&key, &access, false)
            .await
            .unwrap()
            .unwrap();
        let before = room.memory.document.as_ref().unwrap().get_json();
        room.ports.runtime.sent.borrow_mut().clear();
        room.ports.store.events.borrow_mut().clear();
        let service = AuthToken::new(
            "document".into(),
            AccessLevel::Edit,
            SessionKind::Document,
            None,
            None,
            None,
            None,
        );
        assert!(
            room.update_document(&key, &access, service, &revision, b"invalid")
                .await
                .is_err()
        );
        assert_eq!(room.memory.document.as_ref().unwrap().get_json(), before);
        assert!(room.ports.store.events.borrow().is_empty());
        assert!(room.ports.runtime.sent.borrow().is_empty());
    });
}

#[test]
fn shallow_atomic_reads_preserve_full_server_history_and_the_editable_revision() {
    block_on(async {
        let mut room = room();
        connect_access(&mut room, AccessLevel::Edit).await;
        room.apply_update(&update(7), None).await.unwrap();
        let key = SessionKey::new("document".into());
        let access = DocumentAccess::authorize("document", "document", true).unwrap();
        let (full, revision) = room
            .read_document(&key, &access, false)
            .await
            .unwrap()
            .unwrap();
        let (shallow, shallow_revision) = room
            .read_document(&key, &access, true)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(revision, shallow_revision);
        let full = crate::domain::state::DocumentState::try_from_snapshot(&full).unwrap();
        let shallow = crate::domain::state::DocumentState::try_from_snapshot(&shallow).unwrap();
        assert_eq!(full.get_json(), shallow.get_json());
        assert!(shallow.loro_doc.is_shallow());
        assert!(!room.memory.document.as_ref().unwrap().loro_doc.is_shallow());
        assert_eq!(
            full.loro_doc.oplog_vv(),
            room.memory.document.as_ref().unwrap().loro_doc.oplog_vv()
        );
    });
}
