//! Per-consuming-view decorator observations, independent of any transport.
use crate::*;
use std::collections::BTreeMap;
use std::sync::Arc;

#[derive(Clone)]
struct Observed {
    policy: DecoratorRenderPolicy,
    revision: u64,
}
/// Opaque prepared observation; it grants no model publication or mutation authority.
pub struct DecoratorObservation {
    owner: Arc<()>,
    base_epoch: u64,
    next_epoch: u64,
    generation: u32,
    reset: bool,
    changes: BTreeMap<NodeKey, Option<Observed>>,
}
#[derive(Default)]
/// One consuming view's exposed signatures and eager lifetimes, without graph snapshots.
pub struct DecoratorRenderObserver {
    owner: Arc<()>,
    epoch: u64,
    generation: Option<u32>,
    exposed: BTreeMap<NodeKey, Observed>,
}
impl DecoratorRenderObserver {
    /// Prepare a packet without observing any intermediate model publication.
    pub fn prepare(&self, diff: &mut Diff, remount: bool) -> Result<DecoratorObservation, Error> {
        let next_epoch = self
            .epoch
            .checked_add(1)
            .ok_or(Error::Invariant("decorator observation epoch exhausted"))?;
        let reset = remount || self.generation != Some(diff.generation);
        let mut final_policies = BTreeMap::new();
        for change in &diff.decorator_renders {
            if change.key.generation() != diff.generation {
                return Err(Error::Invariant("decorator observation generation"));
            }
            final_policies.insert(change.key, change.policy.clone());
        }
        let mut changes = BTreeMap::new();
        let mut revisions = Vec::new();
        for (key, policy) in final_policies {
            let Some(policy) = policy else {
                changes.insert(key, None);
                continue;
            };
            let previous = if reset { None } else { self.exposed.get(&key) };
            if previous.is_some_and(|old| {
                std::mem::discriminant(&old.policy) != std::mem::discriminant(&policy)
            }) {
                return Err(Error::Invariant("decorator render policy changed"));
            }
            let revision = match &policy {
                DecoratorRenderPolicy::Eager(revision) => *revision,
                DecoratorRenderPolicy::Signature(signature) => match previous {
                    Some(Observed {
                        policy: DecoratorRenderPolicy::Signature(old),
                        revision,
                    }) => {
                        if signature == old {
                            *revision
                        } else {
                            revision.checked_add(1).ok_or(Error::Invariant(
                                "decorator observation revision exhausted",
                            ))?
                        }
                    }
                    None => 0,
                    Some(_) => return Err(Error::Invariant("decorator render policy changed")),
                },
            };
            if previous.is_none_or(|old| old.revision != revision) {
                revisions.push(DiffOp::SetDecoratorRevision { key, revision });
            }
            changes.insert(key, Some(Observed { policy, revision }));
        }
        diff.ops.extend(revisions);
        Ok(DecoratorObservation {
            owner: self.owner.clone(),
            base_epoch: self.epoch,
            next_epoch,
            generation: diff.generation,
            reset,
            changes,
        })
    }
    /// Validate an observation before installation without advancing this view.
    pub fn validate(&self, observation: &DecoratorObservation) -> Result<(), Error> {
        if !Arc::ptr_eq(&self.owner, &observation.owner) {
            return Err(Error::Invariant(
                "decorator observation belongs to another view",
            ));
        }
        if self.epoch != observation.base_epoch {
            return Err(Error::Invariant("stale decorator observation"));
        }
        Ok(())
    }
    /// Acknowledge actual exposure after the owner has consumed the prepared packet.
    /// Asynchronous adapters must serialize or supersede their own outstanding packets.
    pub fn expose(&mut self, observation: DecoratorObservation) -> Result<(), Error> {
        self.validate(&observation)?;
        if observation.reset {
            self.exposed.clear();
        }
        self.generation = Some(observation.generation);
        for (key, value) in observation.changes {
            if let Some(value) = value {
                self.exposed.insert(key, value);
            } else {
                self.exposed.remove(&key);
            }
        }
        self.epoch = observation.next_epoch;
        Ok(())
    }
    /// Last actually exposed revision; this never observes a current model write.
    pub fn exposed_revision(&self, key: NodeKey) -> Option<u64> {
        self.exposed.get(&key).map(|value| value.revision)
    }
    /// Retire a view and invalidate every outstanding observation without model I/O.
    pub fn retire(&mut self) {
        self.owner = Arc::new(());
        self.epoch = 0;
        self.generation = None;
        self.exposed.clear();
    }
}
/// A touched key's proposed observation, distinct from the last exposed value.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecoratorObservationRevision {
    /// This packet does not observe this key.
    Unchanged,
    /// This packet removes the key's observation.
    Removed,
    /// This packet proposes the given revision for a live decorator.
    Revision(u64),
}
impl DecoratorObservation {
    /// Read a candidate value without acknowledging it or advancing the view.
    pub fn revision(&self, key: NodeKey) -> DecoratorObservationRevision {
        match self.changes.get(&key) {
            None => DecoratorObservationRevision::Unchanged,
            Some(None) => DecoratorObservationRevision::Removed,
            Some(Some(value)) => DecoratorObservationRevision::Revision(value.revision),
        }
    }
}
#[cfg(test)]
mod test;
