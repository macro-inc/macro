use super::*;

// SIM_SEED=9486392389341030173
#[test]
fn delayed_orphan_adoption_drains_before_quiet() {
    let mut config = SimConfig::calm(9486392389341030173);
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
        SeedDocument::Form(vec![(3, 61892), (4, 14078), (7, 57623)]),
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
        Step::Run(Millis(1000)),
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 161,
            },
        },
        Step::Run(Millis(500)),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Read,
            force_reconnect: false,
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 13100,
                value: 14078,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 18327,
                value: 57623,
            },
        },
        Step::Run(Millis(16)),
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 1979,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 57221,
                value: 21953,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 53282,
                value: 32757,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7587,
                value: 44817,
            },
        },
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(53142)),
        },
        Step::Flush {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 17774,
                value: 62213,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(33074)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 44158,
                value: 2268,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 4832,
                to: 56799,
            },
        },
        Step::Run(Millis(4096)),
        Step::Server(ServerStep::ExistsProbe),
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 48590,
                value: 25649,
            },
        },
        Step::Freeze {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(32)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Thaw {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 15755,
                to: 43198,
            },
        },
        Step::Flush {
            client: ClientName("client0".into()),
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 30293,
                value: 26087,
            },
        },
        Step::Run(Millis(60000)),
        Step::Run(Millis(512)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 63548,
                value: 29896,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 26378,
                value: 60709,
            },
        },
        Step::EditorError {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 36941,
                value: 21441,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1257,
                value: 44693,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 30564,
                value: 54046,
            },
        },
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 36005,
                value: 17393,
            },
        },
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 26979,
                value: 28961,
            },
        },
        Step::Run(Millis(16)),
        Step::Run(Millis(8192)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::PowerLoss { window: Millis(41) },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(53846)),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 2329,
                value: 6121,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 37888,
                value: 23697,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 31618,
                value: 5560,
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
            op: AbstractOp::Select(Some(46381)),
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Run(Millis(8192)),
        Step::Run(Millis(2)),
        Step::Offline {
            client: ClientName("client1".into()),
            offline: true,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 59410,
                value: 33147,
            },
        },
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::Run(Millis(1)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(26890)),
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
                field: 29857,
                value: 47052,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 44430,
                value: 28284,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::TokenExpire {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 40418,
                value: 24757,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 6762,
                value: 33958,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 20364,
                value: 23605,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(2)),
        Step::AdvanceWall(Millis(46974)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 25398,
                to: 55550,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8323,
                value: 50104,
            },
        },
        Step::Host {
            client: ClientName("client1".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 33267,
                value: 19482,
            },
        },
        Step::Run(Millis(32768)),
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 521,
        },
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Run(Millis(60000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 18140,
                value: 26713,
            },
        },
        Step::Run(Millis(1)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 12927,
                value: 59656,
            },
        },
        Step::Run(Millis(2)),
        Step::Run(Millis(1024)),
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8496,
                value: 63474,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 64271,
                value: 25813,
            },
        },
        Step::Run(Millis(16)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 2460,
                value: 48754,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(44103)),
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 1347,
                value: 26771,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(11796)),
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 47799,
                value: 117,
            },
        },
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 2047,
                value: 62156,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 43061,
                value: 32098,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 5541,
                value: 59521,
            },
        },
        Step::Run(Millis(32768)),
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Read,
            force_reconnect: false,
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    invariants::check_all(&outcome).unwrap();
    outcome.check_replay().unwrap();
    assert!(outcome.events.iter().any(
        |event| matches!(event.fact, Fact::WalAdopted { ref removed, .. } if !removed.is_empty())
    ));
}
