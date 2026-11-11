use sync_sim::*;

// SIM_SEED=359
#[test]
fn first_presence_snapshot_survives_later_heartbeat_restarts() {
    let mut config = SimConfig::calm(359);
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
        SeedDocument::Form(vec![(2, 13278), (5, 54137), (2, 29310)]),
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
            access: Access::CommentOnly,
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
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 14882,
                value: 13278,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 24349,
                value: 54137,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 64722,
                value: 29310,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 41230,
                value: 55243,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 4645,
                value: 59203,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 42235,
                value: 34656,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(34472)),
        },
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::PowerLoss { window: Millis(84) },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 5311,
                value: 49822,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 11583,
                value: 8260,
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
                field: 59018,
                value: 11246,
            },
        },
        Step::Freeze {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Run(Millis(16384)),
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 19093,
                value: 23130,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Thaw {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 41547,
                to: 27760,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 19314,
                value: 16328,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(8983)),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(23569)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 11639,
                value: 45685,
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
            op: AbstractOp::FormSet {
                field: 55304,
                value: 3586,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 64739,
                value: 61968,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 21177,
                value: 9078,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 5481,
                value: 17981,
            },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::CrashProfile {
            profile: ProfileName("profile1".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Run(Millis(32)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 940,
                value: 19667,
            },
        },
        Step::Flush {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(60000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 145,
                value: 7073,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38052,
                value: 1965,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(34918)),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 908,
                value: 55280,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 46061,
                to: 44771,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Storage {
            profile: ProfileName("profile2".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 34509,
                value: 45019,
            },
        },
        Step::Freeze {
            client: ClientName("client1".into()),
        },
        Step::Server(ServerStep::ExistsProbe),
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Thaw {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 20965,
                value: 37962,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Host {
            client: ClientName("client2".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 45823,
                value: 49521,
            },
        },
        Step::Run(Millis(2)),
        Step::Storage {
            profile: ProfileName("profile2".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 48006,
                value: 60457,
            },
        },
        Step::EditorError {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 6152,
                value: 24808,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 32118,
                value: 38073,
            },
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(9210)),
        },
        Step::Offline {
            client: ClientName("client2".into()),
            offline: true,
        },
        Step::Run(Millis(4)),
        Step::Storage {
            profile: ProfileName("profile1".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 13424,
                value: 38343,
            },
        },
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 28733,
                to: 30559,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Offline {
            client: ClientName("client1".into()),
            offline: true,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 3906,
                value: 33187,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 26373,
                value: 18940,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7848,
                value: 64606,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 6511,
                value: 38065,
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
            op: AbstractOp::FormSet {
                field: 40580,
                value: 31601,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 36469,
                value: 47368,
            },
        },
        Step::Run(Millis(8)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 33908,
                value: 15452,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Run(Millis(2048)),
        Step::Run(Millis(1)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 3818,
                value: 53733,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 63307,
                value: 1788,
            },
        },
        Step::Host {
            client: ClientName("client2".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Run(Millis(1)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 25198,
                value: 24738,
            },
        },
        Step::Run(Millis(2048)),
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 10741,
                to: 38066,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(12333)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(32120)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7868,
                value: 14486,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 36744,
                value: 4500,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: -2488,
        },
        Step::Run(Millis(16384)),
        Step::Run(Millis(512)),
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Run(Millis(8)),
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 18884,
                to: 23608,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 42272,
                value: 42597,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 48369,
                value: 43815,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 43068,
                value: 27403,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15112,
                value: 59298,
            },
        },
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 45878,
                value: 19493,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 60810,
                value: 46691,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 20593,
                value: 33586,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 37947,
                to: 39254,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 51914,
                value: 58106,
            },
        },
        Step::TokenExpire {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 1601,
                value: 59476,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(35616)),
        },
        Step::Run(Millis(1024)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 58420,
                value: 35595,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client0".into()))),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 48014,
                value: 2219,
            },
        },
        Step::Run(Millis(2048)),
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
