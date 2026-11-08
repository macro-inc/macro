use super::*;

impl GeneratedScript {
    /// Build a literal script with explicit lifecycle recovery. Generated account
    /// switches drain the old account first; undrained switches are isolation-only
    /// stories, outside this workload's convergence claim. Core failures remain visible.
    pub fn materialize(&self, seed: u64) -> (SimConfig, Vec<Step>) {
        let mut config = match self.shape {
            ScriptShape::Forms => SimConfig::calm(seed),
            ScriptShape::Routed => SimConfig::routed(seed),
        };
        config.storage.latency = (Millis(2), Millis(40));
        config.net.break_per_frame = 0.001;
        if matches!(self.scenario, 9 | 10) {
            config.seeds.insert(
                DocIx(0),
                SeedDocument::Cached {
                    server: vec![],
                    s3: None,
                    local: None,
                },
            );
        }
        if !matches!(self.scenario, 9 | 10) {
            config.seeds.insert(
                DocIx(0),
                SeedDocument::Form(
                    self.actions
                        .iter()
                        .take(3)
                        .map(|action| (action.field % config.fields, action.value))
                        .collect(),
                ),
            );
        }
        let mut script = Vec::new();
        let mut specs = Vec::new();
        for index in 0..self.clients {
            let mut spec = OpenSpec::form(
                &format!("client{index}"),
                &format!("profile{}", index % self.profiles),
            );
            spec.doc = DocIx(index % config.documents);
            if index > 0 {
                spec.access = if self.read == index {
                    Access::Read
                } else if self.comment == index {
                    Access::CommentOnly
                } else {
                    Access::Edit
                };
            }
            if self.ai && index == self.clients - 1 {
                spec.kind = ClientKind::AiWorker;
            }
            if index == 1 && matches!(self.scenario, 2 | 4 | 6 | 9 | 10 | 18) {
                spec.access = Access::Edit;
                spec.kind = ClientKind::Tab;
                spec.doc = DocIx(0);
                if matches!(self.scenario, 4 | 18) {
                    spec.profile = ProfileName("profile0".into());
                }
            }
            specs.push(spec.clone());
            script.push(Step::Open(spec));
        }
        script.push(Step::Run(Millis(1_000)));
        if self.scenario != 8 {
            self.scenario(&mut script);
            script.push(Step::ReopenCrashed);
            script.push(Step::Settle);
        }
        let mut host_access = specs.iter().map(|spec| spec.access).collect::<Vec<_>>();
        let mut alive = vec![true; usize::from(self.clients)];
        let mut frozen = vec![false; usize::from(self.clients)];
        let mut offline = vec![false; usize::from(self.clients)];
        for action in &self.actions {
            // Leave room for recovery/final parking while keeping T0 at200
            // literal steps, including lifecycle repairs and causal scenarios.
            if script.len() >= 184 {
                break;
            }
            let mut index = usize::from(action.client % self.clients);
            if action.kind < 50
                && (specs[index].access != Access::Edit
                    || (alive[index] && host_access[index] != Access::Edit))
            {
                index = 0;
            }
            let client = specs[index].client.clone();
            match action.kind {
                0..50 => {
                    if !alive[index] {
                        script.push(Step::Reopen {
                            client: client.clone(),
                        });
                        script.push(Step::Run(Millis(1_000)));
                        alive[index] = true;
                        host_access[index] = specs[index].access;
                    }
                    if frozen[index] {
                        script.push(Step::Thaw {
                            client: client.clone(),
                        });
                        frozen[index] = false;
                    }
                    let op = match action.kind % 10 {
                        0 => AbstractOp::FormMove {
                            from: action.field,
                            to: action.value,
                        },
                        1 => AbstractOp::Select(Some(action.field)),
                        _ => AbstractOp::FormSet {
                            field: action.field,
                            value: action.value,
                        },
                    };
                    script.push(Step::Edit {
                        client: client.clone(),
                        op,
                    });
                    if action.value % 5 == 0 && specs[index].kind == ClientKind::Tab {
                        script.push(Step::Close { client });
                        alive[index] = false;
                    }
                }
                50..65 => {
                    // Log-uniform powers retain both coalesce and heartbeat windows.
                    let exponent = u32::from(action.duration % 17);
                    script.push(Step::Run(Millis((1u64 << exponent).min(60_000))));
                }
                65..75 => script.push(Step::Net(match action.value % 4 {
                    0 => NetStep::Partition(client),
                    1 => NetStep::Heal(client),
                    2 => NetStep::Break(client),
                    _ => NetStep::LoseAcks { client, count: 1 },
                })),
                75..81 => {
                    if action.value % 8 == 0 {
                        let profile = specs[index].profile.clone();
                        // Convergence switches require a genuinely drainable old
                        // account. Revoked/read-only old-user rows remain in the
                        // separate isolation stories, never new-user dependencies.
                        let switch_user = action.field % 16 == 0
                            && specs
                                .iter()
                                .enumerate()
                                .filter(|(_, spec)| spec.profile == profile)
                                .all(|(position, spec)| {
                                    spec.access == Access::Edit
                                        && (!alive[position]
                                            || host_access[position] == Access::Edit)
                                });
                        if switch_user {
                            // Explicit workload scope: settle under the old user's
                            // real credentials before switching. Never authorize
                            // old rows as the new user or weaken loss queries.
                            script.push(Step::ReopenCrashed);
                            // First finish any immutable already-issued token or
                            // dial under its original claims, then refresh it.
                            script.push(Step::Settle);
                            // Refresh a possibly stale View token using the same
                            // existing Edit grant, through explicit real closes.
                            for spec in specs.iter().filter(|spec| spec.profile == profile) {
                                script.push(Step::Net(NetStep::Break(spec.client.clone())));
                            }
                            script.push(Step::Settle);
                            script.push(Step::AssertProfileDrained {
                                profile: profile.clone(),
                            });
                            for (position, spec) in specs.iter().enumerate() {
                                if !alive[position] {
                                    host_access[position] = spec.access;
                                }
                                alive[position] = true;
                                frozen[position] = false;
                                offline[position] = false;
                            }
                        }
                        script.push(Step::CrashProfile {
                            profile: profile.clone(),
                            mode: if action.value % 16 == 0 {
                                CrashMode::ProcessDeath
                            } else {
                                CrashMode::PowerLoss {
                                    window: Millis(u64::from(action.duration % 101)),
                                }
                            },
                        });
                        for (position, spec) in specs.iter().enumerate() {
                            if spec.profile == profile {
                                alive[position] = false;
                                frozen[position] = false;
                            }
                        }
                        if switch_user {
                            script.push(Step::SignIn {
                                profile,
                                user: format!("user{}", (action.field / 16) % 2),
                            });
                        }
                    } else if alive[index] {
                        script.push(Step::Crash { client });
                        alive[index] = false;
                    } else {
                        script.push(Step::Reopen { client });
                        script.push(Step::Run(Millis(1_000)));
                        alive[index] = true;
                        host_access[index] = specs[index].access;
                    }
                }
                81..85 => match action.value % 3 {
                    0 => script.push(Step::Host {
                        client,
                        signal: doc_sync_core::HostSignal::Visible,
                    }),
                    1 => {
                        frozen[index] = !frozen[index];
                        script.push(if frozen[index] {
                            Step::Freeze { client }
                        } else {
                            Step::Thaw { client }
                        });
                    }
                    _ => {
                        offline[index] = !offline[index];
                        script.push(Step::Offline {
                            client,
                            offline: offline[index],
                        });
                    }
                },
                85..89 => script.push(Step::Server(match action.value % 5 {
                    0 => ServerStep::Hibernate,
                    1 => ServerStep::Restart,
                    2 => ServerStep::D1Outage { ms: Millis(2_000) },
                    3 => ServerStep::StorageErrors { n: 1 },
                    _ => ServerStep::ExistsProbe,
                })),
                89..92 => script.push(Step::Storage {
                    profile: specs[index].profile.clone(),
                    fault: match action.value % 3 {
                        0 => StorageFault::Uncertain { next: 1 },
                        1 => StorageFault::FailLoad,
                        _ => StorageFault::Latency(Millis(2), Millis(40)),
                    },
                }),
                92..95 => match action.value % 3 {
                    0 => script.push(Step::TokenExpire { client }),
                    1 => script.push(Step::TokenFetchFail { client, n: 1 }),
                    _ => {
                        // Keep one writable producer; the other sessions exercise
                        // real downgrade/regrant metadata and parked histories.
                        let target = index.max(1);
                        let access = if action.value % 2 == 0 {
                            Access::Read
                        } else {
                            Access::Edit
                        };
                        specs[target].access = access;
                        script.push(Step::Grant {
                            client: specs[target].client.clone(),
                            access,
                            force_reconnect: action.field % 2 == 0,
                        });
                    }
                },
                95 => script.push(Step::ClockSkew {
                    client,
                    wall_offset_ms: i64::from(action.value % 5_001) - 2_500,
                }),
                96 => script.push(Step::Flush { client }),
                97 | 99 => {
                    if alive[index] && specs[index].kind == ClientKind::Tab {
                        if frozen[index] {
                            script.push(Step::Thaw {
                                client: client.clone(),
                            });
                            frozen[index] = false;
                        }
                        script.push(if action.kind == 97 {
                            Step::Close { client }
                        } else {
                            Step::EditorError { client }
                        });
                        alive[index] = false;
                    }
                }
                _ => script.push(Step::AdvanceWall(Millis(u64::from(action.duration)))),
            }
        }
        script.push(Step::ReopenCrashed);
        script.push(Step::Settle);
        if self.scenario == 8 {
            self.scenario(&mut script);
            script.push(Step::Settle);
        }
        (config, script)
    }
}
