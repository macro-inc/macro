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
