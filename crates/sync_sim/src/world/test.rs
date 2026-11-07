use super::*;
use bebop::{Record, SliceWrapper};
use doc_sync_core::SyncDoc;

#[test]
fn duplicate_multi_frame_updates_are_two_complete_fifo_messages() {
    let mut sim = Sim::new(SimConfig {
        net: NetProfile {
            hostile: Some(Hostile {
                duplicate: 1.0,
                ..Hostile::default()
            }),
            ..NetProfile::calm()
        },
        ties: TieMode::Perturb,
        ..SimConfig::calm(67)
    });
    sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
    sim.advance(500);
    let key = sim
        .net
        .links
        .iter()
        .find(|(_, link)| link.open)
        .unwrap()
        .0
        .clone();
    let doc = crate::document::SimDoc::new(9_000).unwrap();
    // A small frame size exercises real fragmentation without an enormous fixture.
    doc.loro.get_map("fields").insert("1", 42).unwrap();
    doc.loro
        .commit_with(loro::CommitOptions::default().timestamp(1));
    let bytes = doc.loro.export(loro::ExportMode::all_updates()).unwrap();
    let ranges = spans(&bytes).unwrap();
    sim.emit(Fact::LocalCommit {
        client: key.0.clone(),
        spans: ranges,
    });
    let mut message = Vec::new();
    sync_protocol::FromPeer::PeerUpdate {
        id: "fragmented",
        updates: vec![SliceWrapper::from_cooked(&bytes)],
    }
    .serialize(&mut message)
    .unwrap();
    let frames = sync_protocol::framing::into_frames(&message, 16);
    assert!(frames.len() > 1);
    for frame in frames {
        sim.transmit(
            key.clone(),
            Direction::ToServer,
            FrameKind::Unknown,
            Packet::Binary(frame),
        );
    }
    sim.advance(500);
    assert_eq!(sim.events.iter().filter(|event| matches!(&event.fact, Fact::ServerApplied { update, .. } if update == "fragmented")).count(), 2);
    assert!(!sim.events.iter().any(|event| matches!(&event.fact, Fact::Server { operation } if operation.contains("callback_error"))));
    assert_eq!(
        sim.servers[&DocIx(0)].live_state().unwrap().1["fields"]["1"],
        42
    );
    assert_eq!(doc.oplog_vv().get(&9_000), Some(&1));
}

#[test]
fn corruption_waits_past_ping_and_all_fragments_then_is_consumed_once() {
    let mut sim = Sim::new(SimConfig::calm(71));
    sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
    sim.advance(500);
    let key = sim
        .net
        .links
        .iter()
        .find(|(_, link)| link.open)
        .unwrap()
        .0
        .clone();
    let doc = crate::document::SimDoc::new(9_001).unwrap();
    doc.loro.get_map("fields").insert("2", 77).unwrap();
    doc.loro
        .commit_with(loro::CommitOptions::default().timestamp(1));
    let bytes = doc.loro.export(loro::ExportMode::all_updates()).unwrap();
    let mut message = Vec::new();
    sync_protocol::FromPeer::PeerUpdate {
        id: "corrupt-fragments",
        updates: vec![SliceWrapper::from_cooked(&bytes)],
    }
    .serialize(&mut message)
    .unwrap();
    let frames = sync_protocol::framing::into_frames(&message, 16);
    assert!(frames.len() > 1);
    sim.net.fault(NetStep::CorruptNext {
        client: key.0.clone(),
        direction: Direction::ToServer,
    });
    sim.transmit(
        key.clone(),
        Direction::ToServer,
        FrameKind::Ping,
        Packet::Text("ping".into()),
    );
    for frame in &frames {
        sim.transmit(
            key.clone(),
            Direction::ToServer,
            FrameKind::Unknown,
            Packet::Binary(frame.clone()),
        );
    }
    sim.advance(500);
    assert!(!sim.events.iter().any(|event| matches!(&event.fact, Fact::ServerApplied { update, .. } if update == "corrupt-fragments")));
    assert!(sim.events.iter().any(|event| matches!(&event.fact, Fact::Server { operation } if operation.contains("callback_error"))));
    for frame in frames {
        sim.transmit(
            key.clone(),
            Direction::ToServer,
            FrameKind::Unknown,
            Packet::Binary(frame),
        );
    }
    sim.advance(500);
    assert_eq!(sim.events.iter().filter(|event| matches!(&event.fact, Fact::ServerApplied { update, .. } if update == "corrupt-fragments")).count(), 1);
    assert_eq!(
        sim.servers[&DocIx(0)].live_state().unwrap().1["fields"]["2"],
        77
    );
}

