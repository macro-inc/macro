use super::*;
use doc_sync_core::{ConnectionStatus, SaveState, StorageHealth};

impl Sim {
    pub(super) fn validate(&mut self) {
        let mut failures = Vec::new();
        let mut created = BTreeMap::<u64, i32>::new();
        for event in &self.events {
            match &event.fact {
                Fact::ServerSeed { vv, .. } => {
                    for (peer, counter) in vv {
                        created
                            .entry(*peer)
                            .and_modify(|old| *old = (*old).max(*counter))
                            .or_insert(*counter);
                    }
                }
                Fact::LocalCommit { spans, .. } => {
                    for span in spans {
                        created
                            .entry(span.peer)
                            .and_modify(|old| *old = (*old).max(span.end))
                            .or_insert(span.end);
                    }
                }
                _ => {}
            }
        }
        for (name, client) in &self.clients {
            if !client.alive {
                continue;
            }
            let wal = client.core.wal();
            let mut previous = None;
            for row in &wal.entries {
                if previous.is_some_and(|seq| row.seq <= seq) {
                    failures.push(Failure::new(
                        "wal_well_formed",
                        format!("{name:?}: non-increasing row sequence"),
                    ));
                }
                previous = Some(row.seq);
            }
            if wal.delivered_through.is_some_and(|seq| seq >= wal.next_seq) {
                failures.push(Failure::new(
                    "wal_well_formed",
                    format!("{name:?}: delivered prefix exceeds allocated rows"),
                ));
            }
            for (peer, counter) in client.doc.loro.oplog_vv().iter() {
                if *counter > created.get(peer).copied().unwrap_or(0) {
                    failures.push(Failure::new(
                        "no_future_vv",
                        format!("{name:?}: peer{peer} counter{counter} exceeds observed commits"),
                    ));
                }
            }
            let final_state = match client.final_state() {
                Ok(state) => state,
                Err(error) => {
                    failures.push(error);
                    continue;
                }
            };
            if client.core.status().save == SaveState::Saved
                && (final_state.wal_total > 0
                    || !final_state.parked.is_empty()
                    || final_state.pending_import
                    || !matches!(wal.health, StorageHealth::Ok)
                    || client.core.busy() == Some(doc_sync_core::BusyReason::Rebasing))
            {
                failures.push(Failure::new(
                    "status_truthful",
                    format!("{name:?}: Saved with retained or unhealthy work"),
                ));
            }
            if !client.frozen
                && client.core.status().connection == ConnectionStatus::Connected
                && !self
                    .net
                    .links
                    .iter()
                    .any(|((link_name, session, conn), link)| {
                        link_name == name
                            && *session == client.session
                            && client.connection_id() == Some(ConnId(*conn))
                            && link.open
                    })
            {
                failures.push(Failure::new(
                    "status_truthful",
                    format!("{name:?}: Connected with no open link"),
                ));
            }
        }
        for (profile, store) in &self.profiles {
            let mut groups = BTreeMap::new();
            for ((doc, owner, seq), row) in &store.durable.entries {
                groups
                    .entry((profile.clone(), doc.to_string(), *owner))
                    .or_insert_with(Vec::new)
                    .push((*seq, row.delivered));
            }
            for (owner, rows) in groups {
                let prefix = rows
                    .iter()
                    .take_while(|(_, delivered)| *delivered)
                    .last()
                    .map(|(seq, _)| *seq);
                if let (Some(old), Some(new)) = (self.prefixes.get(&owner), prefix)
                    && new < *old
                {
                    failures.push(Failure::new(
                        "durable_prefix_monotone",
                        format!("{owner:?}: delivered prefix shrank"),
                    ));
                }
                if let Some(prefix) = prefix {
                    self.prefixes.insert(owner, prefix);
                }
            }
        }
        for failure in failures {
            self.fail(failure);
        }
    }
    pub(super) fn finals(&mut self) -> Finals {
        let mut clients = BTreeMap::new();
        let mut servers = BTreeMap::new();
        let names = self.clients.keys().cloned().collect::<Vec<_>>();
        for name in names {
            if let Some(client) = self.clients.get(&name) {
                match client.final_state() {
                    Ok(state) => {
                        clients.insert(name, state);
                    }
                    Err(error) => self.fail(error),
                }
            }
        }
        let docs = self.servers.keys().copied().collect::<Vec<_>>();
        for doc in docs {
            let result = self.servers.get_mut(&doc).map(SimServer::final_state);
            if let Some(result) = result {
                match result {
                    Ok(state) => {
                        servers.insert(doc, state);
                    }
                    Err(error) => self.fail(error),
                }
            }
            if let Some(server) = self.servers.get_mut(&doc) {
                let callback = server.callback;
                server.callback = server.callback.saturating_add(1);
                self.server_ports
                    .extend(
                        server
                            .ports
                            .take_effects()
                            .into_iter()
                            .map(|effect| ServerPort {
                                doc,
                                callback,
                                effect,
                            }),
                    );
            }
        }
        Finals {
            clients,
            servers,
            profiles: self
                .profiles
                .iter()
                .map(|(name, store)| (name.clone(), store.durable.clone()))
                .collect(),
            presence: self.presence.clone(),
        }
    }
    pub(super) fn trace(&mut self, events: &[u8], before: &Finals, after: &Finals) -> u64 {
        let ports = self
            .server_ports
            .iter()
            .map(|port| {
                (
                    port.doc,
                    port.callback,
                    port.effect.operation.clone(),
                    canonical(port.effect.value.clone()),
                )
            })
            .collect::<Vec<_>>();
        match postcard::to_allocvec(&(
            events,
            ports,
            canonical_finals(before),
            canonical_finals(after),
        )) {
            Ok(bytes) => xxhash_rust::xxh3::xxh3_64(&bytes),
            Err(error) => {
                self.fail(Failure::new("canonical_log", error));
                0
            }
        }
    }
}
pub(super) fn canonical(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let ordered = map
                .into_iter()
                .map(|(key, value)| (key, canonical(value)))
                .collect::<BTreeMap<_, _>>();
            serde_json::Value::Object(ordered.into_iter().collect())
        }
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.into_iter().map(canonical).collect())
        }
        other => other,
    }
}
fn canonical_finals(finals: &Finals) -> serde_json::Value {
    let clients = finals.clients.iter().map(|(name, state)| serde_json::json!({ "name": name, "alive": state.alive, "terminal": state.terminal, "session": state.session, "profile": state.profile, "user": state.user, "doc": state.doc, "access": state.access, "kind": state.kind, "peer": state.peer, "vv": state.oplog_vv, "value": state.deep_value, "wal": state.wal_undelivered, "total": state.wal_total, "parked": state.parked, "status": format!("{:?}", state.status), "storage_healthy": state.storage_healthy, "pending": state.pending_import, "selection": state.selection, "presence_key": state.presence_key, "skew": state.skew })).collect::<Vec<_>>();
    let profiles = finals.profiles.iter().map(|(name, store)| serde_json::json!({ "name": name, "rows": store.entries.iter().collect::<Vec<_>>(), "snapshots": store.snapshots })).collect::<Vec<_>>();
    canonical(
        serde_json::json!({ "clients": clients, "servers": finals.servers.iter().collect::<Vec<_>>(), "profiles": profiles, "presence": finals.presence.as_ref().map(|presence| presence.iter().collect::<Vec<_>>()) }),
    )
}
