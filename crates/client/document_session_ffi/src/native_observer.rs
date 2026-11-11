//! Explicit native-view lifetime and acknowledged facts over the shared model observer.
use crate::*;

struct StagedFacts {
    token: u64,
    generation: u32,
    observation: DecoratorObservation,
    removed: Vec<NodeKey>,
}
#[derive(Default, PartialEq, Eq)]
enum ViewPhase {
    #[default]
    Retired,
    PreparingRemount,
    Exposed,
}
#[derive(Default)]
pub(crate) struct NativeDecoratorView {
    lease: u64,
    phase: ViewPhase,
    next_token: u64,
    observer: DecoratorRenderObserver,
    pending: Option<StagedFacts>,
}
impl NativeDecoratorView {
    pub(crate) fn begin(&mut self) -> Result<u64, FfiSessionError> {
        let lease = self
            .lease
            .checked_add(1)
            .ok_or_else(|| invalid("decorator lease exhausted"))?;
        self.observer.retire();
        self.pending = None;
        self.lease = lease;
        // This permits only explicit remount preparation; it does not expose a baseline.
        self.phase = ViewPhase::PreparingRemount;
        Ok(lease)
    }
    pub(crate) fn validate_lease(&self, lease: u64) -> Result<(), FfiSessionError> {
        if self.phase != ViewPhase::Retired && self.lease == lease {
            Ok(())
        } else {
            Err(invalid("decorator view retired"))
        }
    }
    pub(crate) fn retire(&mut self, lease: u64) -> bool {
        if self.phase == ViewPhase::Retired || self.lease != lease {
            return false;
        }
        self.phase = ViewPhase::Retired;
        self.pending = None;
        self.observer.retire();
        true
    }
    // Caller gathers the actual attached facts and final policies under NativeHost's mutex.
    // `policies` also includes removals consumed by this particular projection. No state snapshot.
    pub(crate) fn stage(
        &mut self,
        lease: u64,
        generation: u32,
        nodes: Vec<FfiDecorator>,
        policies: Vec<DecoratorRenderChange>,
        removed: Vec<NodeKey>,
    ) -> Result<FfiDecoratorBatch, FfiSessionError> {
        self.validate_lease(lease)?;
        if self.pending.is_some() {
            return Err(invalid("decorator observation is outstanding"));
        }
        let token = self
            .next_token
            .checked_add(1)
            .ok_or_else(|| invalid("decorator token exhausted"))?;
        let mut diff = lexical_model::Diff {
            generation,
            full_reconcile: false,
            view_text_matches: None,
            ops: Vec::new(),
            decorator_renders: policies,
        };
        let observation = self
            .observer
            .prepare(&mut diff, self.phase == ViewPhase::PreparingRemount)?;
        self.observer.validate(&observation)?;
        let mut revisions = Vec::new();
        let mut reset_revisions = removed.clone();
        for node in &nodes {
            // Complete proposed metadata is needed even after a same-view cold repaint.
            // Merely forwarding changed ops would leave rebuilt projection nodes without revisions.
            match observation.revision(node.key) {
                DecoratorObservationRevision::Revision(revision) => {
                    revisions.push(DiffOp::SetDecoratorRevision {
                        key: node.key,
                        revision,
                    });
                }
                DecoratorObservationRevision::Removed => reset_revisions.push(node.key),
                DecoratorObservationRevision::Unchanged => {
                    return Err(invalid("decorator fact policy missing"));
                }
            }
        }
        self.next_token = token;
        self.pending = Some(StagedFacts {
            token,
            generation,
            observation,
            removed,
        });
        Ok(FfiDecoratorBatch {
            lease,
            token,
            nodes,
            revisions,
            reset_revisions,
        })
    }
    pub(crate) fn finish(
        &mut self,
        lease: u64,
        token: u64,
        current_generation: u32,
        consumed: bool,
    ) -> Result<Vec<NodeKey>, FfiSessionError> {
        self.validate_lease(lease)?;
        let pending = self
            .pending
            .as_ref()
            .ok_or_else(|| invalid("decorator observation missing"))?;
        if pending.token != token {
            return Err(invalid("decorator token changed"));
        }
        if consumed {
            if pending.generation != current_generation {
                return Err(invalid("decorator generation changed"));
            }
            self.observer.validate(&pending.observation)?;
        }
        let pending = self
            .pending
            .take()
            .ok_or_else(|| invalid("decorator observation missing"))?;
        if consumed {
            self.observer.expose(pending.observation)?;
            self.phase = ViewPhase::Exposed;
            Ok(pending.removed)
        } else {
            // Discard changes no baseline; future preparation still compares against actual exposure.
            Ok(Vec::new())
        }
    }
}

/// Current decorator facts proposed for one native consuming view.
#[derive(uniffi::Record)]
pub struct FfiDecoratorBatch {
    /// Exact consuming-view lifetime.
    pub lease: u64,
    /// One outstanding observation; acknowledge or discard before staging another.
    pub token: u64,
    /// Attached model facts in requested order.
    pub nodes: Vec<FfiDecorator>,
    /// Complete proposed native metadata, including unchanged revisions after a cold repaint.
    pub revisions: Vec<DiffOp>,
    /// Removed or opted-out component observations.
    pub reset_revisions: Vec<NodeKey>,
}
#[cfg(test)]
mod test;
