//! Invariant queries over raw observations; editor-specific adapters remain explicitly pending.
use crate::*;
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
        .filter(|(name, _)| !PENDING_EDITOR_INVARIANTS.contains(name))
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
    ("all_docs_equal", all_docs_equal),
    ("editor_states_equal", editor_states_equal),
    ("projection_consistent", projection_consistent),
    ("no_acked_edit_lost", no_acked_edit_lost),
    ("no_persisted_edit_lost", no_persisted_edit_lost),
    ("no_edit_lost_without_crash", no_edit_lost_without_crash),
    ("no_dependency_stuck", no_dependency_stuck),
    ("all_wals_drained", all_wals_drained),
    ("quiet", quiet),
    ("core_acks_after_writes", core_acks_after_writes),
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
/// These two checks require the explicitly deferred editor projection adapters.
/// `check_all` reports only applicable GenericSurface/fact checks; calling a pending
/// query directly returns a failure, never a fabricated editor safety proof.
pub const PENDING_EDITOR_INVARIANTS: &[&str] = &["editor_states_equal", "projection_consistent"];
/// Editor model convergence remains pending until real session/projection integration.
pub fn editor_states_equal(_: &Outcome) -> Result<(), Failure> {
    Err(Failure::new(
        "editor_states_equal",
        "pending document_session / lexical_loro adapter",
    ))
}
/// Editor/model projection agreement remains pending; GenericSurface has no editor model.
pub fn projection_consistent(_: &Outcome) -> Result<(), Failure> {
    Err(Failure::new(
        "projection_consistent",
        "pending lexical_model / lexical_loro adapter",
    ))
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
            fact: Fact::SettleTimedOut { busy },
        }) => {
            let mut failure = Failure::new("settled", format!("settle timed out: {busy:?}"));
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
