use crate::{ports::*, replay::*, transcript::*};
use futures::{FutureExt, executor::block_on};
use macro_sync_service_jwt::session::SessionKind;
use std::{path::Path, time::Duration};
use sync_server_core::domain::{
    operation_log::OperationLog, ports::*, socket::WebSocketId, state::DocumentState, types::*,
};

fn key() -> SessionKey {
    SessionKey::new("document".into())
}
fn socket() -> WebSocketId {
    WebSocketId::new(uuid_types::Uuid::from_u128(42))
}
#[test]
fn peer_claims_only_replace_system_and_missing_mapping_never_replaces() {
    block_on(async {
        let ports = SimPorts::new();
        ports
            .map_unowned_peers(&key(), "system", None, &[PeerId(1)])
            .await
            .unwrap();
        ports
            .claim_peer(&key(), "user-a", Some("bot|a"), PeerId(1))
            .await
            .unwrap();
        ports
            .claim_peer(&key(), "user-b", Some("bot|b"), PeerId(1))
            .await
            .unwrap();
        ports
            .map_unowned_peers(&key(), "user-b", None, &[PeerId(1), PeerId(2)])
            .await
            .unwrap();
        let peers = PeerDirectory::peers(&ports, &key()).await.unwrap();
        assert_eq!(peers[0].user_id, "user-a");
        assert_eq!(peers[0].actor.as_deref(), Some("bot|a"));
        assert_eq!(peers[1].user_id, "user-b");
    });
}
#[test]
fn storage_calls_complete_on_first_poll_and_keep_order() {
    let ports = SimPorts::new();
    assert!(
        ports
            .put_session_key(&key())
            .now_or_never()
            .unwrap()
            .is_ok()
    );
    assert_eq!(
        ports.session_key().now_or_never().unwrap().unwrap(),
        Some(key())
    );
    let effects = ports.take_effects();
    assert_eq!(effects[0].operation, "storage.put");
    assert_eq!(effects[1].operation, "storage.get");
}
#[test]
fn held_output_waits_for_all_earlier_writes_and_crash_drops_unconfirmed_data() {
    let ports = SimPorts::new();
    ports.set_gate(GateMode::Held);
    block_on(ports.put_session_key(&key())).unwrap();
    ports.accept(&socket()).unwrap();
    ports.send_text(&socket(), "pong").unwrap();
    assert!(
        !ports
            .take_effects()
            .iter()
            .any(|e| e.operation == "send_text")
    );
    ports.confirm_through(ports.write_generation());
    assert_eq!(ports.take_effects()[0].operation, "send_text");
    block_on(ports.put_pending_operation(&OperationId::new("pending".into()), b"update", None))
        .unwrap();
    ports.send_text(&socket(), "unconfirmed").unwrap();
    ports.recover();
    assert_eq!(block_on(ports.session_key()).unwrap(), Some(key()));
    assert!(block_on(ports.pending_operations()).unwrap().is_empty());
    assert!(
        !ports
            .take_effects()
            .iter()
            .any(|e| e.operation == "send_text")
    );
}
#[test]
fn injected_crash_is_pending_and_does_not_write() {
    let ports = SimPorts::new();
    ports.set_faults([(("storage.put".into(), 0), Fault::Crash)].into());
    assert!(ports.put_session_key(&key()).now_or_never().is_none());
    assert!(ports.crashed());
    assert!(ports.storage_dump().is_empty());
    ports.recover();
    assert!(
        ports
            .put_session_key(&key())
            .now_or_never()
            .unwrap()
            .is_ok()
    );
}
#[test]
fn injected_errors_use_zero_based_call_indices() {
    let ports = SimPorts::new();
    ports.set_faults(
        [(
            ("storage.put".into(), 1),
            Fault::Error("write failed".into()),
        )]
        .into(),
    );
    block_on(ports.put_session_key(&key())).unwrap();
    assert!(block_on(ports.put_session_key(&key())).is_err());
    assert!(!ports.crashed());
}
#[test]
fn closing_socket_stays_listed_until_runtime_close_including_server_closes() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    assert_eq!(ports.all(), vec![socket()]);
    ports.runtime_closes(&socket());
    assert!(ports.all().is_empty());
    ports.accept(&socket()).unwrap();
    ports
        .close(&socket(), CloseReason::DocumentDeleted)
        .unwrap();
    assert_eq!(ports.all(), vec![socket()]);
    ports.runtime_closes(&socket());
    assert!(ports.all().is_empty());
}
#[test]
fn delete_all_preserves_legacy_alarm_and_directory() {
    block_on(async {
        let ports = SimPorts::new();
        ports.set_now(SimNow {
            unix_ms: 100,
            monotonic: Duration::ZERO,
        });
        ports.schedule_in(Duration::from_secs(5)).await.unwrap();
        ports
            .claim_peer(&key(), "user", None, PeerId(1))
            .await
            .unwrap();
        ports.put_session_key(&key()).await.unwrap();
        ports.delete_all().await.unwrap();
        assert!(ports.session_key().await.unwrap().is_none());
        assert_eq!(ports.scheduled().await.unwrap(), Some(UnixMillis(5100)));
        assert_eq!(
            ports
                .user_for_peer(&key(), PeerId(1))
                .await
                .unwrap()
                .as_deref(),
            Some("user")
        );
    });
}
#[test]
fn clocks_entropy_and_network_latency_are_explicit() {
    let ports = SimPorts::new();
    ports.set_now(SimNow {
        unix_ms: 100,
        monotonic: Duration::from_millis(20),
    });
    ports.set_latency("peers.user", Duration::from_millis(7));
    block_on(ports.user_for_peer(&key(), PeerId(1))).unwrap();
    assert_eq!(ports.unix_time(), UnixMillis(107));
    assert_eq!(ports.monotonic(), Duration::from_millis(27));
    assert_eq!(ports.busy_for(), Duration::from_millis(7));
    ports.seed_clocks([("unix_nanos".into(), 123)]);
    assert_eq!(ports.unix_nanos(), 123);
    assert_eq!(ports.remaining_clocks(), 0);
    ports.seed_entropy([uuid_types::Uuid::from_u128(99)]);
    assert_eq!(ports.socket_uuid(), uuid_types::Uuid::from_u128(99));
}
#[test]
#[should_panic(expected = "clock-read order mismatch")]
fn recorded_clock_kind_mismatch_fails() {
    let ports = SimPorts::new();
    ports.seed_clocks([("unix_nanos".into(), 1)]);
    ports.monotonic();
}
#[test]
fn comment_gate_defaults_closed_and_consumes_recorded_verdicts() {
    let ports = SimPorts::new();
    let change = sync_server_core::domain::state::RootChange {
        before: serde_json::json!({}),
        after: serde_json::json!({}),
    };
    assert!(!block_on(ports.is_comment_only_change(&change)).unwrap());
    ports.seed_verdicts([Ok(true)]);
    assert!(block_on(ports.is_comment_only_change(&change)).unwrap());
}
#[test]
fn actual_operation_log_uses_the_memory_ports_in_order() {
    let ports = SimPorts::new();
    ports.set_now(SimNow {
        unix_ms: 123,
        monotonic: Duration::from_millis(1),
    });
    let mut log = OperationLog::new(key(), SessionKind::Document);
    let mut state = DocumentState::new();
    let client = loro::LoroDoc::new();
    client.set_peer_id(123).unwrap();
    client.get_text("content").insert(0, "update").unwrap();
    client.commit();
    let update = client.export(loro::ExportMode::all_updates()).unwrap();
    block_on(log.apply(&ports, &mut state, &update, None, &ports)).unwrap();
    let effects = ports.take_effects();
    let writes: Vec<_> = effects
        .iter()
        .filter(|e| e.operation == "storage.put")
        .collect();
    assert_eq!(writes.len(), 2);
    assert!(writes[0].value["key"].as_str().unwrap().starts_with("o/"));
    assert!(writes[1].value["key"].as_str().unwrap().starts_with("a/"));
    assert!(state.should_save());
    block_on(log.store_snapshot(&ports, &ports, &state)).unwrap();
    block_on(log.clear_applied(&ports)).unwrap();
    assert!(block_on(ports.pending_operations()).unwrap().is_empty());
    assert!(block_on(ports.has(&key())).unwrap());
}
#[test]
fn all_golden_fixtures_load_and_enabled_callbacks_replay() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/transcripts");
    let paths = fixtures(&root).unwrap();
    assert_eq!(paths.len(), 158);
    for path in paths {
        let name = path.strip_prefix(&root).unwrap().to_str().unwrap();
        let name = name.strip_suffix(".gz").unwrap_or(name);
        let transcript = Transcript::load(&path, name).unwrap();
        assert!(!transcript.inputs().unwrap().is_empty(), "{name}");
        if ENABLED.contains(&name) {
            replay(&transcript).unwrap();
        } else {
            assert!(matches!(
                replay(&transcript),
                Err(ReplayError::NotEnabled(_))
            ));
        }
    }
}
#[test]
fn unsupported_callback_cannot_silently_replay_as_success() {
    let mut room = SimRoom::new(SimPorts::new());
    assert!(matches!(
        room.step(SimNow::default(), ServerInput::SocketError(socket())),
        Err(ReplayError::Unsupported(_))
    ));
}
#[test]
fn new_object_discards_volatile_memory_and_keeps_durable_ports() {
    let ports = SimPorts::new();
    block_on(ports.put_session_key(&key())).unwrap();
    ports.accept(&socket()).unwrap();
    let mut room = SimRoom::new(ports.clone());
    block_on(async {
        use bebop::{Record, SliceWrapper};
        use sync_server_core::domain::{
            connection::ConnectionMetadata, permissions::AccessLevel, room::InboundFrame,
        };
        ports
            .put_connection(
                &socket(),
                &ConnectionMetadata {
                    user_id: Some("test-user".into()),
                    actor: None,
                    access_level: AccessLevel::Edit,
                    peer_ids: [5].into(),
                    session_kind: SessionKind::Document,
                    expires_at: None,
                    agent_correlation_id: None,
                },
            )
            .await
            .unwrap();
        let writer = loro::LoroDoc::new();
        writer.set_peer_id(5).unwrap();
        writer
            .get_text("content")
            .push_str("before eviction")
            .unwrap();
        writer.commit();
        let update = writer.export(loro::ExportMode::all_updates()).unwrap();
        let mut bytes = Vec::new();
        sync_protocol::FromPeer::PeerUpdate {
            updates: vec![SliceWrapper::Raw(&update)],
            id: "before-eviction",
        }
        .serialize(&mut bytes)
        .unwrap();
        let frame = sync_protocol::framing::into_frames(&bytes, 1_000_000).remove(0);
        room.room_mut()
            .on_frame(&socket(), InboundFrame::Binary(frame))
            .await
            .unwrap();
        assert!(room.room().memory_view().session_key.is_some());
        assert!(
            room.room()
                .memory_view()
                .mapped_writing_peers
                .contains(&PeerId(5))
        );
    });
    room.step(SimNow::default(), ServerInput::NewObject)
        .unwrap();
    assert!(room.room().memory_view().session_key.is_none());
    assert!(room.room().memory_view().mapped_writing_peers.is_empty());
    assert_eq!(block_on(ports.session_key()).unwrap(), Some(key()));
    assert_eq!(ports.all(), vec![socket()]);
}
#[test]
fn semantic_snapshots_compare_values_vectors_and_frontiers() {
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(42).unwrap();
    doc.get_text("content").insert(0, "snapshot").unwrap();
    doc.commit();
    let a = doc.export(loro::ExportMode::Snapshot).unwrap();
    let imported = loro::LoroDoc::new();
    imported.import(&a).unwrap();
    let b = imported.export(loro::ExportMode::Snapshot).unwrap();
    assert!(equivalent_snapshots(&a, &b).unwrap());
    imported.set_peer_id(43).unwrap();
    imported.get_text("content").insert(0, "changed").unwrap();
    imported.commit();
    assert!(
        !equivalent_snapshots(&a, &imported.export(loro::ExportMode::Snapshot).unwrap()).unwrap()
    );
}
#[test]
fn exact_effect_comparison_rejects_order_and_bytes() {
    let a = Effect {
        operation: "raw_update".into(),
        value: serde_json::json!([1, 2, 3]),
    };
    let b = Effect {
        operation: "storage.put".into(),
        value: serde_json::json!([1]),
    };
    assert!(compare_effects(&[a.clone(), b.clone()], &[b, a.clone()]).is_err());
    assert!(compare_effects(std::slice::from_ref(&a), std::slice::from_ref(&a)).is_ok());
}

