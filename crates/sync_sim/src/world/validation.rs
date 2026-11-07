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
                Fact::LocalCommit { spans, .. } | Fact::ServerCommit { spans, .. } => {
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
            if let Some((_, rows)) = client.core.push_in_flight() {
                let diagnostics = wal
                    .entries
                    .iter()
                    .map(|row| FlightRow {
                        seq: row.seq,
                        bytes: row.bytes.len(),
                        eligible: !row.superseded
                            && !client.core.is_delivered(row.seq)
                            && row.park.is_none_or(|reason| {
                                reason == doc_sync_core::ParkReason::NeedsRebase
                            }),
                        writing: matches!(row.state, doc_sync_core::EntryState::Writing(_)),
                    })
                    .collect::<Vec<_>>();
                if let Err(detail) = check_flight(rows, &diagnostics, wal.delivered_through) {
                    failures.push(Failure::new(
                        "wal_well_formed",
                        format!("{name:?}: {detail}"),
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
            let link_open = if client.routed {
                self.routed_open(name)
            } else {
                self.net
                    .links
                    .iter()
                    .any(|((link_name, session, conn), link)| {
                        link_name == name
                            && *session == client.session
                            && client.connection_id() == Some(ConnId(*conn))
                            && link.open
                    })
            };
            if !client.frozen
                && client.core.status().connection == ConnectionStatus::Connected
                && !link_open
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
            let owners = groups
                .keys()
                .chain(
                    self.prefixes
                        .keys()
                        .filter(|(scope, _, _)| scope == profile),
                )
                .cloned()
                .collect::<BTreeSet<_>>();
            for owner in owners {
                let prefix = groups.get(&owner).and_then(|rows| {
                    rows.iter()
                        .take_while(|(_, delivered)| *delivered)
                        .last()
                        .map(|(seq, _)| *seq)
                });
                if let Some(old) = self.prefixes.get(&owner).copied()
                    && prefix.is_none_or(|new| new < old)
                {
                    let allowed = self.events[self.prefix_event..]
                        .iter()
                        .any(|event| match &event.fact {
                            Fact::WalPruned {
                                profile,
                                doc,
                                owner: session,
                                seqs,
                            } => {
                                *profile == owner.0
                                    && doc.as_str() == owner.1
                                    && doc_sync_core::WalOwner::Session(*session) == owner.2
                                    && seqs.contains(&old)
                            }
                            Fact::WalDeliveryLost {
                                profile,
                                doc,
                                owner: lost_owner,
                                seqs,
                            } => {
                                *profile == owner.0
                                    && doc.as_str() == owner.1
                                    && *lost_owner == owner.2
                                    && seqs.contains(&old)
                            }
                            Fact::WalAdopted {
                                profile,
                                doc,
                                from,
                                removed,
                                ..
                            } => {
                                *profile == owner.0
                                    && doc.as_str() == owner.1
                                    && *from == owner.2
                                    && removed.contains(&old)
                            }
                            _ => false,
                        });
                    if !allowed {
                        failures.push(Failure::new(
                            "durable_prefix_monotone",
                            format!("{owner:?}: prefix {old:?} regressed to {prefix:?}"),
                        ));
                        continue;
                    }
                }
                if let Some(prefix) = prefix {
                    self.prefixes.insert(owner, prefix);
                } else {
                    self.prefixes.remove(&owner);
                }
            }
        }
        self.prefix_event = self.events.len();
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
pub(crate) fn canonical(value: serde_json::Value) -> serde_json::Value {
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
pub(crate) fn canonical_finals(finals: &Finals) -> serde_json::Value {
    let clients = finals.clients.iter().map(|(name, state)| serde_json::json!({ "name": name, "alive": state.alive, "terminal": state.terminal, "session": state.session, "profile": state.profile, "user": state.user, "doc": state.doc, "access": state.access, "kind": state.kind, "peer": state.peer, "vv": state.oplog_vv, "value": state.deep_value, "wal": state.wal_undelivered, "total": state.wal_total, "parked": state.parked, "status": format!("{:?}", state.status), "storage_healthy": state.storage_healthy, "pending": state.pending_import, "selection": state.selection, "presence_key": state.presence_key, "skew": state.skew })).collect::<Vec<_>>();
    let profiles = finals.profiles.iter().map(|(name, store)| serde_json::json!({ "name": name, "rows": store.entries.iter().collect::<Vec<_>>(), "snapshots": store.snapshots })).collect::<Vec<_>>();
    canonical(
        serde_json::json!({ "clients": clients, "servers": finals.servers.iter().collect::<Vec<_>>(), "profiles": profiles, "presence": finals.presence.as_ref().map(|presence| presence.iter().collect::<Vec<_>>()) }),
    )
}

struct FlightRow {
    seq: doc_sync_core::WalSeq,
    bytes: usize,
    eligible: bool,
    writing: bool,
}
fn check_flight(
    rows: &[doc_sync_core::WalSeq],
    entries: &[FlightRow],
    delivered: Option<doc_sync_core::WalSeq>,
) -> Result<(), &'static str> {
    if rows.is_empty() || rows.len() > 64 {
        return Err("in-flight push is empty or exceeds64 rows");
    }
    if rows.windows(2).any(|pair| pair[0] >= pair[1])
        || delivered.is_some_and(|through| rows[0] <= through)
    {
        return Err("in-flight rows are unordered or below the delivered prefix");
    }
    let last = rows[rows.len() - 1];
    let expected = entries
        .iter()
        .filter(|row| row.eligible && row.seq <= last)
        .collect::<Vec<_>>();
    if expected.iter().map(|row| row.seq).collect::<Vec<_>>() != rows
        || expected.iter().any(|row| row.writing)
    {
        return Err("in-flight range is not a contiguous pushable run");
    }
    // S7 W-1 / S8's large-paste story: one oversized row is sent alone.
    if rows.len() > 1 && expected.iter().map(|row| row.bytes).sum::<usize>() > 256 * 1024 {
        return Err("multi-row push exceeds256KiB");
    }
    Ok(())
}

#[cfg(test)]
mod test;
