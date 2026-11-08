use sync_sim::*;

// SIM_SEED=414
#[test]
fn adopted_history_with_a_server_parent_survives_cold_recovery() {
    let mut config = SimConfig::calm(414);
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
    config.seeds.insert(
        DocIx(0),
        SeedDocument::Form(vec![(1, 32884), (6, 3344), (0, 16274)]),
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
            profile: ProfileName("profile2".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client3".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Read,
            kind: ClientKind::AiWorker,
        }),
        Step::Run(Millis(1000)),
        Step::Net(NetStep::DropNext {
            client: ClientName("client1".into()),
            direction: Direction::ToClient,
            kind: Some(FrameKind::RemoteUpdate),
            frames: 1,
        }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 21,
            },
        },
        Step::Run(Millis(200)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 22,
            },
        },
        Step::Run(Millis(200)),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 29377,
                value: 32884,
            },
        },
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1784,
                value: 16274,
            },
        },
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 24657,
                value: 6338,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 25417,
                value: 29607,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::TokenExpire {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 51902,
                to: 32778,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 12786,
                value: 17387,
            },
        },
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 443,
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 39009,
                value: 49145,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9695,
                value: 7441,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 33628,
                value: 14101,
            },
        },
        Step::Server(ServerStep::Hibernate),
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 6108,
                value: 56914,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 18505,
                value: 25009,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 14994,
                value: 11454,
            },
        },
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 54863,
                value: 45905,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(54478)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 41977,
                value: 51961,
            },
        },
        Step::Run(Millis(32)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 55430,
                to: 16495,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 64394,
                value: 6953,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 32379,
                value: 12659,
            },
        },
        Step::Flush {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client3".into()),
            count: 1,
        }),
        Step::TokenExpire {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(16)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 62261,
                value: 31025,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 59130,
                value: 3385,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1024)),
        Step::Host {
            client: ClientName("client2".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Run(Millis(16)),
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Run(Millis(2048)),
        Step::Run(Millis(32)),
        Step::Run(Millis(128)),
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 17267,
                value: 65249,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 50675,
                value: 13700,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 26871,
                to: 3627,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 63433,
                value: 2787,
            },
        },
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 39210,
                to: 17263,
            },
        },
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 33203,
                value: 34665,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 32558,
                value: 36925,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
