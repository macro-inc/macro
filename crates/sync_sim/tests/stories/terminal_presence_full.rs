//! Retained full terminal-receiver literal with every action and query enabled.
use sync_sim::*;

#[test]
fn terminal_receiver_presence_seed17535402420735726510() {
    let mut config = SimConfig::calm(17535402420735726510);
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
        SeedDocument::Form(vec![(3, 35163), (6, 49268), (5, 20820)]),
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
    let script = [
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
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 0,
                value: 41,
            },
        },
        Step::Run(Millis(50)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 1,
                value: 42,
            },
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::ReopenCrashed,
        Step::Settle,
        Step::Run(Millis(512)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 54550,
                value: 49268,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 31101,
                value: 20820,
            },
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(128)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58164,
                value: 11868,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 21901,
                value: 3164,
            },
        },
        Step::Net(NetStep::Break(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(29114)),
        },
        Step::Crash {
            client: ClientName("client0".into()),
        },
        Step::ClockSkew {
            client: ClientName("client1".into()),
            wall_offset_ms: -2125,
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 14933,
                value: 29801,
            },
        },
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 32326,
                value: 27896,
            },
        },
        Step::Edit {
            client: ClientName("client1".into()),
            op: AbstractOp::FormSet {
                field: 39286,
                value: 53058,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 48824,
                value: 64237,
            },
        },
        Step::Crash {
            client: ClientName("client3".into()),
        },
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Edit,
            force_reconnect: true,
        },
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::Select(Some(41991)),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 7817,
                value: 63566,
            },
        },
        Step::Run(Millis(4)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 59372,
                value: 40823,
            },
        },
        Step::Grant {
            client: ClientName("client1".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::Crash {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 59436,
                value: 22036,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 19495,
                value: 37933,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 54917,
                to: 19981,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 56592,
                value: 45303,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8453,
                value: 50256,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 58167,
                to: 48871,
            },
        },
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 5746,
                value: 39571,
            },
        },
        Step::Run(Millis(128)),
        Step::Run(Millis(8)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 29485,
                to: 36524,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 26771,
                value: 34771,
            },
        },
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8676,
                value: 6910,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 52116,
                value: 9277,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 17463,
                value: 27957,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 3028,
                value: 34417,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 62600,
                value: 369,
            },
        },
        Step::Flush {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 1513,
                value: 23130,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Storage {
            profile: ProfileName("profile0".into()),
            fault: StorageFault::Latency(Millis(2), Millis(40)),
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 50808,
                value: 45930,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 32929,
                value: 41473,
            },
        },
        Step::Run(Millis(32768)),
        Step::Net(NetStep::Heal(ClientName("client1".into()))),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 5733,
                value: 7754,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 58048,
                value: 26866,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 62316,
                value: 36635,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 56656,
                value: 58828,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15729,
                value: 59128,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 51073,
                value: 38689,
            },
        },
        Step::Offline {
            client: ClientName("client1".into()),
            offline: true,
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 19812,
                to: 59464,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::Select(Some(15280)),
        },
        Step::Run(Millis(2)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 11126,
                value: 52137,
            },
        },
        Step::Server(ServerStep::D1Outage { ms: Millis(2000) }),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 49119,
                value: 58953,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 10647,
                to: 13635,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 23942,
                value: 33534,
            },
        },
        Step::Net(NetStep::Partition(ClientName("client0".into()))),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 55863,
                value: 40572,
            },
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 41294,
                value: 37611,
            },
        },
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 9723,
                value: 25390,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Net(NetStep::Break(ClientName("client2".into()))),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 58762,
                to: 29915,
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
                from: 14578,
                to: 2510,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(256)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 51428,
                value: 61345,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Freeze {
            client: ClientName("client1".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 9901,
                value: 3298,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 8144,
                value: 33381,
            },
        },
        Step::Run(Millis(16)),
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 55192,
                value: 30170,
            },
        },
        Step::Close {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(8)),
        Step::CrashProfile {
            profile: ProfileName("profile0".into()),
            mode: CrashMode::PowerLoss { window: Millis(45) },
        },
        Step::Flush {
            client: ClientName("client3".into()),
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Reopen {
            client: ClientName("client3".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 52175,
                value: 35344,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 20339,
                value: 12185,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Net(NetStep::Break(ClientName("client0".into()))),
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 40674,
                value: 33225,
            },
        },
        Step::Close {
            client: ClientName("client2".into()),
        },
        Step::Freeze {
            client: ClientName("client3".into()),
        },
        Step::Reopen {
            client: ClientName("client0".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormMove {
                from: 26033,
                to: 2136,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 8249,
                value: 2686,
            },
        },
        Step::Thaw {
            client: ClientName("client3".into()),
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 22506,
                value: 35137,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 18569,
                value: 48475,
            },
        },
        Step::Run(Millis(2048)),
        Step::Run(Millis(8192)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 27331,
                value: 56927,
            },
        },
        Step::Reopen {
            client: ClientName("client2".into()),
        },
        Step::Run(Millis(1000)),
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 18692,
                value: 19168,
            },
        },
        Step::Edit {
            client: ClientName("client2".into()),
            op: AbstractOp::FormSet {
                field: 52946,
                value: 54409,
            },
        },
        Step::Grant {
            client: ClientName("client2".into()),
            access: Access::Read,
            force_reconnect: true,
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 47187,
                value: 7367,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 20405,
                value: 7839,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 30990,
                value: 25954,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 14297,
                value: 55729,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 41328,
                value: 53831,
            },
        },
        Step::Host {
            client: ClientName("client1".into()),
            signal: doc_sync_core::HostSignal::Visible,
        },
        Step::Crash {
            client: ClientName("client2".into()),
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
            op: AbstractOp::FormMove {
                from: 49380,
                to: 37986,
            },
        },
        Step::Net(NetStep::LoseAcks {
            client: ClientName("client1".into()),
            count: 1,
        }),
        Step::Run(Millis(64)),
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 55683,
                value: 38907,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 18361,
                value: 43286,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 15343,
                value: 2659,
            },
        },
        Step::Edit {
            client: ClientName("client3".into()),
            op: AbstractOp::FormSet {
                field: 20020,
                value: 25821,
            },
        },
        Step::Edit {
            client: ClientName("client0".into()),
            op: AbstractOp::FormSet {
                field: 51197,
                value: 15514,
            },
        },
        Step::ReopenCrashed,
        Step::Settle,
    ];
    for activated in [false, true] {
        let mut config = config.clone();
        config.server_operation_archive_writes = activated;
        let outcome = Sim::new(config).run(&script);
        if let Err(failures) = invariants::check_all(&outcome) {
            panic!("activated={activated}: {failures:#?}");
        }
        outcome.check_replay().unwrap();
    }
}
