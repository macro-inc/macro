//! GenericSurface counterparts of S8 §10; editor-only stories are listed in COVERAGE.md.
use sync_sim::*;

fn verify(config: SimConfig, script: &[Step]) -> Outcome {
    let outcome = Sim::new(config).run(script);
    if let Err(failures) = invariants::check_all(&outcome) {
        panic!(
            "{failures:#?}\n{}\nfinals: {:#?}\nall events: {:#?}",
            outcome.failure_report(),
            outcome.finals,
            outcome.events
        );
    }
    outcome.check_replay().unwrap();
    outcome
}
#[path = "stories/durability.rs"]
mod durability;
#[path = "stories/recovery.rs"]
mod recovery;
#[path = "stories/reset.rs"]
mod reset;
#[path = "stories/transport.rs"]
mod transport;

#[path = "stories/chatter.rs"]
mod chatter;
#[path = "stories/faults.rs"]
mod faults;
#[path = "stories/lifecycle.rs"]
mod lifecycle;

#[path = "stories/rebased_pending.rs"]
mod rebased_pending;

#[path = "stories/storage_capabilities.rs"]
mod storage_capabilities;

#[path = "stories/failed_persistence.rs"]
mod failed_persistence;

#[path = "stories/confirmed_gap.rs"]
mod confirmed_gap;

#[path = "stories/gap_parent.rs"]
mod gap_parent;

#[path = "stories/presence_snapshot.rs"]
mod presence_snapshot;

#[path = "stories/gap_push.rs"]
mod gap_push;

#[path = "stories/lost_update.rs"]
mod lost_update;

#[path = "stories/presence_replacement.rs"]
mod presence_replacement;

#[path = "stories/idle_presence.rs"]
mod idle_presence;

#[path = "stories/adoption_snapshot.rs"]
mod adoption_snapshot;

#[path = "stories/idle_orphans.rs"]
mod idle_orphans;

#[path = "stories/account_drain.rs"]
mod account_drain;

#[path = "stories/editor_basic.rs"]
mod editor_basic;
