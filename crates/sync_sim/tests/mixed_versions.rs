//! Shipping TS engine/WAL/mirror against native clients on the same real SimServer.
#[path = "support/mixed.rs"]
mod mixed;
#[path = "support/peer_protocol.rs"]
mod peer_protocol;
#[path = "support/ts_child.rs"]
mod ts_child;
use mixed::Mixed;
use peer_protocol::*;
use sync_sim::*;

#[test]
fn generated_peer_types_match_the_rust_contract() {
    assert_eq!(
        peer_protocol::typescript(),
        include_str!("../../../tooling/sync-sim/generated.ts")
    );
}
fn native_and_ts(seed: u64, shared: bool) -> (Outcome, Vec<String>) {
    let mut world = Mixed::new(seed);
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "one")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world.open("ts", if shared { "one" } else { "two" });
    world.pump(500);
    world.command(
        "ts",
        PeerCommand::Edit {
            client: "ts".into(),
            field: 1,
            value: 41,
        },
    );
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 42,
            },
        })
        .unwrap();
    world.pump(1_000);
    world.command(
        "ts",
        PeerCommand::Move {
            client: "ts".into(),
            from: 7,
            to: 0,
        },
    );
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::FormMove { from: 1, to: 5 },
        })
        .unwrap();
    world.pump(1_000);
    let (outcome, peers, wire) = world.finish();
    let peer = &peers[&ClientName("ts".into())];
    assert!(peer.initialized);
    assert!(peer.rows.iter().all(|row| row.delivered));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&peer.value_json).unwrap(),
        outcome.finals.servers[&DocIx(0)].deep_value
    );
    let vv = peer
        .vv
        .iter()
        .map(|(id, counter)| (id.parse().unwrap(), *counter))
        .collect::<Vv>();
    assert_eq!(vv, outcome.finals.servers[&DocIx(0)].persisted_vv);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        41
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["2"],
        42
    );
    (outcome, wire)
}
#[test]
fn current_native_and_branch_pinned_ts_converge_over_real_bebop_frames() {
    let (first, wire) = native_and_ts(197, false);
    let (again, replayed) = native_and_ts(197, false);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
}
#[test]
fn native_and_ts_broadcastchannel_updates_interoperate() {
    let (first, wire) = native_and_ts(199, true);
    let (again, replayed) = native_and_ts(199, true);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
    assert!(first.stats.foreign_rows > 0);
}

fn native_adopts_ts_rows(seed: u64) -> (Outcome, Vec<String>) {
    let mut world = Mixed::new(seed);
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "other")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world.open("ts", "shared");
    world.pump(500);
    world
        .sim
        .apply_step(Step::Net(NetStep::Partition(ClientName("ts".into()))))
        .unwrap();
    world.command(
        "ts",
        PeerCommand::Edit {
            client: "ts".into(),
            field: 1,
            value: 17,
        },
    );
    let rows = world.finals[&ClientName("ts".into())].rows.clone();
    assert!(!rows.is_empty());
    assert!(rows.iter().all(|row| !row.delivered && row.owner.is_none()));
    world.command(
        "ts",
        PeerCommand::Crash {
            client: "ts".into(),
        },
    );
    let records = rows
        .into_iter()
        .map(|row| doc_sync_core::WalRecord {
            seq: doc_sync_core::WalSeq(u64::from(row.id)),
            created_at: doc_sync_core::UnixMillis(row.created_at.parse().unwrap()),
            user: doc_sync_core::UserKey("user-0".into()),
            foreign: false,
            quarantined: false,
            bytes: row.update,
        })
        .collect();
    world
        .sim
        .import_legacy_rows(ProfileName("shared".into()), DocIx(0), records)
        .unwrap();
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("recovered", "shared")))
        .unwrap();
    world.pump(2_000);
    let (outcome, _, wire) = world.finish();
    assert!(outcome.stats.adopted_rows > 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        17
    );
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::WalAdopted { from: doc_sync_core::WalOwner::Legacy, map, .. } if !map.is_empty())));
    (outcome, wire)
}

fn ts_delivers_native_rows(seed: u64) -> (Outcome, Vec<String>) {
    let mut world = Mixed::new(seed);
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "shared")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world
        .sim
        .apply_step(Step::Net(NetStep::Partition(ClientName("native".into()))))
        .unwrap();
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 23,
            },
        })
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(100))).unwrap();
    world
        .sim
        .apply_step(Step::Crash {
            client: ClientName("native".into()),
        })
        .unwrap();
    let rows = world
        .sim
        .profile_image(&ProfileName("shared".into()))
        .unwrap()
        .entries
        .iter()
        .filter(|(_, row)| !row.delivered)
        .map(|((_, owner, seq), row)| PeerWalRow {
            id: u32::try_from(seq.0).unwrap(),
            update: row.record.bytes.clone(),
            delivered: false,
            created_at: row.record.created_at.0.to_string(),
            owner: match owner {
                doc_sync_core::WalOwner::Session(id) => Some(id.0.to_string()),
                doc_sync_core::WalOwner::Legacy => None,
            },
        })
        .collect::<Vec<_>>();
    assert!(!rows.is_empty());
    let owner = rows[0].owner.clone().unwrap();
    world.install_rows("shared", rows);
    world.open("ts", "shared");
    world.pump(2_000);
    let peer = &world.finals[&ClientName("ts".into())];
    assert!(
        peer.rows
            .iter()
            .all(|row| row.delivered && row.owner.as_ref() == Some(&owner))
    );
    world.sim.apply_step(Step::ReopenCrashed).unwrap();
    world.pump(1_000);
    let (outcome, peers, wire) = world.finish();
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["1"],
        23
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&peers[&ClientName("ts".into())].value_json)
            .unwrap(),
        outcome.finals.servers[&DocIx(0)].deep_value
    );
    (outcome, wire)
}

