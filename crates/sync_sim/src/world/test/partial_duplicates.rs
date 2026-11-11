use super::*;

const FIRST: &str = "first-receipt";
const PARTIAL: &str = "partial-duplicate";
const DUPLICATE: &str = "duplicate-receipt";

fn partial_duplicate_outcome(activated: bool) -> Outcome {
    let mut config = SimConfig::calm(61);
    config.server_operation_archive_writes = activated;
    config.server_storage_latency = Millis(200);
    config.net.latency = (Millis(1), Millis(1));
    config.net.break_per_frame = 0.0;
    let mut sim = Sim::new(config);
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
    let writer = crate::document::SimDoc::new(9_005).unwrap();
    writer.loro.get_map("fields").insert("1", 42).unwrap();
    writer
        .loro
        .commit_with(loro::CommitOptions::default().timestamp(1));
    let first = writer.loro.export(loro::ExportMode::all_updates()).unwrap();
    let before = writer.oplog_vv();
    writer.loro.get_map("fields").insert("2", 43).unwrap();
    writer
        .loro
        .commit_with(loro::CommitOptions::default().timestamp(2));
    let second = writer
        .loro
        .export(loro::ExportMode::updates(&before))
        .unwrap();
    for (id, updates, wait) in [
        (FIRST, vec![first.clone()], 500),
        (PARTIAL, vec![first, second.clone()], 10),
        (DUPLICATE, vec![second], 500),
    ] {
        let mut message = Vec::new();
        sync_protocol::FromPeer::PeerUpdate {
            id,
            updates: updates
                .iter()
                .map(|bytes| SliceWrapper::from_cooked(bytes))
                .collect(),
        }
        .serialize(&mut message)
        .unwrap();
        for frame in sync_protocol::framing::into_frames(&message, 900_000) {
            sim.transmit(
                key.clone(),
                Direction::ToServer,
                FrameKind::Update,
                Packet::Binary(frame),
            );
        }
        sim.advance(wait);
    }
    sim.run(&[Step::Settle])
}

fn callback(outcome: &Outcome, id: &str) -> u64 {
    outcome
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::ServerReceived {
                update, callback, ..
            } if update == id => Some(*callback),
            _ => None,
        })
        .unwrap()
}

#[test]
fn partial_duplicate_requests_keep_physical_receipts_and_real_ack_proofs() {
    for activated in [false, true] {
        let outcome = partial_duplicate_outcome(activated);
        for id in [FIRST, PARTIAL, DUPLICATE] {
            assert!(
                outcome.events.iter().any(
                    |event| matches!(&event.fact, Fact::AckSent { update, .. } if update == id)
                )
            );
            assert!(!outcome.events.iter().any(
                |event| matches!(&event.fact, Fact::UpdateRefused { update, .. } if update == id)
            ));
        }
        let partial = callback(&outcome, PARTIAL);
        let duplicate = callback(&outcome, DUPLICATE);
        if activated {
            let written = outcome
                .events
                .iter()
                .filter_map(|event| match &event.fact {
                    Fact::PendingStored {
                        callback, spans, ..
                    } if *callback == partial => Some(spans),
                    _ => None,
                })
                .flatten()
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(
                written,
                vec![IdSpan {
                    peer: 9_005,
                    start: 1,
                    end: 2
                }]
            );
            assert!(!outcome.events.iter().any(|event|
                matches!(&event.fact, Fact::PendingStored { callback, .. } if *callback == duplicate)));
            assert!(outcome.events.iter().any(|event|
                matches!(&event.fact, Fact::ServerDurable { callback, .. } if *callback == partial)));
        }
        invariants::core_acks_after_writes(&outcome).unwrap();
        invariants::gate_releases_after_durable(&outcome).unwrap();
        invariants::refused_updates_never_applied(&outcome).unwrap();
    }
}

#[test]
fn partial_duplicate_ack_requires_both_prior_and_new_physical_receipts() {
    let outcome = partial_duplicate_outcome(true);
    let partial = callback(&outcome, PARTIAL);
    let first = callback(&outcome, FIRST);
    for removed in [first, partial] {
        let mut missing = outcome.clone();
        missing.events.retain(|event| {
            !matches!(&event.fact,
            Fact::PendingStored { callback, .. } if *callback == removed)
        });
        assert!(invariants::core_acks_after_writes(&missing).is_err());
    }
    let mut missing_request = outcome.clone();
    missing_request.events.retain(|event| !matches!(&event.fact,
        Fact::ServerReceived { update, .. } | Fact::ServerApplied { update, .. } if update == PARTIAL));
    assert!(invariants::core_acks_after_writes(&missing_request).is_err());
    let mut late_request = outcome.clone();
    let received = late_request
        .events
        .iter()
        .position(
            |event| matches!(&event.fact, Fact::ServerReceived { update, .. } if update == PARTIAL),
        )
        .unwrap();
    let request = late_request.events.remove(received);
    let after = late_request
        .events
        .iter()
        .position(|event| matches!(&event.fact, Fact::AckSent { update, .. } if update == PARTIAL))
        .unwrap()
        + 1;
    late_request.events.insert(after, request);
    assert!(invariants::core_acks_after_writes(&late_request).is_err());
    let mut missing_attempt = outcome.clone();
    missing_attempt.server_ports.retain(|port| {
        port.callback != partial || port.effect.operation != "connections.send_binary"
    });
    assert!(invariants::core_acks_after_writes(&missing_attempt).is_err());
    let mut missing_put = outcome.clone();
    missing_put.server_ports.retain(|port| {
        port.callback != partial || port.effect.operation != "storage.operation.put"
    });
    assert!(invariants::core_acks_after_writes(&missing_put).is_err());
    let mut missing_gate = outcome;
    missing_gate.events.retain(|event| {
        !matches!(&event.fact, Fact::GateReleased { callback, .. }
        if *callback == partial)
    });
    assert!(invariants::gate_releases_after_durable(&missing_gate).is_err());
}

#[test]
fn logical_completion_never_replaces_exact_physical_confirmation() {
    let outcome = partial_duplicate_outcome(true);
    let partial = callback(&outcome, PARTIAL);
    assert!(outcome.events.iter().any(
        |event| matches!(&event.fact, Fact::ServerDurable { callback, .. } if *callback == partial)
    ));
    for change in ["remove", "document", "callback", "generation", "late"] {
        let mut damaged = outcome.clone();
        let index = damaged.events.iter().position(|event|
            matches!(&event.fact, Fact::ServerWritesDurable { callback, .. } if *callback == partial)
        ).unwrap();
        match change {
            "remove" => {
                damaged.events.remove(index);
            }
            "late" => {
                let event = damaged.events.remove(index);
                let after = damaged.events.iter().position(|event|
                    matches!(&event.fact, Fact::AckSent { update, .. } if update == PARTIAL)
                ).unwrap() + 1;
                damaged.events.insert(after, event);
            }
            _ => {
                let Fact::ServerWritesDurable {
                    doc,
                    callback,
                    generation,
                } = &mut damaged.events[index].fact
                else {
                    unreachable!()
                };
                match change {
                    "document" => *doc = DocIx(1),
                    "callback" => *callback = u64::MAX,
                    "generation" => *generation = 0,
                    _ => unreachable!(),
                }
            }
        }
        assert!(
            invariants::core_acks_after_writes(&damaged).is_err(),
            "{change}"
        );
        assert!(
            invariants::gate_releases_after_durable(&damaged).is_err(),
            "{change}"
        );
    }
}