#[test]
fn synchronous_crash_prevents_all_later_effects_and_writes() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    ports.take_effects();
    ports.set_faults([(("connections.send_text".into(), 0), Fault::Crash)].into());
    assert!(ports.send_text(&socket(), "crash").is_err());
    assert!(ports.crashed());
    let at_crash = ports.take_effects();
    assert_eq!(at_crash.len(), 1);
    assert!(ports.send_text(&socket(), "later").is_err());
    ports.extend_isolate_lifetime(Duration::from_secs(60));
    ports.all();
    ports.monotonic();
    ports.socket_uuid();
    assert!(ports.put_session_key(&key()).now_or_never().is_none());
    assert!(ports.take_effects().is_empty());
    assert!(ports.storage_dump().is_empty());
}

#[test]
fn peer_listing_uses_sqlite_text_key_order() {
    let ports = SimPorts::new();
    block_on(ports.map_unowned_peers(&key(), "user", None, &[PeerId(2), PeerId(11), PeerId(1)]))
        .unwrap();
    let peers = block_on(PeerDirectory::peers(&ports, &key())).unwrap();
    assert_eq!(
        peers.iter().map(|p| p.peer_id.as_str()).collect::<Vec<_>>(),
        vec!["1", "11", "2"]
    );
}
#[test]
fn recorded_server_close_retains_the_runtime_socket() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/transcripts");
    let transcript=Transcript::load(&root.join("transcript_boundaries.test/C4_expired-during-connect_grants_are_accepted_before_returning_403.jsonl"),"C4").unwrap();
    let index = transcript
        .records
        .iter()
        .position(|record| record["out"] == "close")
        .unwrap();
    let close = &transcript.records[index];
    let listed = transcript.records[index + 1..]
        .iter()
        .find(|record| {
            record["port"] == "connections.list" && record["callback"] == close["callback"]
        })
        .unwrap();
    assert!(
        listed["ws_ids"]
            .as_array()
            .unwrap()
            .contains(&close["ws_id"])
    );
}

