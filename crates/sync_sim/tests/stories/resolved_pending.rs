use sync_sim::*;

#[test]
fn acknowledged_pending_suffix_reaches_rejoining_generic_reader() {
    let mut config = SimConfig::calm(863071831848423222);
    config.fields = 8;
    config.server_operation_archive_writes = true;
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
    config.seeds.insert(
        DocIx(0),
        SeedDocument::Form(vec![(0, 769), (0, 1), (0, 15817)]),
    );
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
    let outcome = Sim::new(config).run(&[
        Step::Open(OpenSpec {
            client: ClientName("client0".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client1".into()),
            profile: ProfileName("profile1".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client2".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::AiWorker,
        }),
        Step::Run(Millis(1000)),
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Run(Millis(240000)),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 1 },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Run(Millis(4096)),
        Step::Run(Millis(1024)),
        Step::Run(Millis(256)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet { field: 0, value: 0 },
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 2681,
            },
        },
        Step::Run(Millis(16384)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 9281 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 0 },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 1 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 1 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 221 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 1601 },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove { from: 0, to: 41460 },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove { from: 0, to: 0 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove { from: 0, to: 1 },
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}

#[test]
fn acknowledged_pending_text_reaches_rejoining_editor() {
    let mut config = SimConfig::calm(863071831848423222);
    config.fields = 8;
    config.server_operation_archive_writes = true;
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
    config.seeds.insert(DocIx(0), SeedDocument::Editor(serde_json::json!({"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"x"}]}]}})));
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
    let outcome = Sim::new(config).run(&[
        Step::Open(OpenSpec {
            client: ClientName("client0".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client1".into()),
            profile: ProfileName("profile1".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client2".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::AiWorker,
        }),
        Step::Run(Millis(1000)),
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Run(Millis(240000)),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Run(Millis(4096)),
        Step::Run(Millis(1024)),
        Step::Run(Millis(256)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "value0".into(),
            }),
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "value2681".into(),
            }),
        },
        Step::Run(Millis(16384)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "".into(),
            }),
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "".into(),
            }),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Editor(EditorOp::Type {
                at: Pos {
                    block: 0,
                    offset: 0,
                },
                text: "A".into(),
            }),
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
