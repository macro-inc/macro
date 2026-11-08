use super::{peer_protocol::*, ts_child::TsChild};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use sync_sim::*;

pub struct Mixed {
    pub sim: Sim,
    editors: BTreeSet<ClientName>,
    children: BTreeMap<ProfileName, TsChild>,
    profiles: BTreeMap<ClientName, ProfileName>,
    active: BTreeMap<ClientName, bool>,
    pub finals: BTreeMap<ClientName, PeerFinal>,
    pub wire: Vec<String>,
    pending: VecDeque<(ProfileName, PeerCommand)>,
}
impl Mixed {
    pub fn new(seed: u64) -> Self {
        Self::with_config(SimConfig::calm(seed))
    }
    pub fn with_config(config: SimConfig) -> Self {
        Self {
            sim: Sim::new(config),
            editors: BTreeSet::new(),
            children: BTreeMap::new(),
            profiles: BTreeMap::new(),
            active: BTreeMap::new(),
            finals: BTreeMap::new(),
            wire: vec![],
            pending: VecDeque::new(),
        }
    }
    pub fn open(&mut self, name: &str, profile: &str) {
        self.open_surface(name, profile, false);
    }
    pub fn open_editor(&mut self, name: &str, profile: &str) {
        self.open_surface(name, profile, true);
    }
    fn open_surface(&mut self, name: &str, profile: &str, editor: bool) {
        let mut spec = OpenSpec::form(name, profile);
        if editor {
            self.editors.insert(spec.client.clone());
            spec.kind = ClientKind::AiWorker;
        }
        let identity = self.sim.register_external(spec.clone()).unwrap();
        let seed = u32::try_from(self.children.len() + 197).unwrap();
        self.children
            .entry(spec.profile.clone())
            .or_insert_with(|| TsChild::spawn(seed));
        self.profiles
            .insert(spec.client.clone(), spec.profile.clone());
        self.active.insert(spec.client.clone(), true);
        self.pending.push_back((
            spec.profile.clone(),
            PeerCommand::Tick {
                now: u32::try_from(self.sim.now().0).unwrap(),
            },
        ));
        self.pending.push_back((
            spec.profile,
            if editor {
                PeerCommand::OpenEditor {
                    client: name.into(),
                    peer: identity.peer.to_string(),
                    document: "00000000-0000-7000-8000-000000000001".into(),
                }
            } else {
                PeerCommand::Open {
                    client: name.into(),
                    peer: identity.peer.to_string(),
                    document: "00000000-0000-7000-8000-000000000001".into(),
                    ai: false,
                    readonly: false,
                }
            },
        ));
        self.drain();
        self.sim.connect_external(&spec.client).unwrap();
    }
    pub fn install_rows(&mut self, profile: &str, rows: Vec<PeerWalRow>) {
        let profile = ProfileName(profile.into());
        let seed = u32::try_from(self.children.len() + 197).unwrap();
        self.children
            .entry(profile.clone())
            .or_insert_with(|| TsChild::spawn(seed));
        self.pending.push_back((
            profile,
            PeerCommand::InstallRows {
                document: "00000000-0000-7000-8000-000000000001".into(),
                rows,
            },
        ));
        self.drain();
    }
    pub fn command(&mut self, name: &str, command: PeerCommand) {
        self.pending
            .push_back((self.profiles[&ClientName(name.into())].clone(), command));
        self.drain();
    }
    pub fn pump(&mut self, duration: u64) {
        let through = self.sim.now().0 + duration;
        while self.sim.now().0 < through {
            self.sim
                .apply_step(Step::Run(Millis((through - self.sim.now().0).min(10))))
                .unwrap();
            let now = u32::try_from(self.sim.now().0).unwrap();
            for profile in self.children.keys() {
                self.pending
                    .push_back((profile.clone(), PeerCommand::Tick { now }));
            }
            for (name, profile) in &self.profiles {
                for event in self.sim.external_events(name) {
                    if !self.active[name] {
                        continue;
                    }
                    let command = match event {
                        ExternalEvent::Frame(bytes) => PeerCommand::Frame {
                            client: name.0.clone(),
                            bytes,
                        },
                        ExternalEvent::Text(text) => PeerCommand::Text {
                            client: name.0.clone(),
                            text,
                        },
                        ExternalEvent::Chatter { awareness, bytes } => PeerCommand::Chatter {
                            client: name.0.clone(),
                            awareness,
                            bytes,
                        },
                        ExternalEvent::Closed(code) => panic!(
                            "T0 direct TS peer received server close {code}; reconnect fault interop requires the lifecycle driver"
                        ),
                    };
                    self.pending.push_back((profile.clone(), command));
                }
            }
            self.drain();
        }
    }
    fn drain(&mut self) {
        while let Some((profile, command)) = self.pending.pop_front() {
            let report = self.children.get_mut(&profile).unwrap().command(&command);
            self.wire.push(serde_json::to_string(&command).unwrap());
            self.wire.push(serde_json::to_string(&report).unwrap());
            for peer in report.peers {
                let name = ClientName(peer.client.clone());
                let vv = peer
                    .vv
                    .iter()
                    .map(|(id, counter)| (id.parse().unwrap(), *counter))
                    .collect();
                if self.editors.contains(&name) {
                    let spans = report
                        .effects
                        .iter()
                        .filter_map(|effect| match effect {
                            PeerEffect::Commit {
                                client,
                                peer,
                                start,
                                end,
                            } if client == &name.0 => Some(IdSpan {
                                peer: peer.parse().unwrap(),
                                start: *start,
                                end: *end,
                            }),
                            _ => None,
                        })
                        .collect();
                    self.sim.external_authored(&name, vv, spans).unwrap();
                } else {
                    self.sim.external_versions(&name, vv).unwrap();
                }
                self.finals.insert(name, peer);
            }
            for effect in report.effects {
                match effect {
                    PeerEffect::Commit { .. } => {}
                    PeerEffect::Frame { client, bytes } => {
                        self.sim.external_frame(&ClientName(client), bytes).unwrap()
                    }
                    PeerEffect::Text { client, text } => {
                        self.sim.external_text(&ClientName(client), text).unwrap()
                    }
                    PeerEffect::Closed { client } => {
                        self.active.insert(ClientName(client.clone()), false);
                        self.sim.close_external(&ClientName(client)).unwrap();
                    }
                    PeerEffect::Chatter {
                        client,
                        awareness,
                        bytes,
                    } => {
                        let name = ClientName(client.clone());
                        self.sim
                            .external_chatter(&name, awareness, bytes.clone())
                            .unwrap();
                        for (other, target) in &self.profiles {
                            if other != &name && *target == profile && self.active[other] {
                                self.pending.push_back((
                                    profile.clone(),
                                    PeerCommand::Chatter {
                                        client: other.0.clone(),
                                        awareness,
                                        bytes: bytes.clone(),
                                    },
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    pub fn finish(mut self) -> (Outcome, BTreeMap<ClientName, PeerFinal>, Vec<String>) {
        for profile in self.children.keys() {
            self.pending
                .push_back((profile.clone(), PeerCommand::Shutdown));
        }
        self.drain();
        let outcome = self.sim.run(&[Step::Settle]);
        if let Err(failures) = invariants::check_all(&outcome) {
            panic!("{failures:#?}\nwire={:#?}", self.wire);
        }
        (outcome, self.finals, self.wire)
    }
}
