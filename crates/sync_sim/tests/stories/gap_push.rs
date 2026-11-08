use sync_sim::*;

// SIM_SEED=280
#[test]
fn resolved_gaps_keep_the_existing_push_contiguous() {
    let mut config = SimConfig::calm(280);
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
        SeedDocument::Form(vec![(4, 62862), (6, 52494), (4, 60332)]),
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
            access: Access::Read,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client3".into()),
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Run(Millis(1000)),
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 31,
            },
        },
        Step::Run(Millis(200)),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 54844,
                value: 62862,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 33510,
                value: 52494,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38604,
                value: 60332,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::Select(Some(19400)),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 19472,
                value: 62453,
            },
        },
        Step::Run(Millis(64)),
        Step::Run(Millis(8)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormMove {
                from: 56364,
                to: 40748,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 40498,
                value: 22709,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 41213,
                value: 47529,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 12522,
                value: 30216,
            },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 4617,
                value: 49034,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 48084,
                to: 62219,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 14059,
                value: 55367,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(4731)),
        },
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 61942,
                value: 53861,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(45071)),
        },
        Step::ClockSkew {
            client: ClientName("client2".into()),
            wall_offset_ms: 329,
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 12762,
                value: 49488,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(28779)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 16740,
                value: 54706,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 26081,
                value: 8792,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 25693,
                value: 42043,
            },
        },
        Step::TokenExpire {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(30879)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 12972,
                value: 27642,
            },
        },
        Step::Freeze {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 36320,
                value: 31674,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 3483,
                value: 47097,
            },
        },
        Step::Thaw {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 58987,
                value: 36871,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 44726,
                value: 51377,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 60478,
                value: 57454,
            },
        },
        Step::Run(Millis(32768)),
        Step::Run(Millis(60000)),
        Step::Server(ServerStep::Hibernate),
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 1261,
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 4670,
                value: 46177,
            },
        },
        Step::Run(Millis(8192)),
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 60160,
                to: 49365,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 59828,
                to: 37873,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15319,
                value: 29408,
            },
        },
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 27749,
                value: 44817,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 22315,
                value: 42202,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 9,
                value: 8942,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 48517,
                value: 25828,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 27116,
                value: 42160,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(4)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 40908,
                value: 49431,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 56161,
                to: 58716,
            },
        },
        Step::TokenFetchFail {
            client: ClientName("client0".into()),
            n: 1,
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 27481,
                value: 1980,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(16384)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 27044,
                value: 15420,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 48048,
                value: 51000,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(7375)),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 43061,
                value: 14309,
            },
        },
        Step::Server(ServerStep::Restart),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 133,
                value: 1166,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 52066,
                value: 40938,
            },
        },
        Step::Run(Millis(64)),
        Step::EditorError {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 57702,
                to: 58816,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 53093,
                value: 30906,
            },
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(28136)),
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(512)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56883,
                value: 29423,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client3".into()),
            count: 1,
        }),
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::TokenExpire {
            client: ClientName("client1".into()),
        },
        Step::CrashProfile {
            profile: ProfileName("profile1".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 24305,
                value: 61254,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 2254,
                value: 2268,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client0".into()))),
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 37660,
                value: 14739,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 55341,
                value: 26831,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 7473,
                value: 43650,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15073,
                value: 25973,
            },
        },
        Step::TokenExpire {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9405,
                value: 55290,
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
            op: AbstractOp::FormSet {
                field: 24544,
                value: 26415,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client3".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 62977,
                value: 4226,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38700,
                value: 46467,
            },
        },
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Run(Millis(512)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56432,
                value: 23705,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(32)),
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(41420)),
        },
        Step::AdvanceWall(Millis(14303)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 29705,
                value: 57557,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 6757,
                value: 56840,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 46760,
                value: 15082,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(27277)),
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
            op: AbstractOp::FormSet {
                field: 2356,
                value: 28803,
            },
        },
        Step::Run(Millis(128)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45826,
                value: 9292,
            },
        },
        Step::Run(Millis(256)),
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 10249,
                value: 22147,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58329,
                value: 60240,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(16)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 44261,
                value: 18872,
            },
        },
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