#[test]
fn native_frame_comparison_preserves_chunk_headers_ack_ids_and_vv_echoes() {
    use bebop::{Record, SliceWrapper};
    use sync_protocol::{FromRemote, framing::into_frames};
    fn frames(message: FromRemote<'_>) -> Vec<Vec<u8>> {
        let mut bytes = Vec::new();
        message.serialize(&mut bytes).unwrap();
        into_frames(&bytes, 7)
    }
    let left = frames(FromRemote::RemoteUpdateAck { id: "first" });
    let right = frames(FromRemote::RemoteUpdateAck { id: "other" });
    assert!(!equivalent_remote_frames(&left, &right).unwrap());
    let mut wrong_header = left.clone();
    wrong_header[0][0] = 1;
    assert!(!equivalent_remote_frames(&left, &wrong_header).unwrap());
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(42).unwrap();
    doc.get_text("content").insert(0, "snapshot").unwrap();
    doc.commit();
    let bytes = doc.export(loro::ExportMode::Snapshot).unwrap();
    let left = frames(FromRemote::RemoteUpdateSince {
        update: SliceWrapper::Raw(&bytes),
        vv: SliceWrapper::Raw(&[1]),
    });
    let right = frames(FromRemote::RemoteUpdateSince {
        update: SliceWrapper::Raw(&bytes),
        vv: SliceWrapper::Raw(&[2]),
    });
    assert!(!equivalent_remote_frames(&left, &right).unwrap());
}

