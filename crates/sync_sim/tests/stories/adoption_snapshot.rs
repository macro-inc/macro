use sync_sim::*;

// SIM_SEED=246
#[test]
fn replaced_snapshot_cover_cannot_change_adoption_sequence_reservations() {
    let mut config = SimConfig::calm(246);
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
        SeedDocument::Form(vec![(4, 52710), (7, 13323), (6, 54279)]),
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
            access: Access::Read,
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
            profile: ProfileName("profile1".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormText {
                field: 0,
                bytes: 1200000,
                salt: 7,
            },
        },
        Step::Run(Millis(200)),
        Step::Server(ServerStep::Hibernate),
        Step::ReopenCrashed,
        Step::Settle,
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56556,
                value: 52710,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Run(Millis(2)),
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(512)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::Select(Some(16111)),
        },
        Step::Run(Millis(32768)),
        Step::Flush {
            client: ClientName("client3".into()),
        },
        Step::Offline {
            client: ClientName("client2".into()),
            offline: true,
        },
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 4567,
                value: 17100,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 53477,
                value: 16163,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(16)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 64859,
                to: 57550,
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
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 37824,
                value: 39734,
            },
        },
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Run(Millis(16)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 65153,
                value: 1243,
            },
        },
        Step::Run(Millis(2)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 25059,
                value: 3228,
            },
        },
        Step::AdvanceWall(Millis(51166)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 23663,
                value: 27945,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38518,
                value: 33972,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 2597,
                to: 55710,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 35074,
                value: 17053,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 56656,
                value: 22852,
            },
        },
        Step::Run(Millis(8)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 32024,
                value: 29721,
            },
        },
        Step::TokenFetchFail {
            client: ClientName("client2".into()),
            n: 1,
        },
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 6772,
                value: 64072,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::TokenFetchFail {
            client: ClientName("client0".into()),
            n: 1,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 39374,
                value: 58672,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 615,
                value: 726,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(34385)),
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
                field: 26492,
                value: 63544,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 38799,
                value: 64796,
            },
        },
        Step::Server(ServerStep::Restart),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 2809,
                value: 49534,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(51679)),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 22541,
                value: 42918,
            },
        },
        Step::Freeze {
            client: ClientName("client2".into()),
        },
        Step::TokenFetchFail {
            client: ClientName("client3".into()),
            n: 1,
        },
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 52291,
                value: 1576,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1988,
                value: 18385,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Thaw {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 20847,
                value: 48245,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 50533,
                value: 22680,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Flush {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 49781,
                value: 65253,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 48847,
                value: 61301,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 64010,
                value: 25606,
            },
        },
        Step::EditorError {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(26548)),
        },
        Step::TokenExpire {
            client: ClientName("client3".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Run(Millis(2)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15424,
                value: 63523,
            },
        },
        Step::Run(Millis(16384)),
        Step::Run(Millis(16)),
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(63253)),
        },
        Step::Run(Millis(512)),
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 44833,
                value: 52584,
            },
        },
        Step::Run(Millis(16)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 53443,
                value: 46176,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 16901,
                value: 51461,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9254,
                value: 7482,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 14496,
                to: 29419,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 63367,
                value: 64724,
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
                field: 16044,
                value: 5158,
            },
        },
        Step::Run(Millis(2048)),
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Server(ServerStep::ExistsProbe),
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 56828,
                value: 28409,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 52735,
                value: 19038,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(128)),
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Run(Millis(1)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 61038,
                value: 54884,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 51861,
                value: 19767,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 44535,
                value: 52119,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 58898,
                value: 61013,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(26036)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 36850,
                value: 26664,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 14571,
                value: 44092,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58964,
                value: 6825,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(4)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15545,
                value: 30665,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(28161)),
        },
        Step::Run(Millis(1024)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormMove {
                from: 53438,
                to: 31730,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Host {
            client: ClientName("client1".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Run(Millis(60000)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 47398,
                value: 43861,
            },
        },
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 36609,
                to: 1772,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56785,
                value: 59155,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(256)),
        Step::Run(Millis(2048)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 55135,
                value: 9952,
            },
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
