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
