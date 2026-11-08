//! Coverage counters are observations, never inferred from a requested fault alone.
use crate::*;
use doc_sync_core::{ConnectionStatus, SessionId, WalOwner};
use std::collections::{BTreeMap, BTreeSet};

impl RunStats {
    pub(crate) fn observe(&mut self, events: &[Event], finals: &Finals) {
        let mut owners = BTreeMap::<SessionId, ClientName>::new();
        let mut current = BTreeMap::new();
        let mut released = BTreeSet::new();
        let mut last_connection = BTreeMap::new();
        let mut foreign = BTreeSet::new();
        let mut multi_tab = BTreeSet::new();
        let mut sockets = BTreeSet::new();

        for event in events {
            match &event.fact {
                Fact::Opened {
                    client,
                    session,
                    profile,
                    doc,
                    access,
                    kind,
                    ..
                } => {
                    owners.insert(*session, client.clone());
                    sockets.remove(client);
                    last_connection.remove(client);
                    if *kind == ClientKind::Tab
                        && *access == Access::Edit
                        && current.values().any(|(p, d, access, kind)| {
                            p == profile
                                && d == doc
                                && *access == Access::Edit
                                && *kind == ClientKind::Tab
                        })
                    {
                        multi_tab.insert(profile.clone());
                    }
                    current.insert(client.clone(), (profile.clone(), *doc, *access, *kind));
                }
                Fact::LocalOp { op, .. } => {
                    let kind = match op {
                        AbstractOp::Editor(EditorOp::Type { .. }) => "Type",
                        AbstractOp::Editor(EditorOp::Select { .. }) => "EditorSelect",
                        AbstractOp::Editor(EditorOp::SetBlock { .. }) => "SetBlock",
                        AbstractOp::Editor(EditorOp::ToggleList { .. }) => "ToggleList",
                        AbstractOp::Editor(EditorOp::InsertTable { .. }) => "InsertTable",
                        AbstractOp::Editor(EditorOp::Backspace { .. }) => "Backspace",
                        AbstractOp::Editor(EditorOp::DeleteRange { .. }) => "DeleteRange",
                        AbstractOp::Editor(EditorOp::SplitBlock { .. }) => "SplitBlock",
                        AbstractOp::Editor(EditorOp::Format { .. }) => "Format",
                        AbstractOp::Editor(EditorOp::Indent { .. }) => "Indent",
                        AbstractOp::Editor(EditorOp::Outdent { .. }) => "Outdent",
                        AbstractOp::Editor(EditorOp::Undo) => "Undo",
                        AbstractOp::Editor(EditorOp::Redo) => "Redo",
                        AbstractOp::FormSet { .. } => "FormSet",
                        AbstractOp::FormMove { .. } => "FormMove",
                        AbstractOp::FormText { .. } => "FormText",
                        AbstractOp::Select(_) => "Select",
                    };
                    *self.ops_by_kind.entry(kind.into()).or_default() += 1;
                }
                Fact::OpSkipped { .. } => self.skipped_ops += 1,
                Fact::Crashed { client } => {
                    self.crashes += 1;
                    released.extend(
                        owners
                            .iter()
                            .filter(|(_, writer)| *writer == client)
                            .map(|(session, _)| *session),
                    );
                    current.remove(client);
                }
                Fact::ProfileCrashed { .. } => self.profile_crashes += 1,
                Fact::Closed { client } => {
                    current.remove(client);
                }
                Fact::Status { client, status } => {
                    if last_connection.get(client) != Some(&status.connection) {
                        if status.connection == ConnectionStatus::Offline {
                            self.gave_up += 1;
                        }
                        if status.connection == ConnectionStatus::Connected
                            && !sockets.insert(client.clone())
                        {
                            self.reconnects += 1;
                        }
                    }
                    last_connection.insert(client.clone(), status.connection.clone());
                }
                Fact::Imported { pending: true, .. } => self.pending_imports += 1,
                Fact::WalAdopted { map, .. } if !map.is_empty() => self.adoptions += 1,
                Fact::WalAppendIssued {
                    session,
                    seq,
                    foreign: true,
                    ..
                } => {
                    foreign.insert((*session, *seq));
                }
                Fact::WalDurable { session, seq, .. } => {
                    if foreign.contains(&(*session, *seq)) {
                        self.foreign_rows += 1;
                    }
                    if released.contains(session) {
                        self.late_commits_after_lock_release += 1;
                    }
                }
                Fact::PushSent {
                    client,
                    rows,
                    foreign_bytes,
                    own_bytes,
                    ..
                } => {
                    self.foreign_bytes_pushed += foreign_bytes;
                    self.own_bytes_pushed += own_bytes;
                    if rows.iter().any(|(owner, _)| matches!(owner, WalOwner::Session(id) if owners.get(id).is_some_and(|writer| writer != client))) { self.assisted_pushes += 1; }
                }
                Fact::Frame {
                    kind: FrameKind::Ack,
                    fate,
                    ..
                } if fate == "Dropped" => self.acks_lost += 1,
                Fact::AccessChanged { client, access } => {
                    self.access_changes += 1;
                    if let Some((_, _, grant, _)) = current.get_mut(client) {
                        *grant = *access;
                    }
                    if let Some((profile, doc, Access::Edit, ClientKind::Tab)) = current.get(client)
                        && current.iter().any(|(other, (p, d, access, kind))| {
                            other != client
                                && p == profile
                                && d == doc
                                && *access == Access::Edit
                                && *kind == ClientKind::Tab
                        })
                    {
                        multi_tab.insert(profile.clone());
                    }
                }
                Fact::Telemetry {
                    name,
                    phase: TelemetryPhase::Start,
                    ..
                } if name == "doc.sync.reset" => self.resets += 1,
                Fact::Telemetry {
                    name,
                    phase: TelemetryPhase::Start,
                    ..
                } if name == "doc.sync.catchup" => self.converge_rounds += 1,
                Fact::Server { operation }
                    if operation == "crashed" || operation == "Hibernate" =>
                {
                    self.server_crashes += 1
                }
                Fact::Server { operation }
                    if operation.starts_with("callback_error:")
                        && operation.contains("simulated directory outage") =>
                {
                    self.d1_outages += 1
                }
                Fact::Server { operation }
                    if operation.starts_with("callback_error:")
                        && operation.contains("simulated storage error") =>
                {
                    self.storage_outages += 1;
                }
                _ => {}
            }
        }
        self.multi_edit_tab_profiles = u64::try_from(multi_tab.len()).unwrap_or(u64::MAX);
        self.parked_rows_at_end = finals
            .clients
            .values()
            .filter(|client| client.alive)
            .map(|client| u64::try_from(client.parked.len()).unwrap_or(u64::MAX))
            .sum();
        // Only a requested Close inside the window counts; later terminal appends
        // may finish well after that window. Runtime accounting is recorded at Close.
    }
}
