use sync_sim::*;

// SIM_SEED=40
#[test]
fn short_healed_partition_recovers_the_last_independent_update() {
    let mut config = SimConfig::calm(40);
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
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 29518,
                value: 57269,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 12546,
                value: 2380,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::ClockSkew {
            client: ClientName("client2".into()),
            wall_offset_ms: 2333,
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 49782,
                value: 35261,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Partition(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 43625,
                value: 23975,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Host {
            client: ClientName("client1".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Run(Millis(60000)),
        Step::Run(Millis(1024)),
        Step::TokenFetchFail {
            client: ClientName("client1".into()),
            n: 1,
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 52492,
                value: 28854,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client0".into()),
            count: 1,
        }),
        Step::Host {
            client: ClientName("client0".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Server(ServerStep::StorageErrors { n: 1 }),
        Step::TokenFetchFail {
            client: ClientName("client0".into()),
            n: 1,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 32538,
                to: 15501,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 43130,
                to: 20445,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 21210,
                value: 42272,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 8650,
                value: 19712,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 36433,
                value: 4091,
            },
        },
        Step::Run(Millis(8192)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 4674,
                value: 63818,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(35854)),
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 19331,
                value: 56593,
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
                field: 17748,
                value: 23035,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 41783,
                value: 52104,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 41879,
                to: 39765,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(2048)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 29770,
                value: 2850,
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
            op: AbstractOp::FormMove {
                from: 21034,
                to: 53005,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 8121,
                value: 36684,
            },
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8847,
                value: 3874,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 29945,
                value: 51978,
            },
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 29700,
                value: 64160,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(4096)),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Storage {
            profile: ProfileName("profile1".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 39870,
                to: 65386,
            },
        },
        Step::Run(Millis(4)),
        Step::Run(Millis(32768)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 45424,
                value: 18123,
            },
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 37893,
                value: 37332,
            },
        },
        Step::Run(Millis(512)),
        Step::Net(NetStep::Heal(ClientName("client2".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 6270,
                value: 20098,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 27309,
                value: 21495,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(512)),
        Step::Offline {
            client: ClientName("client3".into()),
            offline: true,
        },
        Step::Server(ServerStep::Hibernate),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 37278,
                value: 2956,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 22254,
                value: 35975,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(48425)),
        },
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::AdvanceWall(Millis(3956)),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 21607,
                value: 25429,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 43379,
                to: 30749,
            },
        },
        Step::Run(Millis(16384)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 62477,
                value: 51790,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 31633,
                value: 54341,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 36746,
                value: 33362,
            },
        },
        Step::Grant {
            client: ClientName("client3".into()),
            access: Access::Edit,
            force_reconnect: false,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 49875,
                value: 55458,
            },
        },
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 23180,
                value: 34871,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 35475,
                value: 47833,
            },
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 5690,
                value: 63609,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 21854,
                value: 34629,
            },
        },
        Step::Run(Millis(2048)),
        Step::Run(Millis(4096)),
        Step::Run(Millis(60000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 46495,
                value: 21395,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Storage {
            profile: ProfileName("profile1".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 16461,
                value: 6793,
            },
        },
        Step::Server(ServerStep::ExistsProbe),
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client3".into()),
            count: 1,
        }),
        Step::AdvanceWall(Millis(13782)),
        Step::Server(ServerStep::Restart),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 12108,
                value: 51945,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 39602,
                value: 14354,
            },
        },
        Step::Run(Millis(512)),
        Step::Run(Millis(4096)),
        Step::TokenExpire {
            client: ClientName("client0".into()),
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 34652,
                value: 59373,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 23439,
                value: 12301,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 49925,
                value: 15048,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 9412,
                value: 56060,
            },
        },
        Step::Close {
            client: ClientName("client3".into()),
        },
        Step::Offline {
            client: ClientName("client1".into()),
            offline: true,
        },
        Step::Offline {
            client: ClientName("client2".into()),
            offline: true,
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::TokenExpire {
            client: ClientName("client0".into()),
        },
        Step::Flush {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45382,
                value: 10275,
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
            op: AbstractOp::FormMove {
                from: 52931,
                to: 43077,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(63292)),
        },
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 24814,
                value: 41956,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 60526,
                value: 14658,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 60264,
                value: 9995,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client0".into()))),
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