#[test]
fn chatter_is_fifo_even_with_perturbed_equal_time_scheduling() {
    let mut sim = Sim::new(SimConfig {
        ties: TieMode::Perturb,
        ..SimConfig::calm(73)
    });
    sim.step(Step::Open(OpenSpec::form("a", "shared"))).unwrap();
    sim.step(Step::Open(OpenSpec::form("b", "shared"))).unwrap();
    sim.advance(500);
    let source = ClientName("a".into());
    let target = ClientName("b".into());
    let session = sim.clients[&source].session;
    let recipient = sim.clients[&target].session;
    let mut previous = 0;
    for _ in 0..32 {
        sim.outputs(
            &source,
            session,
            SyncOutput {
                io: vec![IoEffect::ChatterPost(
                    doc_sync_core::ChatterMessage::Closing(session),
                )],
                ..SyncOutput::default()
            },
        )
        .unwrap();
        let at = sim.chatter_tails[&(session, recipient)];
        assert!(at > previous);
        previous = at;
    }
}

#[test]
fn hostile_fragment_loss_reaches_the_real_client_protocol_error_path() {
    let mut sim = Sim::new(SimConfig::calm(90));
    sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
    sim.advance(500);
    let key = sim
        .net
        .links
        .iter()
        .find(|(_, link)| link.open)
        .unwrap()
        .0
        .clone();
    sim.net.profile.hostile = Some(Hostile {
        drop_frame: 1.0,
        ..Hostile::default()
    });
    let doc = crate::document::SimDoc::new(9_002).unwrap();
    doc.loro.get_map("fields").insert("3", 91).unwrap();
    doc.loro
        .commit_with(loro::CommitOptions::default().timestamp(1));
    let bytes = doc.loro.export(loro::ExportMode::all_updates()).unwrap();
    let mut message = Vec::new();
    sync_protocol::FromRemote::RemoteUpdate {
        update: SliceWrapper::from_cooked(&bytes),
    }
    .serialize(&mut message)
    .unwrap();
    let frames = sync_protocol::framing::into_frames(&message, 16);
    assert!(frames.len() > 1);
    for frame in frames {
        sim.transmit(
            key.clone(),
            Direction::ToClient,
            FrameKind::Unknown,
            Packet::Binary(frame),
        );
    }
    sim.advance(500);
    assert!(sim.events.iter().any(|event| matches!(&event.fact,
        Fact::Frame { direction: Direction::ToClient, fate, .. } if fate == "Dropped")));
    assert!(sim.events.iter().any(|event| matches!(&event.fact,
        Fact::SocketClose { connection, reason, .. } if *connection == key.2 && reason == "ProtocolError")), "{:?}", sim.events.iter().filter(|event| event.at.0 >= 500).map(|event| &event.fact).collect::<Vec<_>>());
    assert!(!sim.events.iter().any(|event| matches!(&event.fact,
        Fact::Telemetry { name, .. } if name == "doc.sync.reset")));
}

