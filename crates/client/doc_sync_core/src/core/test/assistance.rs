use super::*;

#[test]
fn acknowledged_assistance_survives_replacement_after_waiting_for_a_peer() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.assist.push(row(1));
    h.send(SyncInput::Tick);
    let id = h.core.assist_push.as_ref().unwrap().id.as_str().to_owned();
    h.core.phase = Phase::Resetting;
    h.core.reset = Some(ResetState::WaitingPeer {
        rebase: false,
        snapshot: Doc::new(9).snapshot(),
    });
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert_eq!(h.core.assist_replay.len(), 1);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "");
    h.core.add_peer_ids([2]).unwrap();
    h.send(SyncInput::Tick);
    assert_eq!(h.core.phase, Phase::Running);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
    assert!(h.core.assist_replay.is_empty());
}

#[test]
fn acknowledged_assistance_replays_after_a_failed_reset() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.assist.push(row(1));
    h.send(SyncInput::Tick);
    let id = h.core.assist_push.as_ref().unwrap().id.as_str().to_owned();
    h.core.phase = Phase::Resetting;
    h.core.reset = Some(ResetState::WaitingPeer {
        rebase: false,
        snapshot: Doc::new(9).snapshot(),
    });
    h.doc.replace_fails = true;
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert_eq!(h.core.assist_replay.len(), 1);
    h.core.add_peer_ids([2]).unwrap();
    h.send(SyncInput::Tick);
    assert_eq!(h.core.phase, Phase::Running);
    assert_eq!(h.doc.peer_id(), 1);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
    assert!(h.core.assist_replay.is_empty());
}

#[test]
fn assisted_import_error_keeps_confirmed_bytes_for_recovery() {
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.core.assist.push(row(1));
    h.send(SyncInput::Tick);
    let id = h.core.assist_push.as_ref().unwrap().id.as_str().to_owned();
    h.doc.faults.push_back(Err(corrupt()));
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert_eq!(h.core.assist_replay.len(), 1);
    assert_eq!(h.core.phase, Phase::Resetting);
    h.core.add_peer_ids([2]).unwrap();
    h.remote(sync_protocol::FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::from_cooked(&Doc::new(9).snapshot()),
    });
    assert_eq!(h.core.phase, Phase::Running);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "foreign");
    assert!(h.core.assist_replay.is_empty());
}

#[test]
fn assisted_pending_import_is_retained_until_its_real_dependency_arrives() {
    let source = Doc::new(7);
    source.edit("first");
    let base = source.snapshot();
    let vv = source.oplog_vv();
    source.edit("second");
    let delta = source.loro.export(loro::ExportMode::updates(&vv)).unwrap();
    let mut record = row(1);
    record.record.bytes = delta;
    let mut h = Harness::running(TransportKind::Direct, Persistence::Memory);
    h.settle();
    h.core.assist.push(record);
    h.send(SyncInput::Tick);
    let id = h.core.assist_push.as_ref().unwrap().id.as_str().to_owned();
    h.remote(sync_protocol::FromRemote::RemoteUpdateAck { id: &id });
    assert!(h.core.pending_import);
    assert_eq!(h.core.assist_replay.len(), 1);
    assert!(h.core.convergence.is_some());
    h.remote(sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&base),
    });
    assert!(!h.core.pending_import);
    assert_eq!(h.doc.loro.get_text("text").to_string(), "firstsecond");
    assert!(h.core.assist_replay.is_empty());
}