#[test]
fn request_since_delta_comparison_uses_the_nonempty_baseline() {
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(42).unwrap();
    doc.get_text("content").insert(0, "base").unwrap();
    doc.commit();
    let base = doc.export(loro::ExportMode::Snapshot).unwrap();
    let vv = doc.oplog_vv();
    doc.get_text("content").insert(4, " delta").unwrap();
    doc.commit();
    let delta = doc
        .export(loro::ExportMode::Updates {
            from: std::borrow::Cow::Owned(vv),
        })
        .unwrap();
    let full = doc.export(loro::ExportMode::all_updates()).unwrap();
    assert_ne!(delta, full);
    assert!(equivalent_updates(&base, &delta, &full).unwrap());
    let empty = loro::LoroDoc::new()
        .export(loro::ExportMode::Snapshot)
        .unwrap();
    assert!(equivalent_updates(&empty, &delta, &full).is_err());
}

#[test]
fn socket_tags_restore_exactly_and_reject_missing_or_unknown_tags() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    assert_eq!(ports.socket_id(&socket()).unwrap(), socket());
    ports.set_socket_tags(socket(), vec![]);
    assert!(ports.socket_id(&socket()).is_err());
    ports.set_socket_tags(socket(), vec!["wrong-prefix".into()]);
    assert!(ports.socket_id(&socket()).is_err());
}
#[test]
fn default_entropy_is_deterministic_v4() {
    let a = SimPorts::new();
    let b = SimPorts::new();
    let one = a.socket_uuid();
    assert_eq!(one, b.socket_uuid());
    assert_eq!(one.get_version_num(), 4);
    assert_ne!(one, a.socket_uuid());
}

