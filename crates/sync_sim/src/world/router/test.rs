use super::*;
use bebop::SliceWrapper;

fn arm(sim: &mut Sim, profile: &ProfileName, doc: &str, token: &str) -> u64 {
    let mut bytes = Vec::new();
    sync_protocol::ToRouter::RouterSubscribe { doc_id: doc, token }
        .serialize(&mut bytes)
        .unwrap();
    let actions = sim
        .routers
        .get_mut(profile)
        .unwrap()
        .protocol
        .receive(&bytes)
        .unwrap();
    let mut epoch = None;
    for action in actions {
        match action {
            Action::Open { epoch: value, .. } => epoch = Some(value),
            other => sim.router_actions(profile, vec![other]).unwrap(),
        }
    }
    epoch.unwrap()
}
fn token(sim: &Sim, name: &str) -> String {
    let session = sim.clients[&ClientName(name.into())].session;
    sim.tokens
        .iter()
        .find(|(_, grant)| grant.issued_by == session)
        .unwrap()
        .0
        .clone()
}
#[test]
fn delayed_dial_keeps_issued_identity_and_rejects_a_wrong_document_token() {
    let mut sim = Sim::new(SimConfig {
        routed: true,
        documents: 2,
        ..SimConfig::calm(167)
    });
    sim.step(Step::Open(OpenSpec::form("a", "browser")))
        .unwrap();
    sim.advance(800);
    let profile = ProfileName("browser".into());
    let doc = sim.servers[&DocIx(0)].key.as_str().to_owned();
    let issued = token(&sim, "a");
    sim.step(Step::SignIn {
        profile: profile.clone(),
        user: "user-next".into(),
    })
    .unwrap();
    sim.step(Step::Open(OpenSpec::form("b", "browser")))
        .unwrap();
    let epoch = arm(&mut sim, &profile, &doc, &issued);
    sim.route_connect(&profile, doc.clone(), epoch, issued.clone())
        .unwrap();
    let (_, _, socket) = &sim.routers[&profile].sockets[&doc];
    assert_eq!(
        sim.servers[&DocIx(0)].ports.storage_dump()[socket.as_str()]["user_id"],
        "user-0"
    );
    sim.step(Step::Open(OpenSpec {
        doc: DocIx(1),
        ..OpenSpec::form("c", "browser")
    }))
    .unwrap();
    let wrong_doc = sim.servers[&DocIx(1)].key.as_str().to_owned();
    let epoch = arm(&mut sim, &profile, &wrong_doc, &issued);
    sim.route_connect(&profile, wrong_doc.clone(), epoch, issued)
        .unwrap();
    assert!(!sim.routers[&profile].sockets.contains_key(&wrong_doc));
}
#[test]
fn connect_initial_sync_is_recorded_before_pumping_queued_requests() {
    let mut sim = Sim::new(SimConfig {
        routed: true,
        documents: 2,
        server_storage_latency: Millis(0),
        ..SimConfig::calm(173)
    });
    sim.step(Step::Open(OpenSpec::form("a", "browser")))
        .unwrap();
    sim.advance(800);
    let profile = ProfileName("browser".into());
    let doc = sim.servers[&DocIx(0)].key.as_str().to_owned();
    let issued = token(&sim, "a");
    let epoch = arm(&mut sim, &profile, &doc, &issued);
    let mut message = Vec::new();
    sync_protocol::FromPeer::PeerRequestSnapshot {}
        .serialize(&mut message)
        .unwrap();
    let frame =
        sync_protocol::framing::into_frames(&message, sync_protocol::framing::MAX_CHUNK_SIZE)
            .remove(0);
    let mut bytes = Vec::new();
    sync_protocol::ToRouter::RouterFrame {
        doc_id: &doc,
        payload: SliceWrapper::Raw(&frame),
    }
    .serialize(&mut bytes)
    .unwrap();
    assert!(
        sim.routers
            .get_mut(&profile)
            .unwrap()
            .protocol
            .receive(&bytes)
            .unwrap()
            .is_empty()
    );
    let begin = sim.server_ports.len();
    sim.route_connect(&profile, doc, epoch, issued).unwrap();
    let sends = sim.server_ports[begin..]
        .iter()
        .filter(|port| port.effect.operation == "connections.send_binary")
        .map(|port| {
            let frame: Vec<u8> =
                serde_json::from_value(port.effect.value["frame"].clone()).unwrap();
            crate::network::kind(&frame[1..], Direction::ToClient)
        })
        .collect::<Vec<_>>();
    assert_eq!(sends, [FrameKind::InitialSync, FrameKind::Snapshot]);
}
