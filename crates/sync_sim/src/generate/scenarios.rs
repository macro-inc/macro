use super::*;

impl GeneratedScript {
    pub(super) fn scenario(&self, script: &mut Vec<Step>) {
        let a = ClientName("client0".into());
        let b = ClientName("client1".into());
        match self.scenario {
            1 => script.extend([
                Step::Net(NetStep::LoseAcks {
                    client: a.clone(),
                    count: 1,
                }),
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 11,
                    },
                },
                Step::Run(Millis(6_000)),
            ]),
            2 => script.extend([
                Step::Net(NetStep::DropNext {
                    client: b.clone(),
                    direction: Direction::ToClient,
                    kind: Some(FrameKind::RemoteUpdate),
                    frames: 1,
                }),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 21,
                    },
                },
                Step::Run(Millis(200)),
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormSet {
                        field: 1,
                        value: 22,
                    },
                },
                Step::Run(Millis(200)),
            ]),
            3 | 17 => script.extend([
                Step::Net(NetStep::Partition(a.clone())),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 31,
                    },
                },
                Step::Run(Millis(200)),
                Step::Crash { client: a },
            ]),
            4 | 18 => script.extend([
                Step::Net(NetStep::Partition(a.clone())),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 41,
                    },
                },
                Step::Run(Millis(50)),
                Step::Edit {
                    client: b,
                    op: AbstractOp::FormSet {
                        field: 1,
                        value: 42,
                    },
                },
                Step::Crash { client: a },
            ]),
            5 => script.extend([
                Step::Offline {
                    client: a.clone(),
                    offline: true,
                },
                Step::Net(NetStep::Break(a)),
                Step::Run(Millis(240_000)),
            ]),
            6 => script.extend([
                Step::Net(NetStep::CorruptNext {
                    client: b,
                    direction: Direction::ToClient,
                }),
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 61,
                    },
                },
                Step::Run(Millis(6_000)),
            ]),
            7 => script.extend([
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormText {
                        field: 0,
                        bytes: 1_200_000,
                        salt: 7,
                    },
                },
                Step::Run(Millis(200)),
                Step::Server(ServerStep::Hibernate),
            ]),
            8 => script.extend([
                Step::Net(NetStep::Partition(a.clone())),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 81,
                    },
                },
                Step::Run(Millis(200)),
                Step::Grant {
                    client: a,
                    access: Access::Read,
                    force_reconnect: false,
                },
            ]),
            9 | 10 => script.extend([
                Step::Net(NetStep::LoseAcks {
                    client: a.clone(),
                    count: 1,
                }),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 91,
                    },
                },
                Step::Run(Millis(1_000)),
                Step::Net(NetStep::Partition(a.clone())),
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 1,
                        value: 92,
                    },
                },
                Step::Run(Millis(100)),
                Step::Crash { client: a.clone() },
                Step::Edit {
                    client: b,
                    op: AbstractOp::FormSet {
                        field: 2,
                        value: 93,
                    },
                },
                Step::Run(Millis(100)),
                Step::Reopen { client: a },
            ]),
            11 => script.extend([
                Step::Storage {
                    profile: ProfileName("profile0".into()),
                    fault: StorageFault::Latency(Millis(100), Millis(100)),
                },
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 111,
                    },
                },
                Step::Run(Millis(30)),
                Step::Crash { client: a },
                Step::Run(Millis(150)),
            ]),
            12 => script.extend([
                Step::Server(ServerStep::D1Outage {
                    ms: Millis(300_000),
                }),
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 121,
                    },
                },
                Step::Run(Millis(500)),
            ]),
            13 | 19 => script.extend([
                Step::Edit {
                    client: a.clone(),
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 131,
                    },
                },
                Step::Run(Millis(5)),
                Step::Close { client: a },
            ]),
            14 => script.push(Step::Server(ServerStep::Hibernate)),
            15 => script.extend([
                Step::Grant {
                    client: a.clone(),
                    access: Access::Read,
                    force_reconnect: true,
                },
                Step::Run(Millis(2_000)),
                Step::Grant {
                    client: a,
                    access: Access::Edit,
                    force_reconnect: false,
                },
            ]),
            16 => script.extend([
                Step::Server(ServerStep::StorageErrors { n: 1 }),
                Step::Edit {
                    client: a,
                    op: AbstractOp::FormSet {
                        field: 0,
                        value: 161,
                    },
                },
                Step::Run(Millis(500)),
            ]),
            _ => {}
        }
    }
}
