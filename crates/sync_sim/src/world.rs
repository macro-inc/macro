//! Virtual event executor. Core policy stays in the real client and server crates.
use crate::{
    clock::Pending,
    document::spans,
    network::{LinkKey, Packet},
    server::{Callback, Input},
    storage::PendingWrite,
    *,
};
use doc_sync_core::{ConnId, IoEffect, SessionId, SocketEvent, SyncInput, SyncOutput};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::collections::{BTreeMap, BTreeSet};
use sync_server_sim::transcript::ServerInput;

mod inputs;
mod outputs;
mod router;
mod steps;
mod validation;

/// A whole single-threaded world driven only by seed and literal script.
pub struct Sim {
    config: SimConfig,
    clock: SimClock,
    rng: ChaCha8Rng,
    net: SimNetwork,
    servers: BTreeMap<DocIx, SimServer>,
    profiles: BTreeMap<ProfileName, SimStorage>,
    clients: BTreeMap<ClientName, SimClient>,
    routers: BTreeMap<ProfileName, router::Host>,
    events: Vec<Event>,
    server_ports: Vec<ServerPort>,
    failures: Vec<Failure>,
    stats: RunStats,
    peers: BTreeSet<u64>,
    presence: Option<BTreeMap<ClientName, BTreeMap<String, serde_json::Value>>>,
    scheduled_generation: BTreeMap<DocIx, u64>,
    ack_callbacks: BTreeMap<(DocIx, String), std::collections::VecDeque<u64>>,
    prefixes: BTreeMap<(ProfileName, String, doc_sync_core::WalOwner), doc_sync_core::WalSeq>,
    budget_hit: bool,
    tokens: BTreeMap<String, model::TokenGrant>,
    chatter_tails: BTreeMap<(SessionId, SessionId), u64>,
}
impl Sim {
    /// Construct deterministic adapters; initialization failures are retained in the Outcome.
    pub fn new(config: SimConfig) -> Self {
        let mut sim = Self {
            clock: SimClock::new(config.ties),
            rng: ChaCha8Rng::seed_from_u64(config.seed),
            net: SimNetwork::new(config.net.clone()),
            config,
            servers: BTreeMap::new(),
            profiles: BTreeMap::new(),
            clients: BTreeMap::new(),
            routers: BTreeMap::new(),
            events: Vec::new(),
            server_ports: Vec::new(),
            failures: Vec::new(),
            stats: RunStats::default(),
            peers: BTreeSet::new(),
            presence: None,
            scheduled_generation: BTreeMap::new(),
            ack_callbacks: BTreeMap::new(),
            prefixes: BTreeMap::new(),
            budget_hit: false,
            tokens: BTreeMap::new(),
            chatter_tails: BTreeMap::new(),
        };
        if sim.config.routed && sim.config.documents < 2 {
            sim.fail(Failure::new(
                "router_configuration",
                "routed worlds require at least two documents",
            ));
        }
        for index in 0..sim.config.documents.max(1) {
            let doc = DocIx(index);
            let now = SimServer::now(sim.clock.wall(0), 0);
            match SimServer::new(
                doc,
                sim.config.fields,
                sim.config.surfaces.contains(&doc),
                sim.config.seeds.get(&doc).unwrap_or(&SeedDocument::Empty),
                sim.config.server_storage_latency,
                now,
            ) {
                Ok((server, effects, seed_vv)) => {
                    sim.peers.extend(seed_vv.keys());
                    sim.emit(Fact::ServerSeed { doc, vv: seed_vv });
                    sim.scheduled_generation
                        .insert(doc, server.ports.write_generation());
                    sim.server_ports
                        .extend(effects.into_iter().map(|effect| ServerPort {
                            doc,
                            callback: 0,
                            effect,
                        }));
                    sim.servers.insert(doc, server);
                }
                Err(error) => sim.fail(error),
            }
        }
        sim
    }
    /// Run every transition and retain failures instead of panicking; then observe quiet time.
    pub fn run(mut self, script: &[Step]) -> Outcome {
        for step in script {
            if let Err(error) = self.step(step.clone()) {
                self.fail(error)
            }
            if self.config.per_step {
                self.validate();
            }
        }
        let finals = self.finals();
        let quiet_start = self.events.len();
        self.advance(self.config.budgets.quiet.0);
        let finals_after_quiet = self.finals();
        let quiet_events = self.events.get(quiet_start..).unwrap_or_default().to_vec();
        let canonical_events = serde_json::to_value(&self.events)
            .map(validation::canonical)
            .unwrap_or_else(|error| {
                self.fail(Failure::new("canonical_log", error));
                serde_json::Value::Null
            });
        let event_bytes = postcard::to_allocvec(&canonical_events).unwrap_or_else(|error| {
            self.fail(Failure::new("canonical_log", error));
            Vec::new()
        });
        let trace_hash = self.trace(&event_bytes, &finals, &finals_after_quiet);
        Outcome {
            config: self.config.clone(),
            seed: self.config.seed,
            script: script.to_vec(),
            events: self.events,
            server_ports: self.server_ports,
            finals,
            quiet_events,
            finals_after_quiet,
            event_bytes,
            trace_hash,
            stats: self.stats,
            per_step_failures: self.failures,
            pending_adapters: vec![
                "document_session / lexical_model / lexical_loro editor projection and undo".into(),
                "macro_document_model comment-only gate and lexical-service parity".into(),
            ],
        }
    }
    fn emit(&mut self, fact: Fact) {
        self.events.push(Event {
            at: self.clock.now(),
            fact,
        });
    }
    fn fail(&mut self, mut failure: Failure) {
        if failure.at.is_none() {
            failure.at = Some(self.clock.now())
        }
        self.failures.push(failure);
    }
    fn schedule(&mut self, at: u64, event: Pending) {
        self.clock.schedule(at, event, &mut self.rng);
    }
    fn uuid(&mut self) -> uuid_value::Uuid {
        let random: u128 = self.rng.random();
        // UUIDv7 version/variant bits, without an ambient clock or UUID generator.
        let wall = u128::try_from(self.clock.wall(0)).unwrap_or(0) & ((1u128 << 48) - 1);
        let value = (wall << 80)
            | (random & ((1u128 << 76) - 1) & !(3u128 << 62))
            | (7u128 << 76)
            | (2u128 << 62);
        uuid_value::Uuid::from_u128(value)
    }
    fn peer(&mut self, kind: ClientKind) -> u64 {
        loop {
            let raw: u64 = self.rng.random();
            let peer = if kind == ClientKind::AiWorker {
                doc_sync_core::AI_PEER_BASE + raw % doc_sync_core::AI_PEER_COUNT
            } else {
                raw
            };
            let valid = if kind == ClientKind::AiWorker {
                true
            } else {
                peer != u64::MAX && !sync_server_core::domain::ai_peer::is_ai_peer(peer)
            };
            if valid && self.peers.insert(peer) {
                return peer;
            }
        }
    }
    fn advance_next(&mut self, limit: u64) {
        let at = self
            .clock
            .next_at()
            .unwrap_or(limit)
            .min(limit)
            .max(self.clock.now);
        self.advance(at.saturating_sub(self.clock.now));
    }
    fn advance(&mut self, duration: u64) {
        let through = self.clock.now.saturating_add(duration);
        while let Some(event) = self.clock.pop(through) {
            if self.stats.events >= self.config.budgets.max_events {
                if !self.budget_hit {
                    self.budget_hit = true;
                    self.fail(Failure::new("event_budget", "maximum event count reached"));
                }
                break;
            }
            self.stats.events = self.stats.events.saturating_add(1);
            if let Err(error) = self.pending(event) {
                self.fail(error)
            }
            if self.config.per_step && self.stats.events.is_multiple_of(1_000) {
                self.validate()
            }
        }
        self.clock.now = through;
    }
    fn input(
        &mut self,
        name: &ClientName,
        session: SessionId,
        input: SyncInput,
    ) -> Result<(), Failure> {
        let Some(client) = self.clients.get_mut(name) else {
            return Ok(());
        };
        if !client.alive || client.session != session {
            return Ok(());
        }
        if client.frozen {
            client.deferred.push_back(input);
            return Ok(());
        }
        if client.core.needs_peer_ids() {
            let kind = client.spec.kind;
            let ids = (0..16).map(|_| self.peer(kind)).collect::<Vec<_>>();
            if let Some(client) = self.clients.get_mut(name) {
                client
                    .core
                    .add_peer_ids(ids)
                    .map_err(|error| Failure::new("peer_supply", error))?;
            }
        }
        let Some(client) = self.clients.get_mut(name) else {
            return Ok(());
        };
        let now = doc_sync_core::Now {
            mono: doc_sync_core::Millis(self.clock.now),
            wall: doc_sync_core::UnixMillis(self.clock.wall(client.skew)),
        };
        let (out, facts) = client.handle(input, now);
        let generation = client.generation;
        self.stats.handles = self.stats.handles.saturating_add(1);
        for fact in facts {
            self.emit(fact);
        }
        if let Some(at) = out.wake_at {
            self.schedule(at.0, Pending::Wake(name.clone(), session, generation));
        }
        self.outputs(name, session, out)
    }
}

#[cfg(test)]
mod test;
