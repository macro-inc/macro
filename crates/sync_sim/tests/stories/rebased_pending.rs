use sync_sim::*;

/// covers: S7:12, S7:16; coverage seed8, successful replacement after delayed history.
// SIM_SEED=8
#[test]
fn replacement_after_late_history_clears_pending_import() {
    let mut config = SimConfig::calm(8);
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
        SeedDocument::Cached {
            server: vec![],
            s3: None,
            local: None,
        },
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
        Step::Run(Millis(1000)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 91,
            },
        },
        Step::Run(Millis(1000)),
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 92,
            },
        },
        Step::Run(Millis(100)),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 2,
                value: 93,
            },
        },
        Step::Run(Millis(100)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 21214,
                value: 65384,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 6101,
                value: 10402,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 62024,
                value: 8737,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 3585,
                value: 39032,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 30295,
                value: 47559,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 39791,
                value: 47816,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 47336,
                value: 5525,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 55635,
                value: 5300,
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
            op: AbstractOp::FormSet {
                field: 24351,
                value: 40439,
            },
        },
        Step::Freeze {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(16384)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Thaw {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56871,
                value: 3092,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 14462,
                to: 30034,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 7471,
                value: 49951,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 52916,
                value: 55718,
            },
        },
        Step::Flush {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 25381,
                value: 6441,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 59100,
                value: 7292,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 414,
                to: 13994,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 39702,
                value: 431,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 26931,
                value: 32277,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client0".into()))),
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(26624)),
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Server(ServerStep::ExistsProbe),
        Step::Run(Millis(2048)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 62344,
                value: 24829,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 44341,
                value: 34961,
            },
        },
        Step::Run(Millis(4)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 26326,
                value: 12710,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::ClockSkew {
            client: ClientName("client0".into()),
            wall_offset_ms: -168,
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 522,
                value: 49257,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 4753,
                value: 8416,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 8205,
                value: 56046,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 17215,
                value: 57064,
            },
        },
        Step::Flush {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Offline {
            client: ClientName("client0".into()),
            offline: true,
        },
        Step::Run(Millis(256)),
        Step::Run(Millis(16)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 44554,
                value: 40893,
            },
        },
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: -2174,
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 54535,
                value: 25728,
            },
        },
        Step::Run(Millis(60000)),
        Step::Run(Millis(16384)),
        Step::Run(Millis(8192)),
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 42302,
                value: 55275,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45174,
                value: 55044,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 17333,
                value: 60578,
            },
        },
        Step::Run(Millis(1024)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 28444,
                value: 3411,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(32768)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45013,
                value: 7711,
            },
        },
        Step::ClockSkew {
            client: ClientName("client0".into()),
            wall_offset_ms: 567,
        },
        Step::Flush {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(4096)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 26532,
                value: 11871,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 46107,
                value: 8172,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 12595,
                value: 53968,
            },
        },
        Step::TokenFetchFail {
            client: ClientName("client0".into()),
            n: 1,
        },
        Step::Run(Millis(16384)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(15256)),
        },
        Step::Run(Millis(60000)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 4734,
                value: 44755,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 41120,
                value: 42640,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(8192)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Run(Millis(1024)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 10320,
                value: 40942,
            },
        },
        Step::Run(Millis(2048)),
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 34887,
                value: 41277,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Flush {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 65269,
                value: 34411,
            },
        },
        Step::Run(Millis(4)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 1411,
                value: 45052,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 6414,
                value: 35568,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 19761,
                value: 7228,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Run(Millis(32768)),
        Step::Net(NetStep::Partition(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 5003,
                value: 11788,
            },
        },
        Step::Run(Millis(2048)),
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 31723,
                value: 65026,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 3847,
                value: 12778,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 43517,
                value: 20827,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 25189,
                value: 56609,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Host {
            client: ClientName("client1".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58772,
                value: 37263,
            },
        },
        Step::Run(Millis(32)),
        Step::Run(Millis(60000)),
        Step::Net(NetStep::Partition(ClientName("client1".into()))),
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 20088,
                value: 16970,
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
                field: 41663,
                value: 30829,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 29276,
                value: 16464,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 43557,
                value: 2564,
            },
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 88,
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client1".into()))),
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Host {
            client: ClientName("client0".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 25670,
                value: 16465,
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
                field: 27622,
                value: 46346,
            },
        },
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
