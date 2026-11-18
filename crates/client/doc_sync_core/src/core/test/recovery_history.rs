use super::*;

#[test]
fn revoked_private_recovery_retries_only_after_actual_server_history_arrives() {
    for origin in [ImportOrigin::Live, ImportOrigin::Catchup] {
        let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
        h.settle();
        h.core.add_peer_ids([2, 3, 4, 5]).unwrap();
        let foreign = Doc::new(9);
        foreign.edit("retained history");
        let history = foreign.snapshot();
        h.doc.loro.import(&history).unwrap();
        h.core.wal.logged_vv = h.doc.oplog_vv();
        h.append();
        let private_vv = h.doc.oplog_vv();
        let private_value = h.doc.loro.get_deep_value();
        let retained = h.core.wal.entries[0].bytes.clone();
        h.send(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: false,
        }));
        h.send(SyncInput::ImportFailed(ImportFailure::Outdated));
        h.at(5_025, SyncInput::Tick);
        let vv = h.core.since.back().unwrap().vv.clone();
        h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&[]),
        });
        assert_eq!(h.doc.peer_id(), 1);
        assert_eq!(h.doc.oplog_vv(), private_vv);
        assert_eq!(h.doc.loro.get_deep_value(), private_value);
        assert_eq!(h.core.wal.entries[0].bytes, retained);
        assert!(h.core.rebase_due.is_none());
        // A later ordinary reset can also lack the retained history. That
        // failure must preserve the retry debt established by the rebase.
        h.remote(sync_protocol::FromRemote::RemoteUpdate {
            update: SliceWrapper::from_cooked(&[0]),
        });
        let vv = h.core.since.back().unwrap().vv.clone();
        h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&[]),
        });
        assert_eq!(h.doc.peer_id(), 1);
        assert_eq!(h.doc.oplog_vv(), private_vv);
        assert_eq!(h.core.wal.entries[0].bytes, retained);
        h.core
            .import(&history, origin, now(5_025), &mut h.doc, &mut h.out)
            .unwrap();
        assert_eq!(h.core.rebase_due, Some(Millis(15_025)));
        h.at(15_024, SyncInput::Tick);
        assert_eq!(h.core.phase, Phase::Running);
        assert_eq!(h.doc.peer_id(), 1);
        h.at(15_025, SyncInput::Tick);
        assert!(matches!(
            h.core.reset,
            Some(ResetState::AwaitingHistory { .. })
        ));
        let vv = h.core.since.back().unwrap().vv.clone();
        h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&[]),
        });
        assert_eq!(h.doc.peer_id(), 1);
        assert_eq!(h.core.wal.entries[0].bytes, retained);
        // An unsuccessful retry waits for another actual history import; it
        // must not keep waking itself while the server still lacks history.
        h.at(25_025, SyncInput::Tick);
        assert!(h.core.rebase_due.is_none());
        assert_eq!(h.doc.peer_id(), 1);
        assert!(
            h.core
                .import(&[], origin, now(25_025), &mut h.doc, &mut h.out)
                .is_none()
        );
        h.core
            .import(
                &history,
                ImportOrigin::Chatter,
                now(25_025),
                &mut h.doc,
                &mut h.out,
            )
            .unwrap();
        assert!(h.core.rebase_due.is_none());

        // Even a duplicate in the private document proves history has arrived
        // from the server. It need not advance that document's version vector.
        let imported = h
            .core
            .import(&history, origin, now(25_025), &mut h.doc, &mut h.out)
            .unwrap();
        assert!(!imported.new_ops);
        assert!(h.core.rebase_due.is_some());
        h.send(SyncInput::Tick);
        assert!(matches!(
            h.core.reset,
            Some(ResetState::AwaitingHistory { .. })
        ));
        let vv = h.core.since.back().unwrap().vv.clone();
        h.remote(sync_protocol::FromRemote::RemoteUpdateSince {
            vv: SliceWrapper::from_cooked(&vv),
            update: SliceWrapper::from_cooked(&history),
        });
        assert_eq!(h.doc.peer_id(), 5);
        assert!(h.doc.oplog_vv().includes_vv(&private_vv));
        assert_eq!(h.doc.loro.get_deep_value(), private_value);
        assert_eq!(h.core.wal.entries[0].bytes, retained);
        assert_eq!(
            h.core.status().save,
            SaveState::Unsaved(UnsavedReason::ReadOnly)
        );
        assert!(h.core.push.is_none());
        assert!(h.core.rebase_due.is_none());
        h.core
            .import(&history, origin, now(25_025), &mut h.doc, &mut h.out)
            .unwrap();
        assert!(h.core.rebase_due.is_none());
        h.send(SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: true,
            can_comment: true,
        }));
        assert!(h.core.push.is_some());
        h.ack();
        assert!(
            h.core
                .wal
                .entries
                .iter()
                .all(|row| h.core.is_delivered(row.seq))
        );
    }
}
