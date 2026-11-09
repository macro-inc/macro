use super::*;

// SIM_SEED=17
#[test]
fn startup_adoption_precedes_editor_attachment_and_dependent_edits() {
    let mut config = SimConfig::calm(17);
    config.fields = 8;
    config.documents = 1;
    config.per_step = true;
    config.ties = TieMode::Fifo;
    config.net = NetProfile {
        latency: (Millis(5), Millis(20)),
        connect_latency: (Millis(10), Millis(30)),
        break_per_frame: 0.001,
        hostile: None,
    };
    config.storage = StorageProfile {
        latency: (Millis(2), Millis(40)),
    };
    config.budgets = Budgets {
        settle: Millis(180000),
        quiet: Millis(60000),
        max_events: 2000000,
    };
    config.server_storage_latency = Millis(2);
    config.seeds.insert(DocIx(0), SeedDocument::Editor(serde_json::json!({"root":{"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[{"type":"text","version":1,"text":"initial shared editor text","format":0,"detail":0,"mode":"normal","style":""}]}]}})));
    config.session.transport = TransportKind::Direct;
    config.session.timeouts = doc_sync_core::Timeouts {
        initial_sync: doc_sync_core::Millis(10000),
        ack: doc_sync_core::Millis(5000),
        snapshot: doc_sync_core::Millis(10000),
        request_since: doc_sync_core::Millis(10000),
        connect: doc_sync_core::Millis(15000),
        storage: doc_sync_core::Millis(10000),
    };
    config.session.heartbeat = doc_sync_core::HeartbeatPolicy {
        interval: doc_sync_core::Millis(10000),
        timeout: doc_sync_core::Millis(5000),
        max_missed: 2,
    };
    config.session.backoff = doc_sync_core::BackoffPolicy {
        base: doc_sync_core::Millis(250),
        max_exponent: 5,
        max_retries: 20,
    };
    config.session.converge = doc_sync_core::ConvergePolicy {
        max_attempts: 3,
        retry_delay: doc_sync_core::Millis(2000),
    };
    config.session.wal = doc_sync_core::WalPolicy {
        coalesce: doc_sync_core::Millis(25),
        ttl: doc_sync_core::Millis(604800000),
        retry_unacked_after: doc_sync_core::Millis(5000),
    };
    config.session.reset_budget = doc_sync_core::ResetBudget {
        max: 3,
        window: doc_sync_core::Millis(60000),
    };
    config.session.snapshot_interval = Some(doc_sync_core::Millis(5000));
    config.session.presence_timeout = doc_sync_core::WallDuration(5000);
    config.session.presence_refresh = Some(doc_sync_core::Millis(3000));
    let outcome = verify(
        config,
        &[
            Step::Open(OpenSpec {
                client: ClientName("client1".into()),
                profile: ProfileName("profile1".into()),
                doc: DocIx(0),
                access: Access::Edit,
                kind: ClientKind::Tab,
            }),
            Step::Open(OpenSpec {
                client: ClientName("client2".into()),
                profile: ProfileName("profile2".into()),
                doc: DocIx(0),
                access: Access::Edit,
                kind: ClientKind::Tab,
            }),
            // Durable startup now waits for its load/adoption barrier before
            // admitting editor input. Keep this replay-fixup workload initialized.
            Step::Run(Millis(500)),
            Step::Edit {
                client: ClientName("client2".into()),
                op: AbstractOp::Editor(EditorOp::ToggleList {
                    at: Pos {
                        block: 7509,
                        offset: 38770,
                    },
                    kind: 1,
                }),
            },
            Step::Close {
                client: ClientName("client2".into()),
            },
            Step::Edit {
                client: ClientName("client1".into()),
                op: AbstractOp::Editor(EditorOp::ToggleList {
                    at: Pos {
                        block: 44844,
                        offset: 14262,
                    },
                    kind: 0,
                }),
            },
            Step::Run(Millis(8192)),
            Step::Reopen {
                client: ClientName("client2".into()),
            },
            Step::Run(Millis(1000)),
            Step::Edit {
                client: ClientName("client2".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos {
                        block: 43131,
                        offset: 0,
                    },
                    text: "🦀x".into(),
                }),
            },
            Step::Settle,
        ],
    );
    let client = &outcome.finals.clients[&ClientName("client2".into())];
    let peer = client.peer;
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::LocalCommit {client: name,spans} if name.0=="client2" && spans.iter().any(|span|span.peer==peer && span.start==0))));
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::WalAppendIssued {session,spans,..} if *session==client.session && spans.iter().any(|span|span.peer==peer && span.start==0))));
    assert_eq!(client.wal_undelivered, 0);
    assert_eq!(
        outcome.finals.servers[&DocIx(0)].persisted_vv.get(&peer),
        client.oplog_vv.get(&peer)
    );
    // Startup now replays before model attachment, avoiding the former own
    // repair operation. Both user characters still require durable delivery.
    assert_eq!(client.oplog_vv.get(&peer), Some(&2));
    for author in ["client1", "client2"] {
        assert!(outcome.events.iter().any(|event| matches!(&event.fact,
            Fact::LocalOp { client, op: AbstractOp::Editor(EditorOp::ToggleList { .. }), spans }
                if client.0 == author && !spans.is_empty())));
    }
    let seeded = outcome
        .events
        .iter()
        .position(|event| {
            matches!(&event.fact,
        Fact::Seeded { session, replayed_wal, .. }
            if *session == client.session && *replayed_wal > 0)
        })
        .unwrap();
    assert!(
        outcome.events[..seeded]
            .iter()
            .any(|event| matches!(&event.fact,
        Fact::WalAdoptionCompleted { session, .. } if *session == client.session))
    );
    let own = outcome
        .events
        .iter()
        .position(|event| {
            matches!(&event.fact,
        Fact::LocalCommit { client: name, spans }
            if name.0 == "client2" && spans.iter().any(|span| span.peer == peer && span.start == 0))
        })
        .unwrap();
    assert!(seeded < own);
}
