//! Invariant queries over raw core, storage and real editor observations.
use crate::*;
mod history;
mod lifecycle;
pub use history::*;
pub use lifecycle::*;
mod durability;
pub use durability::*;
mod policy;
pub use policy::*;
mod presence;
pub use presence::*;

/// Run every currently applicable fact-based invariant.
pub fn check_all(outcome: &Outcome) -> Result<(), Vec<Failure>> {
    let hostile = outcome.config.net.hostile.is_some() || outcome.script.iter().any(|step|
        matches!(step, Step::Net(NetStep::Profile(profile)) if profile.hostile.is_some()));
    let errors = ALL_INVARIANTS
        .iter()
        .filter(|(name, _)| !hostile || HOSTILE_SAFETY_INVARIANTS.contains(name))
        .filter_map(|(_, check)| check(outcome).err())
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}
/// One immutable-outcome invariant query.
pub type Invariant = fn(&Outcome) -> Result<(), Failure>;
/// S8's hostile-network subset; liveness and quietness are intentionally not asserted.
pub const HOSTILE_SAFETY_INVARIANTS: &[&str] = &[
    "redo_restores_selection",
    "every_close_terminates",
    "no_seed_over_unadopted_wal",
    "oversized_operations_complete",
    "no_acked_edit_lost",
    "no_persisted_edit_lost",
    "all_docs_equal",
    "editor_states_equal",
    "refused_updates_never_applied",
    "per_step",
];
/// Named query registry used by stories and generated scripts.
pub const ALL_INVARIANTS: &[(&str, Invariant)] = &[
    ("settled", settled),
    ("redo_restores_selection", redo_restores_selection),
    ("every_close_terminates", every_close_terminates),
    ("no_seed_over_unadopted_wal", no_seed_over_unadopted_wal),
    ("all_docs_equal", all_docs_equal),
    ("editor_states_equal", editor_states_equal),
    ("projection_consistent", projection_consistent),
    ("projection_recovery_visible", projection_recovery_visible),
    ("no_acked_edit_lost", no_acked_edit_lost),
    ("no_persisted_edit_lost", no_persisted_edit_lost),
    ("no_edit_lost_without_crash", no_edit_lost_without_crash),
    ("no_dependency_stuck", no_dependency_stuck),
    ("all_wals_drained", all_wals_drained),
    ("quiet", quiet),
    ("core_acks_after_writes", core_acks_after_writes),
    (
        "oversized_operations_complete",
        oversized_operations_complete,
    ),
    ("gate_releases_after_durable", gate_releases_after_durable),
    (
        "refused_updates_never_applied",
        refused_updates_never_applied,
    ),
    ("comment_replies_truthful", comment_replies_truthful),
    ("ai_peers_hidden", ai_peers_hidden),
    ("presence_converged", presence_converged),
    ("presence_expires", presence_expires),
    ("undo_reverts_only_own", undo_reverts_only_own),
    ("no_transient_quarantine", no_transient_quarantine),
    ("no_spurious_terminal", no_spurious_terminal),
    ("per_step", per_step),
];
/// Settled live editor peers of a document expose identical synced model JSON.
pub fn editor_states_equal(outcome: &Outcome) -> Result<(), Failure> {
    let mut states = std::collections::BTreeMap::new();
    for (name, client) in &outcome.finals.clients {
        if !client.alive || client.terminal.is_some() {
            continue;
        }
        let Some(editor) = &client.editor else {
            if matches!(
                outcome.config.seeds.get(&client.doc),
                Some(SeedDocument::Editor(_) | SeedDocument::StoredEditor(_))
            ) {
                return Err(Failure::new(
                    "editor_states_equal",
                    format!("{name:?}: missing real editor observation"),
                ));
            }
            continue;
        };
        // Revoked-writer ruling: only exact retained ReadOnly private history
        // may differ until regrant. Own projection checks remain strict.
        if durability::readonly_private_history_retained(outcome, client) {
            continue;
        }
        if let Some((other, state)) = states.insert(client.doc, (name, &editor.synced_json))
            && state != &editor.synced_json
        {
            return Err(Failure::new(
                "editor_states_equal",
                format!("{name:?} differs from {other:?}"),
            ));
        }
    }
    Ok(())
}
// A recovery diagnostic remains an error unless its actual imported interval
// contains an earlier injected write on the same route, or the exact author
// incarnation still observes its own bad write. Healthy checks never skip.
pub(crate) fn projection_recovery_explained(
    events: &[Event],
    client: &ClientName,
    session: doc_sync_core::SessionId,
    doc: DocIx,
    spans: &[IdSpan],
    vv: &Vv,
) -> bool {
    events.iter().any(|event| matches!(&event.fact,
        Fact::ProjectionFaultWrite { client: producer, session: epoch, doc: route, peer, start, end, previous, written, .. }
            if *route == doc && end > start && previous != written
                && (ranges_cover(spans, &IdSpan { peer: *peer, start: *start, end: *end })
                    || (producer == client && *epoch == session && vv.get(peer).copied().unwrap_or(0) >= *end))))
}
/// Recovered visible projection errors require exact observed injected operation evidence.
pub fn projection_recovery_visible(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        if let Fact::ProjectionRecovered {
            client,
            session,
            doc,
            spans,
            vv,
            ..
        } = &event.fact
            && !projection_recovery_explained(
                &outcome.events[..index],
                client,
                *session,
                *doc,
                spans,
                vv,
            )
        {
            return Err(Failure::new(
                "projection_recovery_visible",
                "projection recovery without an imported injected span",
            ));
        }
    }
    Ok(())
}
// Fault ruling: only an observed injection into this exact incarnation exempts
// subsequent projection checks. This never filters convergence/loss or old failures.
pub(crate) fn projection_faulted(
    events: &[Event],
    client: &ClientName,
    session: doc_sync_core::SessionId,
    doc: DocIx,
) -> bool {
    events.iter().any(|event| matches!(&event.fact,
        Fact::ProjectionFaultWrite { client: name, session: epoch, doc: route, start, end, previous, written, .. }
            if name == client && *epoch == session && *route == doc && end > start && previous != written))
}
/// Every captured live model agrees with reconstruction from its actual Loro document.
pub fn projection_consistent(outcome: &Outcome) -> Result<(), Failure> {
    for (name, client) in &outcome.finals.clients {
        if projection_faulted(&outcome.events, name, client.session, client.doc) {
            continue;
        }
        if client.alive
            && client.terminal.is_none()
            && matches!(
                outcome.config.seeds.get(&client.doc),
                Some(SeedDocument::Editor(_) | SeedDocument::StoredEditor(_))
            )
            && client.editor.is_none()
        {
            return Err(Failure::new(
                "projection_consistent",
                format!("{name:?}: missing real editor observation"),
            ));
        }
        if let Some(editor) = &client.editor
            && editor.synced_json != editor.reconstructed
        {
            return Err(Failure::new(
                "projection_consistent",
                format!("{name:?}: model differs from persisted reconstruction"),
            ));
        }
    }
    Ok(())
}
/// The final settle transition must succeed.
pub fn settled(outcome: &Outcome) -> Result<(), Failure> {
    match outcome
        .events
        .iter()
        .rev()
        .find(|event| matches!(event.fact, Fact::Settled | Fact::SettleTimedOut { .. }))
    {
        Some(Event {
            fact: Fact::Settled,
            ..
        }) => Ok(()),
        Some(Event {
            at,
            fact:
                Fact::SettleTimedOut {
                    busy,
                    queued_non_periodic,
                },
        }) => {
            let mut failure = Failure::new(
                "settled",
                format!("settle timed out: {busy:?}; queued_non_periodic={queued_non_periodic}"),
            );
            failure.at = Some(*at);
            Err(failure)
        }
        _ => Err(Failure::new("settled", "no successful final settle")),
    }
}
/// Live clients and their real server agree on both content and operation history.
pub fn all_docs_equal(outcome: &Outcome) -> Result<(), Failure> {
    for (name, client) in &outcome.finals.clients {
        if !client.alive || client.terminal.is_some() {
            continue;
        }
        let server = outcome
            .finals
            .servers
            .get(&client.doc)
            .ok_or_else(|| Failure::new("all_docs_equal", "missing server final"))?;
        // S8 §4.1 requires read-only replicas to cover the server's visible VV.
        // A revoked writer may also retain private, parked edits, so its VV and
        // content need not equal the server until write access is regranted.
        if client.access != Access::Edit {
            if !server
                .oplog_vv
                .iter()
                .all(|(peer, end)| client.oplog_vv.get(peer).copied().unwrap_or(0) >= *end)
            {
                return Err(Failure::new(
                    "all_docs_equal",
                    format!("{name:?} misses received server history"),
                ));
            }
            if client.oplog_vv != server.oplog_vv {
                continue;
            }
        }
        if client.oplog_vv != server.oplog_vv || client.deep_value != server.deep_value {
            return Err(Failure::new(
                "all_docs_equal",
                format!("{name:?} differs from {:?}", client.doc),
            ));
        }
    }
    Ok(())
}
/// Every live-state check and executor transition completed without a harness failure.
pub fn per_step(outcome: &Outcome) -> Result<(), Failure> {
    if let Some(failure) = outcome.per_step_failures.first() {
        Err(failure.clone())
    } else {
        Ok(())
    }
}

// Ranges can cross export boundaries; require coverage by the union, not one row.
pub(crate) fn ranges_cover(ranges: &[IdSpan], target: &IdSpan) -> bool {
    let mut intervals = ranges
        .iter()
        .filter(|span| span.peer == target.peer)
        .map(|span| (span.start, span.end))
        .collect::<Vec<_>>();
    intervals.sort_unstable();
    let mut through = target.start;
    for (start, end) in intervals {
        if start > through {
            break;
        }
        through = through.max(end);
        if through >= target.end {
            return true;
        }
    }
    through >= target.end
}
