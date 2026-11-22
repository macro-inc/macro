use sync_sim::*;

// SIM_SEED=9380156523749996668
#[test]
fn stopped_owner_is_rescanned_before_quiet_capture() {
    let mut config = SimConfig::calm(9380156523749996668);
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
        SeedDocument::Form(vec![(4, 41962), (1, 43956), (5, 595)]),
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
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client2".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client3".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::AiWorker,
        }),
        Step::Run(Millis(1000)),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Latency(Millis(100), Millis(100)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 111,
            },
        },
        Step::Run(Millis(30)),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(150)),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormMove {
                from: 14697,
                to: 43956,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 15389,
                to: 595,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 21682,
                value: 60886,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 20597,
                value: 43775,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45104,
                value: 35942,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 8218,
                value: 9245,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::Run(Millis(16384)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 37785,
                value: 61115,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Server(ServerStep::ExistsProbe),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 63661,
                value: 59709,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 57810,
                value: 17380,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Run(Millis(1)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7256,
                value: 30588,
            },
        },
        Step::Run(Millis(512)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 61154,
                value: 25875,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(8)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 34473,
                value: 19571,
            },
        },
        Step::Run(Millis(32768)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7324,
                value: 58365,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 31567,
                value: 37725,
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
                field: 11438,
                value: 9701,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 36257,
                value: 18274,
            },
        },
        Step::Grant {
            client: ClientName("client3".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 15989,
                value: 22919,
            },
        },
        Step::Run(Millis(64)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client3".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 47283,
                value: 62350,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::EditorError {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8852,
                value: 40958,
            },
        },
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 65482,
                value: 2902,
            },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::ClockSkew {
            client: ClientName("client2".into()),
            wall_offset_ms: -447,
        },
        Step::Run(Millis(2048)),
        Step::Freeze {
            client: ClientName("client3".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 45151,
                value: 816,
            },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Thaw {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormMove {
                from: 29867,
                to: 8577,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 40108,
                to: 11661,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 23886,
                value: 39172,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 21780,
                to: 60611,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 29552,
                to: 54833,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 23497,
                value: 47087,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 42919,
                value: 19420,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::Select(Some(43878)),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 34462,
                value: 64513,
            },
        },
        Step::Run(Millis(2048)),
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 117,
                to: 49419,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(5926)),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 9044,
                value: 14790,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 49685,
                value: 32386,
            },
        },
        Step::Run(Millis(1)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 44943,
                value: 775,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 62859,
                to: 1881,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 39861,
                to: 51609,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 46344,
                value: 20029,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::Select(Some(57144)),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 30537,
                to: 20719,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 64814,
                to: 10995,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(32)),
        Step::Run(Millis(32)),
        Step::Run(Millis(16384)),
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::ClockSkew {
            client: ClientName("client0".into()),
            wall_offset_ms: -2281,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 39522,
                value: 6919,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(46916)),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 52806,
                to: 44419,
            },
        },
        Step::Flush {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38,
                value: 51395,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 47950,
                value: 13614,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 34238,
                value: 57201,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(19956)),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(22765)),
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9529,
                value: 20544,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 3394,
                value: 15240,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 57644,
                value: 63920,
            },
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
            op: AbstractOp::FormMove {
                from: 59161,
                to: 51101,
            },
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 28361,
                value: 38753,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38890,
                value: 34253,
            },
        },
        Step::Run(Millis(2048)),
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 17498,
                value: 64395,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 27457,
                value: 62446,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(24591)),
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
                field: 27754,
                value: 13759,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(31403)),
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    assert!(
        invariants::check_all(&outcome).is_ok(),
        "{}",
        outcome.failure_report()
    );
    outcome.check_replay().unwrap();
}