#[test]
fn closing_socket_rejects_sends_while_it_is_still_listed() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    ports
        .close(&socket(), CloseReason::DocumentDeleted)
        .unwrap();
    ports.take_effects();
    assert_eq!(ports.all(), vec![socket()]);
    assert!(ports.send_text(&socket(), "after close").is_err());
    assert!(ports.send_binary(&socket(), &[1, 2]).is_err());
    assert!(
        !ports
            .take_effects()
            .iter()
            .any(|effect| matches!(effect.operation.as_str(), "send" | "send_text"))
    );
    ports.runtime_closes(&socket());
    assert!(ports.send_text(&socket(), "after removal").is_err());
}

#[test]
fn golden_replay_rejects_reordered_writes_and_changed_final_storage() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/transcripts");
    let original = Transcript::load(&root.join(ENABLED[0]), ENABLED[0]).unwrap();
    let mut reordered = Transcript {
        name: original.name.clone(),
        records: original.records.clone(),
    };
    let puts: Vec<_> = reordered
        .records
        .iter()
        .enumerate()
        .filter(|(_, r)| r["port"] == "storage.put")
        .map(|(i, _)| i)
        .collect();
    reordered.records.swap(puts[0], puts[1]);
    assert!(matches!(replay(&reordered), Err(ReplayError::Mismatch(_))));
    let mut changed = original;
    let dump = changed
        .records
        .iter_mut()
        .find(|r| r["out"] == "dump")
        .unwrap();
    dump["kv"][0][1] = serde_json::json!("another-document");
    assert!(matches!(replay(&changed), Err(ReplayError::Mismatch(_))));
}

