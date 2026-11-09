use super::*;

/// covers: S7:36, S7:25
#[test]
fn crash_after_durable_wal_append_delivers_on_reopen() {
    let outcome = verify(
        SimConfig::calm(7),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(200)),
            Step::Crash {
                client: ClientName("a".into()),
            },
            Step::Net(NetStep::Heal(ClientName("a".into()))),
            Step::Reopen {
                client: ClientName("a".into()),
            },
            Step::Settle,
        ],
    );
    let durable = outcome
        .events
        .iter()
        .find(|event| matches!(event.fact, Fact::WalDurable { .. }))
        .unwrap();
    let crash = outcome
        .events
        .iter()
        .find(|event| matches!(event.fact, Fact::Crashed { .. }))
        .unwrap();
    assert!(durable.at < crash.at);
    assert!(outcome.stats.adoptions > 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        42
    );
}
/// covers: S7:30, S7:53
#[test]
fn lost_ack_resends_once_and_converges_with_concurrent_edit() {
    let outcome = verify(
        SimConfig::calm(11),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::LoseAcks {
                client: ClientName("a".into()),
                count: 1,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(1_000)),
            Step::Edit {
                client: ClientName("b".into()),
                op: AbstractOp::FormSet {
                    field: 2,
                    value: 81,
                },
            },
            Step::Run(Millis(10_000)),
            Step::Settle,
        ],
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(|event| matches!(&event.fact, Fact::PushSent { client, .. } if client.0 == "a"))
            .count(),
        2
    );
    assert_eq!(
        outcome
            .events
            .iter()
            .filter(
                |event| matches!(&event.fact, Fact::AckReceived { client, .. } if client.0 == "a")
            )
            .count(),
        1
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        81
    );
}
/// covers: S7:16, S7:21
#[test]
fn missed_broadcast_is_pending_then_converged_without_reset() {
    let outcome = verify(
        SimConfig::calm(23),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::DropNext {
                client: ClientName("b".into()),
                direction: Direction::ToClient,
                kind: Some(FrameKind::RemoteUpdate),
                frames: 1,
            }),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 81,
                },
            },
            Step::Run(Millis(500)),
            Step::Settle,
        ],
    );
    assert!(outcome.stats.pending_imports > 0);
    assert!(outcome.stats.converge_rounds > 0);
    assert_eq!(outcome.stats.resets, 0);
}
/// covers: S7:25
#[test]
fn ttl_expires_orphans_without_pushing_expired_rows() {
    let outcome = verify(
        SimConfig::calm(29),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Run(Millis(500)),
            Step::Net(NetStep::Partition(ClientName("a".into()))),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormSet {
                    field: 1,
                    value: 42,
                },
            },
            Step::Run(Millis(200)),
            Step::CrashProfile {
                profile: ProfileName("one".into()),
                mode: CrashMode::ProcessDeath,
            },
            Step::AdvanceWall(Millis(8 * 24 * 60 * 60 * 1_000)),
            Step::ReopenCrashed,
            Step::Settle,
        ],
    );
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(&event.fact, Fact::WalExpired { seqs, .. } if !seqs.is_empty()))
    );
    let expired = outcome
        .events
        .iter()
        .position(|event| matches!(&event.fact, Fact::WalExpired { seqs, .. } if !seqs.is_empty()))
        .unwrap();
    assert!(
        !outcome.events[expired..]
            .iter()
            .any(|event| matches!(event.fact, Fact::PushSent { .. }))
    );
}
/// covers: S7:76, S7:89
#[test]
fn large_form_text_is_one_wal_row_and_multiple_wire_frames() {
    let mut config = SimConfig::calm(31);
    config.net.latency = (Millis(1), Millis(1));
    config.storage.latency = (Millis(1), Millis(1));
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::FormText {
                    field: 1,
                    bytes: 1_200_000,
                    salt: 7,
                },
            },
            Step::Run(Millis(27)),
            Step::Server(ServerStep::Hibernate),
            Step::Settle,
        ],
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact, Fact::PushSent { rows, own_bytes, .. } if rows.len() == 1 && *own_bytes > 900_000)));
    assert!(outcome.events.iter().any(|event| matches!(event.fact, Fact::Frame { kind: FrameKind::Update, frames, .. } if frames > 1)));
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::PendingStored { bytes, chunks, complete: true, .. }
        if *bytes > sync_server_core::domain::operation_chunks::INLINE_BYTES && chunks.len() > 1)));
    println!(
        "large form: own={} bytes, frames={}",
        outcome.stats.own_bytes_pushed, outcome.stats.multi_frame_messages
    );
    assert!(outcome.stats.multi_frame_messages > 0);
    let hibernate = outcome
        .events
        .iter()
        .position(|event| {
            matches!(&event.fact,
        Fact::Server { operation } if operation == "Hibernate")
        })
        .unwrap();
    assert_eq!(
        outcome.events[..hibernate]
            .iter()
            .filter(|event| matches!(&event.fact,
        Fact::Frame { direction: Direction::ToServer, kind: FrameKind::Update, fate, frames, .. }
        if fate == "Delivered" && *frames > 1))
            .count(),
        1
    );
    assert!(
        outcome.events[hibernate..]
            .iter()
            .any(|event| matches!(&event.fact,
        Fact::Frame { direction: Direction::ToServer, kind: FrameKind::Update, fate, frames, .. }
        if fate == "Delivered" && *frames > 1))
    );
}