#[test]
fn foreign_runtime_preserves_real_server_close_codes() {
    let mut world = Sim::new(SimConfig::calm(227));
    world
        .register_external(OpenSpec::form("first", "one"))
        .unwrap();
    world.connect_external(&ClientName("first".into())).unwrap();
    world.apply_step(Step::Run(Millis(200))).unwrap();
    world
        .apply_step(Step::Server(ServerStep::Evict {
            close_sockets: true,
        }))
        .unwrap();
    assert!(
        world
            .external_events(&ClientName("first".into()))
            .contains(&ExternalEvent::Closed(1000))
    );
}

fn ts_browser_reopen(seed: u64) -> (Outcome, Vec<String>) {
    let mut world = Mixed::new(seed);
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "other")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world.open("old", "browser");
    world.pump(500);
    world
        .sim
        .apply_step(Step::Net(NetStep::Partition(ClientName("old".into()))))
        .unwrap();
    world.command(
        "old",
        PeerCommand::Edit {
            client: "old".into(),
            field: 3,
            value: 29,
        },
    );
    let retained = world.finals[&ClientName("old".into())].rows.clone();
    assert!(!retained.is_empty());
    assert!(retained.iter().all(|row| !row.delivered));
    world.command(
        "old",
        PeerCommand::Crash {
            client: "old".into(),
        },
    );
    world.open("reopened", "browser");
    world.pump(2_000);
    let (outcome, peers, wire) = world.finish();
    let peer = &peers[&ClientName("reopened".into())];
    assert!(peer.initialized);
    for before in &retained {
        assert!(peer.rows.iter().any(|after| after.id == before.id
            && after.update == before.update
            && after.delivered));
    }
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&peer.value_json).unwrap(),
        outcome.finals.servers[&DocIx(0)].deep_value
    );
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].deep_value["fields"]["3"],
        29
    );
    let vv = peer
        .vv
        .iter()
        .map(|(id, counter)| (id.parse().unwrap(), *counter))
        .collect::<Vv>();
    assert_eq!(vv, outcome.finals.servers[&DocIx(0)].persisted_vv);
    (outcome, wire)
}

#[test]
fn real_ts_browser_reopens_committed_rows_without_an_adapter_copy() {
    let (first, wire) = ts_browser_reopen(229);
    let (again, replayed) = ts_browser_reopen(229);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
}

#[test]
fn native_client_adopts_actual_legacy_rows_from_the_ts_browser_wal() {
    let (first, wire) = native_adopts_ts_rows(211);
    let (again, replayed) = native_adopts_ts_rows(211);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
}

#[test]
fn old_ts_bundle_delivers_actual_native_rows_and_preserves_owner_metadata() {
    let (first, wire) = ts_delivers_native_rows(223);
    let (again, replayed) = ts_delivers_native_rows(223);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
}

