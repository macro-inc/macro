use super::*;
use doc_sync_core::{SessionId, WalOwner, WalSeq};
use std::collections::BTreeSet;

fn contains(vv: &Vv, spans: &[IdSpan]) -> bool {
    spans
        .iter()
        .all(|span| vv.get(&span.peer).copied().unwrap_or(0) >= span.end)
}
fn opened(
    outcome: &Outcome,
    session: SessionId,
) -> Option<(&ClientName, &ProfileName, DocIx, &str)> {
    outcome.events.iter().find_map(|event| match &event.fact {
        Fact::Opened {
            client,
            profile,
            session: owner,
            doc,
            user,
            ..
        } if *owner == session => Some((client, profile, *doc, user.as_str())),
        _ => None,
    })
}
// A reopened client name must not erase an old user's retained read-only row.
fn retained_readonly_row(
    outcome: &Outcome,
    profile: &ProfileName,
    doc: DocIx,
    owner: WalOwner,
    seq: WalSeq,
    required: &[IdSpan],
) -> bool {
    let WalOwner::Session(session) = owner else {
        return false;
    };
    let Some(start) = outcome.events.iter().position(
        |event| matches!(&event.fact, Fact::Opened { session: opened, .. } if *opened == session),
    ) else {
        return false;
    };
    let Fact::Opened {
        client,
        access,
        profile: scope,
        doc: row_doc,
        ..
    } = &outcome.events[start].fact
    else {
        return false;
    };
    if scope != profile || *row_doc != doc {
        return false;
    }
    let mut access = *access;
    let mut parked = false;
    for event in outcome.events.iter().skip(start + 1).take_while(
        |event| !matches!(&event.fact, Fact::Opened { client: name, .. } if name == client),
    ) {
        match &event.fact {
            Fact::AccessChanged {
                client: name,
                access: current,
            } if name == client => access = *current,
            Fact::RowsParked { client: name, rows } if name == client => {
                parked = rows
                    .iter()
                    .any(|(row, reason)| *row == seq && reason == "ReadOnly")
            }
            _ => {}
        }
    }
    access != Access::Edit
        && parked
        && outcome.finals.profiles.get(profile).is_some_and(|store| {
            store
                .entries
                .iter()
                .any(|((key, row_owner, row_seq), row)| {
                    key.as_str() == document_key(doc, &outcome.config)
                        && *row_owner == owner
                        && *row_seq == seq
                        && loro::LoroDoc::decode_import_blob_meta(&row.record.bytes, true).is_ok()
                        && crate::document::spans(&row.record.bytes).is_ok_and(|retained| {
                            required.iter().all(|span| ranges_cover(&retained, span))
                        })
                })
        })
}
fn spans_for_update(outcome: &Outcome, update: &str) -> Vec<IdSpan> {
    outcome
        .events
        .iter()
        .find_map(|event| match &event.fact {
            Fact::PushSent {
                update: id, spans, ..
            }
            | Fact::ServerApplied {
                update: id, spans, ..
            } if id == update => Some(spans.clone()),
            _ => None,
        })
        .unwrap_or_default()
}
fn doc_for_client(outcome: &Outcome, name: &ClientName, before: usize) -> Option<DocIx> {
    outcome.events[..=before]
        .iter()
        .rev()
        .find_map(|event| match &event.fact {
            Fact::Opened { client, doc, .. } if client == name => Some(*doc),
            _ => None,
        })
}
fn aliases(
    outcome: &Outcome,
    profile: &ProfileName,
    owner: WalOwner,
    seq: WalSeq,
    doc: DocIx,
) -> BTreeSet<(WalOwner, WalSeq)> {
    let mut result = [(owner, seq)].into_iter().collect::<BTreeSet<_>>();
    for event in &outcome.events {
        if let Fact::WalAdopted {
            profile: scope,
            from,
            to,
            map,
            doc: target,
            ..
        } = &event.fact
            && scope == profile
            && target.as_str() == document_key(doc, &outcome.config)
        {
            for (old, new) in map {
                if result.contains(&(*from, *old)) {
                    result.insert((WalOwner::Session(*to), *new));
                }
            }
        }
    }
    result
}
fn expired(
    outcome: &Outcome,
    profile: &ProfileName,
    rows: &BTreeSet<(WalOwner, WalSeq)>,
    doc: DocIx,
) -> bool {
    outcome.events.iter().any(|event| matches!(&event.fact, Fact::WalExpired { profile: scope, doc: target, owner, seqs } if scope == profile && target.as_str() == document_key(doc, &outcome.config) && seqs.iter().any(|seq| rows.contains(&(*owner, *seq)))))
}
/// Every received acknowledgment's exact operation ranges survive a cold server load and settled peers.
pub fn no_acked_edit_lost(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        let Fact::AckReceived { client, update } = &event.fact else {
            continue;
        };
        let spans = spans_for_update(outcome, update);
        if spans.is_empty() {
            return Err(Failure::new(
                "no_acked_edit_lost",
                format!("ack{update} has no joined push/application"),
            ));
        }
        let doc = doc_for_client(outcome, client, index)
            .ok_or_else(|| Failure::new("no_acked_edit_lost", "ack has no opened document"))?;
        let server = outcome
            .finals
            .servers
            .get(&doc)
            .ok_or_else(|| Failure::new("no_acked_edit_lost", "no persisted server final"))?;
        if !contains(&server.persisted_vv, &spans) {
            return Err(Failure::new(
                "no_acked_edit_lost",
                format!("{update} missing from cold server"),
            ));
        }
        for (name, peer) in &outcome.finals.clients {
            let settled = outcome.events.iter().any(|event| matches!(&event.fact, Fact::ClientSettled { session, .. } if *session == peer.session));
            if peer.alive
                && peer.terminal.is_none()
                && peer.doc == doc
                && settled
                && peer.access != Access::Read
                && !contains(&peer.oplog_vv, &spans)
            {
                return Err(Failure::new(
                    "no_acked_edit_lost",
                    format!("{update} absent from settled {name:?}"),
                ));
            }
        }
    }
    Ok(())
}
/// Durable browser rows are never lost after a same-user writable recovery opportunity.
pub fn no_persisted_edit_lost(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        let Fact::WalDurable {
            profile,
            session,
            seq,
        } = &event.fact
        else {
            continue;
        };
        if outcome.events.iter().skip(index + 1).any(|event| matches!(&event.fact, Fact::WalWriteLost { profile: scope, session: owner, seq: lost } if scope == profile && owner == session && lost == seq)) { continue }
        let Some((_, _, doc, user)) = opened(outcome, *session) else {
            return Err(Failure::new(
                "no_persisted_edit_lost",
                "durable row has no session identity",
            ));
        };
        let recovery =
            outcome
                .events
                .iter()
                .enumerate()
                .skip(index + 1)
                .any(|(settled_index, event)| {
                    let Fact::ClientSettled { session, .. } = &event.fact else {
                        return false;
                    };
                    let identity = opened(outcome, *session).is_some_and(
                        |(_, scope, target, current_user)| {
                            scope == profile && target == doc && current_user == user
                        },
                    );
                    let access = outcome.events[..=settled_index]
                        .iter()
                        .rev()
                        .find_map(|event| match &event.fact {
                            Fact::AccessChanged { client, access }
                                if opened(outcome, *session)
                                    .is_some_and(|(name, _, _, _)| name == client) =>
                            {
                                Some(*access)
                            }
                            Fact::Opened {
                                session: owner,
                                access,
                                ..
                            } if owner == session => Some(*access),
                            _ => None,
                        });
                    let durable = outcome.events.iter().any(|event| matches!(&event.fact,
                        Fact::Opened { session: owner, kind: ClientKind::Tab, .. } if owner == session));
                    identity && durable && access == Some(Access::Edit)
                });
        if !recovery {
            continue;
        }
        let rows = aliases(outcome, profile, WalOwner::Session(*session), *seq, doc);
        if expired(outcome, profile, &rows, doc) {
            continue;
        }
        // Orchestrator corruption ruling: only the exact fault-damaged row,
        // through its actual adoption aliases, may remain absent if retained
        // quarantined and unacknowledged. Acknowledged-edit checks stay strict.
        let key = document_key(doc, &outcome.config);
        let corrupted = outcome.events.iter().any(|event| {
            matches!(&event.fact,
            Fact::WalCorrupted { profile: scope, doc: target, owner, seq }
            if scope == profile && target.as_str() == key && rows.contains(&(*owner, *seq)))
        });
        let retained = outcome.finals.profiles.get(profile).is_some_and(|store| {
            store.entries.iter().any(|((target, owner, seq), row)| {
                target.as_str() == key
                    && rows.contains(&(*owner, *seq))
                    && row.record.quarantined
                    && !row.delivered
            })
        });
        if corrupted && retained {
            continue;
        }
        let spans = outcome
            .events
            .iter()
            .find_map(|event| match &event.fact {
                Fact::WalAppendIssued {
                    profile: scope,
                    session: owner,
                    seq: issued,
                    spans,
                    ..
                } if scope == profile && owner == session && issued == seq => Some(spans),
                _ => None,
            })
            .ok_or_else(|| {
                Failure::new("no_persisted_edit_lost", "durability without an append")
            })?;
        let server = outcome
            .finals
            .servers
            .get(&doc)
            .ok_or_else(|| Failure::new("no_persisted_edit_lost", "missing server"))?;
        if !contains(&server.persisted_vv, spans) {
            return Err(Failure::new(
                "no_persisted_edit_lost",
                format!("durable {session:?}/{seq:?} missing after recovery"),
            ));
        }
    }
    Ok(())
}
/// Edits by a never-crashed session survive even when typed inside the coalesce window.
pub fn no_edit_lost_without_crash(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        let Fact::LocalOp { client, spans, .. } = &event.fact else {
            continue;
        };
        let Some(doc) = doc_for_client(outcome, client, index) else {
            return Err(Failure::new(
                "no_edit_lost_without_crash",
                "local op without an open",
            ));
        };
        let crashed = outcome
            .events
            .iter()
            .skip(index + 1)
            .take_while(
                |event| !matches!(&event.fact, Fact::Opened { client: name, .. } if name == client),
            )
            .any(|event| matches!(&event.fact, Fact::Crashed { client: name } if name == client));
        if crashed {
            continue;
        }
        let corruption = outcome.script.iter().any(|step| {
            matches!(
                step,
                Step::Storage {
                    fault: StorageFault::CorruptRow,
                    ..
                } | Step::Net(NetStep::CorruptNext { .. })
            )
        });
        let mut exempt = Vec::new();
        for issued in &outcome.events {
            let Fact::WalAppendIssued {
                profile,
                session,
                seq,
                spans: row_spans,
                ..
            } = &issued.fact
            else {
                continue;
            };
            let Some((_, _, row_doc, _)) = opened(outcome, *session) else {
                continue;
            };
            if row_doc != doc {
                continue;
            }
            let rows = aliases(outcome, profile, WalOwner::Session(*session), *seq, doc);
            let parked = outcome.finals.clients.values().any(|peer| {
                peer.profile == *profile
                    && peer.doc == doc
                    && peer.parked.iter().any(|(seq, reason)| {
                        rows.contains(&(WalOwner::Session(peer.session), *seq))
                            && (peer.access != Access::Edit || (corruption && reason == "Poison"))
                    })
            });
            // A stopped tab has no later Crashed fact, but a profile power loss
            // can still roll back its exact recent durable row. Keep the join
            // document/profile/owner/sequence scoped; ACK checks remain strict.
            let rolled_back = outcome.events.iter().any(|event| {
                matches!(&event.fact,
                Fact::WalWriteLost { profile: scope, session, seq }
                if scope == profile && rows.contains(&(WalOwner::Session(*session), *seq)))
            });
            if parked
                || rolled_back
                || rows.iter().any(|(owner, seq)| {
                    retained_readonly_row(outcome, profile, doc, *owner, *seq, row_spans)
                })
                || expired(outcome, profile, &rows, doc)
            {
                exempt.extend(row_spans.clone());
            }
        }
        let required = spans
            .iter()
            .filter(|span| !ranges_cover(&exempt, span))
            .cloned()
            .collect::<Vec<_>>();
        let server = outcome
            .finals
            .servers
            .get(&doc)
            .ok_or_else(|| Failure::new("no_edit_lost_without_crash", "missing server"))?;
        if !contains(&server.persisted_vv, &required) {
            return Err(Failure::new(
                "no_edit_lost_without_crash",
                format!("{client:?} lost never-crashed edit {spans:?}"),
            ));
        }
    }
    Ok(())
}
/// No live document or server remains dependent on missing history.
pub fn no_dependency_stuck(outcome: &Outcome) -> Result<(), Failure> {
    if outcome
        .finals
        .servers
        .values()
        .any(|server| server.pending_import)
        || outcome
            .finals
            .clients
            .values()
            .any(|client| client.alive && client.terminal.is_none() && client.pending_import)
    {
        Err(Failure::new(
            "no_dependency_stuck",
            "final document still has pending imports",
        ))
    } else {
        Ok(())
    }
}
/// Every pushable own/foreign/orphan row has drained when a writable peer is available.
pub fn all_wals_drained(outcome: &Outcome) -> Result<(), Failure> {
    for (name, client) in &outcome.finals.clients {
        if client.alive && client.terminal.is_none() && client.wal_undelivered > 0 {
            return Err(Failure::new(
                "all_wals_drained",
                format!("{name:?} retains {} unparked rows", client.wal_undelivered),
            ));
        }
    }
    for (profile, store) in &outcome.finals.profiles {
        for ((doc, owner, seq), row) in &store.entries {
            // Durable delivery is a contiguous prefix. A live owner can have an
            // exact acknowledged row above a parked gap, without persisting a
            // false prefix over that gap.
            let acknowledged = outcome
                .finals
                .clients
                .values()
                .any(|client| client.alive && *owner == WalOwner::Session(client.session))
                && outcome.events.iter().any(|event| match &event.fact {
                    Fact::PushSent {
                        client,
                        update,
                        rows,
                        ..
                    } => {
                        rows.contains(&(*owner, *seq))
                            && outcome.events.iter().any(|event| {
                                matches!(&event.fact,
                            Fact::AckReceived { client: receiver, update: id }
                            if receiver == client && id == update)
                            })
                            && outcome.finals.clients.get(client).is_some_and(|client| {
                                client.profile == *profile
                                    && document_key(client.doc, &outcome.config) == doc.as_str()
                            })
                    }
                    _ => false,
                });
            let writable = outcome.finals.clients.values().any(|client| {
                client.alive
                    && client.terminal.is_none()
                    && client.profile == *profile
                    && client.user == row.record.user.0
                    && client.kind == ClientKind::Tab
                    && client.access == Access::Edit
                    && document_key(client.doc, &outcome.config) == doc.to_string()
            });
            let parked_readonly = outcome.finals.clients.values().any(|client| {
                client.alive
                    && client.profile == *profile
                    && client.access != Access::Edit
                    && *owner == WalOwner::Session(client.session)
                    && document_key(client.doc, &outcome.config) == doc.as_str()
                    && client
                        .parked
                        .iter()
                        .any(|(parked, reason)| *parked == *seq && reason == "ReadOnly")
            });
            if writable
                && !row.delivered
                && !row.record.quarantined
                && !acknowledged
                && !parked_readonly
            {
                return Err(Failure::new(
                    "all_wals_drained",
                    format!("{profile:?} has an undelivered orphan/foreign row"),
                ));
            }
        }
    }
    Ok(())
}
fn document_key(doc: DocIx, config: &SimConfig) -> String {
    let id = format!("00000000-0000-7000-8000-{:012x}", u64::from(doc.0) + 1);
    if config.surfaces.contains(&doc) {
        format!("surface:{id}")
    } else {
        id
    }
}