#[test]
fn gzip_transcript_loads_every_member_and_rejects_corrupt_trailing_data() {
    use std::io::Write;
    let directory = std::env::temp_dir().join(format!("sync-gzip-members-{}", std::process::id()));
    std::fs::create_dir(&directory).unwrap();
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }
    let _cleanup = Cleanup(directory.clone());
    let path = directory.join("case.jsonl.gz");
    let member = |source: &[u8]| {
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        gzip.write_all(source).unwrap();
        gzip.finish().unwrap()
    };
    let first = member(b"{\"record\":1}\n");
    let second = member(b"{\"record\":2}\n");
    let joined = [first.as_slice(), second.as_slice()].concat();
    std::fs::write(&path, &joined).unwrap();
    let loaded = Transcript::load(&path, "case.jsonl").unwrap();
    assert_eq!(
        loaded.records,
        vec![
            serde_json::json!({"record":1}),
            serde_json::json!({"record":2})
        ]
    );
    let mut crc = second.clone();
    let end = crc.len();
    crc[end - 8] ^= 1;
    for tail in [
        crc,
        second[..second.len() - 1].to_vec(),
        vec![1, 2, 3],
        member(b"invalid-json\n"),
    ] {
        std::fs::write(&path, [first.as_slice(), tail.as_slice()].concat()).unwrap();
        assert!(Transcript::load(&path, "case.jsonl").is_err());
    }
}

#[test]
fn room_step_preserves_synchronous_crash_effects() {
    use sync_server_core::domain::permissions::{AccessLevel, AuthToken};
    let ports = SimPorts::new();
    ports.set_faults([(("connections.accept".into(), 0), Fault::Crash)].into());
    let mut room = SimRoom::new(ports);
    let result = room
        .step(
            SimNow::default(),
            ServerInput::Connect {
                grant: AuthToken::new(
                    "document".into(),
                    AccessLevel::Edit,
                    SessionKind::Document,
                    None,
                    None,
                    None,
                    None,
                ),
                key: key(),
            },
        )
        .unwrap();
    let StepResult::Crashed(effects) = result else {
        panic!("crash reported as completion")
    };
    assert_eq!(effects.last().unwrap().operation, "connections.accept");
    assert!(!effects.iter().any(|effect| {
        effect.operation == "storage.put"
            && effect.value["key"]
                .as_str()
                .is_some_and(|key| key.starts_with("ws_id"))
    }));
}

#[test]
fn native_awareness_comparison_rejects_changed_timestamps() {
    use bebop::SliceWrapper;
    use sync_protocol::{FromRemote, presence::EphemeralStore, time::UnixMillis};
    let left = EphemeralStore::new(5_000);
    let right = EphemeralStore::new(5_000);
    left.set("cursor", 42, UnixMillis(100));
    right.set("cursor", 42, UnixMillis(101));
    let left_bytes = left.encode_all(UnixMillis(101));
    let right_bytes = right.encode_all(UnixMillis(101));
    use bebop::Record;
    let mut left = Vec::new();
    FromRemote::RemoteAwareness {
        awareness: SliceWrapper::Raw(&left_bytes),
    }
    .serialize(&mut left)
    .expect("encode");
    let mut right = Vec::new();
    FromRemote::RemoteAwareness {
        awareness: SliceWrapper::Raw(&right_bytes),
    }
    .serialize(&mut right)
    .expect("encode");
    let left = sync_protocol::framing::into_frames(&left, 1_000_000);
    let right = sync_protocol::framing::into_frames(&right, 1_000_000);
    assert_ne!(left_bytes, right_bytes);
    // The full frame comparator exercises the same timestamp-sensitive path as replay.
    assert!(!crate::transcript::equivalent_remote_frames(&left, &right).expect("compare"));
}

#[test]
fn cold_debug_preparation_restores_identity_without_loading_or_mutating_content() {
    block_on(async {
        let ports = SimPorts::new();
        let mut room = SimRoom::new(ports.clone());
        assert!(room.room_mut().prepare_debug_storage().await.is_err());
        ports.put_session_key(&key()).await.unwrap();
        room.room_mut().prepare_debug_storage().await.unwrap();
        assert!(room.room().memory_view().document.is_none());
        assert_eq!(room.room().memory_view().session_key, Some(&key()));
        let effects = ports.take_effects();
        assert_eq!(
            effects
                .iter()
                .filter(|effect| effect.operation == "snapshot.prepare")
                .count(),
            1
        );
        room.room_mut().prepare_debug_storage().await.unwrap();
        assert!(ports.take_effects().is_empty());
    });
}