fn editor_native_and_shipping_worker(seed: u64) -> (Outcome, Vec<String>) {
    let mut world = Mixed::with_config(SimConfig::editor(seed));
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "one")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world.open_editor("editor", "two");
    world.pump(500);
    world.command(
        "editor",
        PeerCommand::Editor {
            client: "editor".into(),
            op: EditorOp::Type {
                at: Pos::default(),
                text: "ts🦀 ".into(),
            },
        },
    );
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 5,
                },
                text: "native ".into(),
            }),
        })
        .unwrap();
    world.pump(1000);
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::Editor(EditorOp::Undo),
        })
        .unwrap();
    world.pump(500);
    world.command(
        "editor",
        PeerCommand::Editor {
            client: "editor".into(),
            op: EditorOp::Format {
                from: Pos::default(),
                to: Pos {
                    block: 0,
                    offset: 2,
                },
                format: 0,
            },
        },
    );
    world.pump(500);
    world.command(
        "editor",
        PeerCommand::Editor {
            client: "editor".into(),
            op: EditorOp::SetBlock {
                at: Pos::default(),
                kind: 4,
            },
        },
    );
    world.pump(500);
    world.command(
        "editor",
        PeerCommand::Editor {
            client: "editor".into(),
            op: EditorOp::InsertTable {
                at: Pos::default(),
                rows: 1,
                cols: 1,
            },
        },
    );
    world.pump(1000);
    let (outcome, peers, wire) = world.finish();
    let peer = &peers[&ClientName("editor".into())];
    assert!(peer.initialized);
    assert!(peer.rows.iter().all(|row| row.delivered));
    let editor: serde_json::Value =
        serde_json::from_str(peer.editor_json.as_ref().unwrap()).unwrap();
    let native = outcome.finals.clients[&ClientName("native".into())]
        .editor
        .as_ref()
        .unwrap();
    assert_eq!(editor, native.synced_json);
    assert_eq!(editor, native.reconstructed);
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&peer.value_json).unwrap(),
        outcome.finals.servers[&DocIx(0)].deep_value
    );
    let vv = peer
        .vv
        .iter()
        .map(|(peer, counter)| (peer.parse().unwrap(), *counter))
        .collect::<Vv>();
    assert_eq!(vv, outcome.finals.servers[&DocIx(0)].persisted_vv);
    let ai_peers = outcome
        .events
        .iter()
        .filter_map(|event| match &event.fact {
            Fact::ExternalCommit { client, spans, .. } if client.0 == "editor" => Some(spans),
            _ => None,
        })
        .flatten()
        .map(|span| span.peer)
        .collect::<std::collections::BTreeSet<_>>();
    assert!(
        ai_peers.len() > 1,
        "real workspace rotates its authoring peer"
    );
    for peer in ai_peers {
        assert!(
            (doc_sync_core::AI_PEER_BASE
                ..doc_sync_core::AI_PEER_BASE + doc_sync_core::AI_PEER_COUNT)
                .contains(&peer)
        );
        assert!(
            !outcome.finals.servers[&DocIx(0)]
                .active_peers_without_ai
                .contains(&peer)
        );
    }
    assert!(editor.to_string().contains("ts"));
    assert!(!editor.to_string().contains("native "));
    let blocks = editor["root"]["children"].as_array().unwrap();
    assert!(blocks.iter().any(|block| block["type"] == "quote"));
    let table = blocks
        .iter()
        .find(|block| block["type"] == "table")
        .unwrap();
    assert_eq!(table["children"].as_array().unwrap().len(), 2);
    assert!(
        outcome
            .events
            .iter()
            .any(|event| matches!(event.fact, Fact::UndoApplied { .. }))
    );
    (outcome, wire)
}

#[test]
fn real_shipping_editor_workspace_interoperates_with_native_sessions_and_replays_exactly() {
    let (first, wire) = editor_native_and_shipping_worker(761);
    let (again, replayed) = editor_native_and_shipping_worker(761);
    first.compare_replay(&again).unwrap();
    assert_eq!(wire, replayed);
}

fn markdown_native_and_shipping_worker(seed: u64, snippet: u8) -> (Outcome, Vec<String>) {
    let mut world = Mixed::with_config(SimConfig::editor(seed));
    world
        .sim
        .apply_step(Step::Open(OpenSpec::form("native", "one")))
        .unwrap();
    world.sim.apply_step(Step::Run(Millis(500))).unwrap();
    world.open_editor("editor", "two");
    world.pump(500);
    world.command(
        "editor",
        PeerCommand::Editor {
            client: "editor".into(),
            op: EditorOp::PasteMarkdown {
                at: Pos::default(),
                snippet,
            },
        },
    );
    world.pump(500);
    world
        .sim
        .apply_step(Step::Edit {
            client: ClientName("native".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos::default(),
                text: "native🦀".into(),
            }),
        })
        .unwrap();
    world.pump(500);
    let (outcome, peers, wire) = world.finish();
    let peer = &peers[&ClientName("editor".into())];
    let editor: serde_json::Value =
        serde_json::from_str(peer.editor_json.as_ref().unwrap()).unwrap();
    let native = outcome.finals.clients[&ClientName("native".into())]
        .editor
        .as_ref()
        .unwrap();
    assert_eq!(editor, native.synced_json);
    assert_eq!(editor, native.reconstructed);
    assert!(peer.rows.iter().all(|row| row.delivered));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&peer.value_json).unwrap(),
        outcome.finals.servers[&DocIx(0)].deep_value
    );
    let vv = peer
        .vv
        .iter()
        .map(|(peer, counter)| (peer.parse().unwrap(), *counter))
        .collect::<Vv>();
    assert_eq!(vv, outcome.finals.servers[&DocIx(0)].persisted_vv);
    (outcome, wire)
}
#[test]
fn real_shipping_markdown_pastes_interoperate_and_replay_exactly() {
    for snippet in 0..3 {
        let (first, wire) = markdown_native_and_shipping_worker(809 + u64::from(snippet), snippet);
        let (again, replayed) =
            markdown_native_and_shipping_worker(809 + u64::from(snippet), snippet);
        first.compare_replay(&again).unwrap();
        assert_eq!(wire, replayed);
    }
}
