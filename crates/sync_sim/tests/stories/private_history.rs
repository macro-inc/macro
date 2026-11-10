//! Retained seed357 literal with every policy, action and invariant preserved.
use sync_sim::*;

#[test]
fn read_only_private_history_seed357() {
    let mut config = SimConfig::calm(357);
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
            profile: ProfileName("profile0".into()),
            doc: DocIx(0),
            access: Access::Edit,
            kind: ClientKind::Tab,
        }),
        Step::Open(OpenSpec {
            client: ClientName("client3".into()),
            profile: ProfileName("profile1".into()),
            doc: DocIx(0),
            access: Access::Read,
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
        Step::Run(Millis(60000)),
        Step::Freeze {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 31058,
                value: 13315,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Grant {
            client: ClientName("client2".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::Server(ServerStep::Restart),
        Step::Net(NetStep::Break(ClientName("client3".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 59776,
                value: 60712,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 60550,
                value: 19887,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(64588)),
        },
        Step::Storage {
            profile: ProfileName("profile1".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::TokenFetchFail {
            client: ClientName("client2".into()),
            n: 1,
        },
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 24989,
                value: 11639,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 18368,
                value: 2006,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 4285,
                to: 5555,
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
                field: 20718,
                value: 53482,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client2".into()),
            count: 1,
        }),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(54415)),
        },
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 22117,
                value: 22551,
            },
        },
        Step::Run(Millis(1)),
        Step::Run(Millis(8)),
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 800,
                value: 32290,
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
                field: 39942,
                value: 30158,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(23486)),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormMove {
                from: 50363,
                to: 9231,
            },
        },
        Step::Run(Millis(2)),
        Step::Run(Millis(60000)),
        Step::Run(Millis(60000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(48955)),
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 42836,
                value: 3383,
            },
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 49498,
                value: 59919,
            },
        },
        Step::Run(Millis(32)),
        Step::Server(ServerStep::Hibernate),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58785,
                value: 43093,
            },
        },
        Step::Crash {
            client: ClientName("client1".into()),
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
                field: 3019,
                value: 26297,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 399,
                value: 46092,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 41224,
                value: 47778,
            },
        },
        Step::Run(Millis(32768)),
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 45736,
                value: 77,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 53957,
                value: 1287,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 11593,
                value: 31272,
            },
        },
        Step::Run(Millis(16384)),
        Step::Run(Millis(4096)),
        Step::CrashProfile {
            profile: ProfileName("profile1".into()),
            mode: CrashMode::ProcessDeath,
        },
        Step::Freeze {
            client: ClientName("client1".into()),
        },
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
                field: 47907,
                value: 51995,
            },
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 45170,
                value: 25530,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Server(ServerStep::Restart),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 1923,
                value: 17488,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(12560)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 49847,
                value: 53675,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Flush {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Offline {
            client: ClientName("client1".into()),
            offline: true,
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 62014,
                value: 56276,
            },
        },
        Step::AdvanceWall(Millis(51114)),
        Step::TokenFetchFail {
            client: ClientName("client1".into()),
            n: 1,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(19761)),
        },
        Step::Close {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 3635,
                value: 45238,
            },
        },
        Step::Run(Millis(60000)),
        Step::Offline {
            client: ClientName("client3".into()),
            offline: true,
        },
        Step::Net(NetStep::Heal(ClientName("client3".into()))),
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Uncertain { next: 1 },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 30111,
                value: 22655,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(2)),
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 20506,
                value: 26907,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 21812,
                value: 14584,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::Select(Some(33236)),
        },
        Step::Run(Millis(2048)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(31766)),
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 61948,
                value: 31998,
            },
        },
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: 2334,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 62104,
                value: 6896,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 33618,
                value: 13493,
            },
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::FailLoad,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(40592)),
        },
        Step::Offline {
            client: ClientName("client1".into()),
            offline: false,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(55488)),
        },
        Step::Net(NetStep::Partition(ClientName("client2".into()))),
        Step::Server(ServerStep::ExistsProbe),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 410,
                value: 21359,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 44133,
                value: 54581,
            },
        },
        Step::Host {
            client: ClientName("client3".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::AdvanceWall(Millis(7917)),
        Step::EditorError {
            client: ClientName("client1".into()),
        },
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 33759,
                value: 13470,
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
                field: 13842,
                value: 47269,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7906,
                value: 51243,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9141,
                value: 46839,
            },
        },
        Step::Run(Millis(2)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 37329,
                value: 40238,
            },
        },
        Step::Reopen {
            client: ClientName("client1".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::Select(Some(63482)),
        },
        Step::Run(Millis(8192)),
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 20234,
                value: 63655,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
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
                field: 11452,
                value: 44889,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::ClockSkew {
            client: ClientName("client2".into()),
            wall_offset_ms: -732,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 49909,
                value: 14393,
            },
        },
        Step::Run(Millis(128)),
        Step::Run(Millis(256)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 61751,
                to: 57026,
            },
        },
        Step::Run(Millis(60000)),
        Step::Run(Millis(16)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 47152,
                value: 14119,
            },
        },
        Step::Run(Millis(16384)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 31495,
                value: 24706,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 29741,
                value: 43983,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 34246,
                to: 50700,
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
                from: 34439,
                to: 62793,
            },
        },
        Step::Run(Millis(32)),
        Step::ReopenCrashed,
        Step::Settle,
    ]);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!("{failures:#?}");
    }
    outcome.check_replay().unwrap();
}