#[test]
fn settle_resumes_failed_freeze_from_durable_claim_after_eviction() {
    use futures::FutureExt;
    use sync_server_core::domain::{migration::SourceState, ports::RoomStorage};
    let mut sim = Sim::new(SimConfig::calm(239));
    sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
    sim.advance(500);
    let ports = sim.servers[&DocIx(0)].ports.clone();
    ports.set_operation_error("snapshot.put", Some("injected export failure".into()));
    sim.step(Step::Server(ServerStep::FreezeSource)).unwrap();
    sim.advance(200);
    assert!(matches!(
        ports.source_migration().now_or_never().unwrap().unwrap(),
        Some(SourceState::Freezing(_))
    ));
    ports.set_operation_error("snapshot.put", None);
    sim.step(Step::Server(ServerStep::Evict {
        close_sockets: true,
    }))
    .unwrap();
    let outcome = sim.run(&[
        Step::Edit {
            client: ClientName("a".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 67,
            },
        },
        Step::Settle,
    ]);
    assert!(
        outcome.per_step_failures.is_empty(),
        "{:?}",
        outcome.per_step_failures
    );
    invariants::check_all(&outcome).unwrap();
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        67
    );
    assert!(matches!(
        ports.source_migration().now_or_never().unwrap().unwrap(),
        Some(SourceState::Thawed(_))
    ));
}

#[test]
fn storage_effects_require_the_real_sessions_document_lease() {
    let mut sim = Sim::new(SimConfig::calm(241));
    let name = ClientName("a".into());
    sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
    let client = &sim.clients[&name];
    let session = client.session;
    let doc = client.core_doc_id();
    let profile = client.spec.profile.clone();
    assert!(
        sim.profiles[&profile]
            .leases
            .contains(&(doc.clone(), session))
    );
    assert!(!sim.profiles[&profile].pending.is_empty());
    sim.profiles
        .get_mut(&profile)
        .unwrap()
        .leases
        .remove(&(doc.clone(), session));
    let error = sim
        .outputs(
            &name,
            session,
            SyncOutput {
                io: vec![IoEffect::Storage {
                    id: doc_sync_core::StorageOpId(999),
                    op: doc_sync_core::StorageOp::Load {
                        doc,
                        owner: session,
                        user: doc_sync_core::UserKey("user-0".into()),
                    },
                }],
                ..SyncOutput::default()
            },
        )
        .unwrap_err();
    assert_eq!(error.invariant, "storage_lease");
}

#[test]
fn other_user_expiry_uses_the_requesting_clients_positive_or_negative_skew() {
    use doc_sync_core::{StoredWalRecord, UnixMillis, UserKey, WalOwner, WalRecord, WalSeq};
    for offset in [-2_000, 2_000] {
        let mut config = SimConfig::calm(251);
        config.session.wal.ttl = doc_sync_core::Millis(1_000);
        let mut sim = Sim::new(config);
        sim.step(Step::Open(OpenSpec::form("a", "one"))).unwrap();
        let doc = sim.clients[&ClientName("a".into())].core_doc_id();
        let origin = sim.clock.wall(0);
        sim.profiles
            .get_mut(&ProfileName("one".into()))
            .unwrap()
            .durable
            .entries
            .insert(
                (doc, WalOwner::Legacy, WalSeq(1)),
                StoredWalRecord {
                    delivered: false,
                    record: WalRecord {
                        seq: WalSeq(1),
                        created_at: UnixMillis(origin),
                        user: UserKey("other-user".into()),
                        foreign: false,
                        quarantined: false,
                        bytes: vec![0],
                    },
                },
            );
        let outcome = sim.run(&[
            Step::ClockSkew {
                client: ClientName("a".into()),
                wall_offset_ms: offset,
            },
            Step::Run(Millis(500)),
        ]);
        assert!(
            outcome.per_step_failures.is_empty(),
            "{:?}",
            outcome.per_step_failures
        );
        let dropped = outcome.events.iter().any(|event| matches!(&event.fact, Fact::WalExpired { seqs, .. } if seqs.contains(&WalSeq(1))));
        assert_eq!(dropped, offset > 0, "offset={offset}");
    }
}