#[test]
fn native_loro_envelopes_allow_export_chunks_but_keep_other_fields_exact() {
    use bebop::{Record, SliceWrapper};
    use serde_json::json;
    use sync_protocol::{FromRemote, framing::into_frames};
    let doc = loro::LoroDoc::new();
    doc.set_peer_id(42).unwrap();
    doc.get_text("content").insert(0, "snapshot").unwrap();
    doc.commit();
    let snapshot = doc.export(loro::ExportMode::Snapshot).unwrap();
    let mut bytes = Vec::new();
    FromRemote::RemoteSnapshot {
        snapshot: SliceWrapper::Raw(&snapshot),
    }
    .serialize(&mut bytes)
    .unwrap();
    let small = into_frames(&bytes, 7);
    let large = into_frames(&bytes, 900_000);
    assert!(equivalent_remote_frames(&small, &large).unwrap());
    let effects = |frames: &[Vec<u8>]| {
        frames
            .iter()
            .flat_map(|frame| {
                ["connections.send_binary", "send"].map(|operation| Effect {
                    operation: operation.into(),
                    value: json!({"socket":"ws_idtest","frame":frame}),
                })
            })
            .collect::<Vec<_>>()
    };
    compare_effects(&effects(&small), &effects(&large)).unwrap();
    let mut malformed = bytes.clone();
    malformed.push(0);
    assert!(!equivalent_remote_frames(&small, &into_frames(&malformed, 900_000)).unwrap());
    let mut malformed = small.clone();
    malformed[0][0] = 1;
    assert!(!equivalent_remote_frames(&malformed, &large).unwrap());
    bytes.clear();
    FromRemote::RemoteUpdate {
        update: SliceWrapper::Raw(&snapshot),
    }
    .serialize(&mut bytes)
    .unwrap();
    assert!(
        !equivalent_remote_frames(&into_frames(&bytes, 7), &into_frames(&bytes, 900_000)).unwrap()
    );
    let mut extra = effects(&small);
    extra.insert(
        1,
        Effect {
            operation: "storage.delete".into(),
            value: json!("metadata"),
        },
    );
    assert!(compare_effects(&extra, &effects(&large)).is_err());
}

#[test]
fn cold_forks_include_only_confirmed_writes_and_are_isolated() {
    let ports = SimPorts::new();
    ports.set_gate(GateMode::Held);
    block_on(ports.put_pending_operation(&OperationId::new("first".into()), b"a", None)).unwrap();
    assert!(ports.fork_durable().storage_dump().is_empty());
    let first = ports.write_generation();
    ports.confirm_through(first);
    let cold = ports.fork_durable();
    assert_eq!(cold.storage_dump()["o/first"], serde_json::json!([97]));
    block_on(cold.put_pending_operation(&OperationId::new("cold".into()), b"b", None)).unwrap();
    assert!(!ports.storage_dump().contains_key("o/cold"));
    block_on(ports.put_pending_operation(&OperationId::new("later".into()), b"c", None)).unwrap();
    assert!(!cold.storage_dump().contains_key("o/later"));
}

#[test]
fn completed_write_evidence_excludes_failed_attempts_and_matches_generations() {
    let ports = SimPorts::new();
    ports.set_gate(GateMode::Held);
    ports.set_operation_error("storage.put", Some("unavailable".into()));
    assert!(
        block_on(ports.put_pending_operation(&OperationId::new("failed".into()), b"a", None))
            .is_err()
    );
    assert!(ports.take_completed_puts().is_empty());
    assert!(
        ports
            .take_effects()
            .iter()
            .any(|effect| effect.operation == "storage.put")
    );
    ports.set_operation_error("storage.put", None);
    block_on(ports.put_pending_operation(&OperationId::new("ok".into()), b"b", None)).unwrap();
    assert_eq!(
        ports.take_completed_puts(),
        [(
            "o/ok".into(),
            serde_json::json!([98]),
            ports.write_generation()
        )]
    );
    assert!(ports.take_completed_puts().is_empty());
}

