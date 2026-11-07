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
) -> BTreeSet<(WalOwner, WalSeq)> {
    let mut result = [(owner, seq)].into_iter().collect::<BTreeSet<_>>();
    for event in &outcome.events {
        if let Fact::WalAdopted {
            profile: scope,
            from,
            to,
            map,
        } = &event.fact
            && scope == profile
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
fn expired(outcome: &Outcome, profile: &ProfileName, rows: &BTreeSet<(WalOwner, WalSeq)>) -> bool {
    outcome.events.iter().any(|event| matches!(&event.fact, Fact::WalExpired { profile: scope, owner, seqs } if scope == profile && seqs.iter().any(|seq| rows.contains(&(*owner, *seq)))))
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
                    identity && access == Some(Access::Edit)
                });
        if !recovery {
            continue;
        }
        let rows = aliases(outcome, profile, WalOwner::Session(*session), *seq);
        if expired(outcome, profile, &rows) {
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
            let rows = aliases(outcome, profile, WalOwner::Session(*session), *seq);
            let parked = outcome.finals.clients.values().any(|peer| {
                peer.profile == *profile
                    && peer.doc == doc
                    && peer.parked.iter().any(|(seq, reason)| {
                        rows.contains(&(WalOwner::Session(peer.session), *seq))
                            && (peer.access != Access::Edit || (corruption && reason == "Poison"))
                    })
            });
            if parked || expired(outcome, profile, &rows) {
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
        for ((doc, _, _), row) in &store.entries {
            let writable = outcome.finals.clients.values().any(|client| {
                client.alive
                    && client.terminal.is_none()
                    && client.profile == *profile
                    && client.user == row.record.user.0
                    && client.access == Access::Edit
                    && document_key(client.doc) == doc.to_string()
            });
            if writable && !row.delivered && !row.record.quarantined {
                return Err(Failure::new(
                    "all_wals_drained",
                    format!("{profile:?} has an undelivered orphan/foreign row"),
                ));
            }
        }
    }
    Ok(())
}
pub(super) fn document_key(doc: DocIx) -> String {
    format!("00000000-0000-7000-8000-{:012x}", u64::from(doc.0) + 1)
}
