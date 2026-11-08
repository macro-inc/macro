use super::*;
use doc_sync_core::HostSignal;

impl Sim {
    pub(super) fn settle(&mut self) -> Result<(), Failure> {
        let deadline = self.clock.now.saturating_add(self.config.budgets.settle.0);
        self.presence = None;
        let token_failures_until = self.clock.pending_token_failures_until();
        let mut healed = self.net.partitions.clone();
        for name in self.clients.keys() {
            if self.net.partitions.contains(&self.network_name(name)) {
                healed.insert(name.clone());
            }
        }
        self.net.heal();
        for client in self.clients.values_mut() {
            client.token_failures = 0;
            client.expire_token = false;
        }
        for client in healed {
            self.emit(Fact::Partition {
                client,
                partitioned: false,
            });
        }
        for store in self.profiles.values_mut() {
            store.fault(StorageFault::Heal);
        }
        self.server_step(ServerStep::Heal)?;
        // A reversible injected source freeze heals through its durable proof;
        // permanent surface revocation remains a lifecycle fact.
        for doc in self.servers.keys().copied().collect::<Vec<_>>() {
            if !self.config.surfaces.contains(&doc) {
                self.server_input(doc, Input::ThawSource)?;
            }
        }
        // A healed blackhole may have lost the last update while heartbeat
        // still considered the socket connected. Reconnect only exact surviving
        // generations with observed partition/offline loss, through real closes.
        for key in std::mem::take(&mut self.net.partition_losses) {
            if self.net.links.get(&key).is_some_and(|link| link.open) {
                self.break_link(&key, 1006)?;
            }
        }
        if let Some(at) = token_failures_until {
            self.advance(at.min(deadline).saturating_sub(self.clock.now));
        }
        let profiles = self.routers.keys().cloned().collect::<Vec<_>>();
        for profile in profiles {
            self.router_input(
                &profile,
                doc_sync_core::RouterInput::Host(HostSignal::Online),
            )?;
        }
        // Settlement provides a recovery session for durable rows left by Stop.
        // Stop itself still closes without waiting for a server acknowledgement.
        let closed = self
            .clients
            .values()
            .filter(|client| !client.alive && client.stopped)
            .map(|client| client.spec.clone())
            .collect::<Vec<_>>();
        for spec in closed {
            self.open(spec)?;
        }
        let live = self
            .clients
            .iter()
            .filter(|(_, client)| client.alive)
            .map(|(name, client)| (name.clone(), client.session, client.selection))
            .collect::<Vec<_>>();
        for (name, session, _) in &live {
            self.thaw(name)?;
            self.input(name, *session, SyncInput::Host(HostSignal::Online))?;
            self.input(name, *session, SyncInput::Host(HostSignal::Visible))?;
        }
        let heartbeat = self.config.session.heartbeat.interval.0.max(1);
        let mut presence_barriers = [Direction::ToServer, Direction::ToClient].into_iter();
        let mut presence_lifetimes = None;
        let mut published_at_idle = false;
        let mut held_since = None;
        let mut settled_clients = BTreeSet::new();
        while self.clock.now <= deadline && !self.budget_hit {
            let lifetimes = (
                self.clients
                    .iter()
                    .filter(|(_, client)| client.alive)
                    .map(|(name, client)| {
                        (
                            name.clone(),
                            client.session,
                            client.connection_id(),
                            client.core.peer_id(),
                            client.presence_key.clone(),
                        )
                    })
                    .collect::<Vec<_>>(),
                self.presence_route_epochs(),
            );
            if presence_lifetimes.as_ref() != Some(&lifetimes)
                || (self.presence.is_none() && self.clock.now < self.presence_expiry_ready_at())
            {
                // A changed source invalidates an earlier candidate snapshot;
                // heartbeat restarts alone keep the first view of this lifetime.
                self.presence = None;
                held_since = None;
                published_at_idle = false;
                presence_lifetimes = Some(lifetimes);
                presence_barriers = [Direction::ToServer, Direction::ToClient].into_iter();
                self.resend_healing_presence(deadline)?;
                if self.clock.now == deadline {
                    break;
                }
                continue;
            }
            // Core/storage/control work drains independently of periodic traffic.
            let idle = !self.clock.has_non_periodic()
                && self
                    .clients
                    .values()
                    .filter(|client| {
                        client.alive
                            && !matches!(
                                client.core.status().connection,
                                doc_sync_core::ConnectionStatus::Closed(_)
                            )
                    })
                    .all(|client| client.core.is_idle())
                && self.profiles.values().all(|store| store.pending.is_empty())
                && self.servers.values().all(|server| {
                    server.pending_durable == 0
                        && server.inbox.is_empty()
                        && !server.ingress_scheduled
                        && server.busy_until <= self.clock.now
                });
            for (name, client) in &self.clients {
                if client.alive && client.core.is_idle() && settled_clients.insert(name.clone()) {
                    self.events.push(Event {
                        at: self.clock.now(),
                        fact: Fact::ClientSettled {
                            client: name.clone(),
                            session: client.session,
                        },
                    });
                }
            }
            if idle {
                // Freeze finite FIFO cutoffs: first the already-issued upstream
                // publications, then their downstream fanout after real server
                // callbacks drain. New periodic refreshes do not extend either
                // cutoff, even when their interval is shorter than link latency.
                if let Some(direction) = presence_barriers.next() {
                    if let Some(at) = self.clock.issued_presence_until(direction) {
                        self.advance(at.min(deadline).saturating_sub(self.clock.now));
                    }
                    continue;
                }
                if !published_at_idle {
                    // Initial publications may age out while data work drains.
                    // After that work and old FIFO publications finish, issue
                    // one fresh real selection before certifying the first view.
                    // This fixed phase never consults expected presence values.
                    published_at_idle = true;
                    // Stop may release another owner's lease after the entry
                    // Visible load. Rescan once through the real host input,
                    // then drain adoption and snapshot work before capture.
                    let visible = self
                        .clients
                        .iter()
                        .filter(|(_, client)| client.alive)
                        .map(|(name, client)| (name.clone(), client.session))
                        .collect::<Vec<_>>();
                    for (name, session) in visible {
                        self.input(&name, session, SyncInput::Host(HostSignal::Visible))?;
                    }
                    presence_barriers = [Direction::ToServer, Direction::ToClient].into_iter();
                    self.resend_healing_presence(deadline)?;
                    continue;
                }
                if held_since.is_none() {
                    held_since = Some(self.clock.now);
                }
                if self.presence.is_none() {
                    self.presence = Some(
                        self.clients
                            .iter()
                            .filter(|(_, client)| client.alive)
                            .map(|(name, client)| (name.clone(), client.remote.clone()))
                            .collect(),
                    );
                }
                if held_since.is_some_and(|since| self.clock.now.saturating_sub(since) >= heartbeat)
                {
                    self.emit(Fact::Settled);
                    return Ok(());
                }
            } else {
                held_since = None;
            }
            let limit = held_since
                .map(|since: u64| since.saturating_add(heartbeat))
                .unwrap_or(deadline)
                .min(deadline);
            if self.clock.now == deadline {
                break;
            }
            self.advance_next(limit);
        }
        let busy = self
            .clients
            .iter()
            .filter(|(_, client)| client.alive && !client.core.is_idle())
            .map(|(name, client)| (name.clone(), format!("{:?}", client.core.busy())))
            .collect();
        self.emit(Fact::SettleTimedOut {
            busy,
            queued_non_periodic: self.clock.has_non_periodic(),
        });
        Ok(())
    }
    fn presence_expiry_ready_at(&self) -> u64 {
        self.presence_retired_at
            .map(|at| {
                at.saturating_add(self.config.session.presence_timeout.0.unsigned_abs())
                    .saturating_add(
                        self.presence_skew_bounds
                            .1
                            .abs_diff(self.presence_skew_bounds.0),
                    )
                    .saturating_add(self.net.max_latency)
                    .saturating_add(1)
            })
            .unwrap_or(0)
    }

    fn resend_healing_presence(&mut self, deadline: u64) -> Result<(), Failure> {
        // Old keys may legitimately survive their source until TTL. Wait the
        // fixed observed retirement/skew/latency budget before the first healing
        // publication, without consulting expected views or changing wire clocks.
        let ready = self
            .presence_expiry_ready_at()
            .max(self.presence_clock_ready_at);
        self.advance(ready.min(deadline).saturating_sub(self.clock.now));
        let live = self
            .clients
            .iter()
            .filter(|(_, client)| client.alive)
            .map(|(name, client)| {
                (
                    name.clone(),
                    client.session,
                    client.core.presence_selection(client.selection),
                )
            })
            .collect::<Vec<_>>();
        for (name, session, selection) in live {
            self.input(&name, session, SyncInput::SetPresence(selection))?;
        }
        // A replaced peer needs its own explicit selection publication even if
        // the session and connection survive, or periodic refresh is disabled.
        let batch = self
            .config
            .session
            .wal
            .coalesce
            .0
            .saturating_add(self.net.profile.latency.1.0.saturating_mul(2))
            .max(100);
        self.advance(batch.min(deadline.saturating_sub(self.clock.now)));
        Ok(())
    }
}