#[test]
fn relative_faults_count_across_capabilities_without_matching_clock_reads() {
    let ports = SimPorts::new();
    block_on(ports.put_pending_operation(&OperationId::new("before".into()), b"a", None)).unwrap();
    ports.fault_after_calls(1, Fault::Error("planned".into()));
    Clock::unix_time(&ports);
    block_on(ports.pending_operations()).unwrap();
    assert!(
        block_on(ports.put_pending_operation(&OperationId::new("failed".into()), b"b", None))
            .is_err()
    );
    assert!(!ports.storage_dump().contains_key("o/failed"));
    block_on(ports.put_pending_operation(&OperationId::new("after".into()), b"c", None)).unwrap();
}

#[test]
fn successful_send_enqueues_exclude_failed_attempts_and_precede_gate_release() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    ports.set_gate(GateMode::Held);
    block_on(ports.put_pending_operation(&OperationId::new("held".into()), b"x", None)).unwrap();
    ports.set_operation_error("connections.send_binary", Some("unavailable".into()));
    assert!(ports.send_binary(&socket(), &[1, 2]).is_err());
    assert!(ports.take_queued_sends().is_empty());
    ports.set_operation_error("connections.send_binary", None);
    ports.send_binary(&socket(), &[1, 3]).unwrap();
    let queued = ports.take_queued_sends();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].value["frame"], serde_json::json!([1, 3]));
    assert!(
        !ports
            .take_effects()
            .iter()
            .any(|effect| effect.operation == "send")
    );
    ports.confirm_through(ports.write_generation());
    assert!(ports.take_queued_sends().is_empty());
    assert!(
        ports
            .take_effects()
            .iter()
            .any(|effect| effect.operation == "send")
    );
}

#[test]
fn completed_close_evidence_excludes_failed_attempts_and_retains_wire_code() {
    let ports = SimPorts::new();
    ports.accept(&socket()).unwrap();
    ports.set_operation_error("connections.close", Some("unavailable".into()));
    assert!(
        ports
            .close(&socket(), CloseReason::SessionFrozenOrRetired)
            .is_err()
    );
    assert!(ports.take_completed_closes().is_empty());
    ports.set_operation_error("connections.close", None);
    ports
        .close(&socket(), CloseReason::SessionFrozenOrRetired)
        .unwrap();
    assert_eq!(ports.take_completed_closes(), [(socket(), 1008)]);
    assert!(ports.take_completed_closes().is_empty());
}

#[test]
fn confirming_an_earlier_generation_keeps_its_overwritten_values_and_snapshots() {
    block_on(async {
        let ports = SimPorts::new();
        ports.set_gate(GateMode::Held);
        let id = OperationId::new("same-key".into());
        ports
            .put_pending_operation(&id, b"first", None)
            .await
            .unwrap();
        let first = ports.write_generation();
        ports
            .put_pending_operation(&id, b"later", None)
            .await
            .unwrap();
        ports.confirm_through(first);
        let cold = ports.fork_durable();
        assert_eq!(
            cold.pending_operations()
                .await
                .unwrap()
                .remove(0)
                .unwrap()
                .update,
            b"first"
        );
        assert_eq!(
            ports
                .pending_operations()
                .await
                .unwrap()
                .remove(0)
                .unwrap()
                .update,
            b"later"
        );
        ports.recover();
        assert_eq!(
            ports
                .pending_operations()
                .await
                .unwrap()
                .remove(0)
                .unwrap()
                .update,
            b"first"
        );

        ports.set_gate(GateMode::Held);
        SnapshotStore::put(&ports, &key(), b"first snapshot")
            .await
            .unwrap();
        let first = ports.write_generation();
        SnapshotStore::put(&ports, &key(), b"later snapshot")
            .await
            .unwrap();
        ports.confirm_through(first);
        assert_eq!(
            SnapshotStore::get(&ports.fork_durable(), &key())
                .await
                .unwrap(),
            b"first snapshot"
        );
        assert_eq!(
            SnapshotStore::get(&ports, &key()).await.unwrap(),
            b"later snapshot"
        );
        ports.recover();
        assert_eq!(
            SnapshotStore::get(&ports, &key()).await.unwrap(),
            b"first snapshot"
        );
    });
}
