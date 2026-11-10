//! One mounted synchronous view's last transferred decorator observations.
use crate::BoundaryError;
use lexical_model::{DecoratorRenderPolicy, Diff, DiffOp, NodeKey};
use std::collections::BTreeMap;

#[derive(Clone)]
struct Observed {
    policy: DecoratorRenderPolicy,
    revision: u64,
}
pub(crate) struct Observation {
    generation: u32,
    reset: bool,
    changes: BTreeMap<NodeKey, Option<Observed>>,
}
#[derive(Default)]
pub(crate) struct DecoratorObserver {
    generation: Option<u32>,
    exposed: BTreeMap<NodeKey, Observed>,
    pending: Option<Observation>,
}
impl DecoratorObserver {
    /// Prepare a packet without observing any intermediate model publication.
    pub(crate) fn prepare(
        &self,
        diff: &mut Diff,
        remount: bool,
    ) -> Result<Observation, BoundaryError> {
        let reset = remount || self.generation != Some(diff.generation);
        let mut final_policies = BTreeMap::new();
        for change in &diff.decorator_renders {
            if change.key.generation() != diff.generation {
                return Err(BoundaryError::Invalid("decorator observation generation"));
            }
            final_policies.insert(change.key, change.policy.clone());
        }
        let mut changes = BTreeMap::new();
        for (key, policy) in final_policies {
            let Some(policy) = policy else {
                changes.insert(key, None);
                continue;
            };
            let previous = if reset { None } else { self.exposed.get(&key) };
            if previous.is_some_and(|old| {
                std::mem::discriminant(&old.policy) != std::mem::discriminant(&policy)
            }) {
                return Err(BoundaryError::Invalid("decorator render policy changed"));
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
                            revision.checked_add(1).ok_or(BoundaryError::Invalid(
                                "decorator observation revision exhausted",
                            ))?
                        }
                    }
                    None => 0,
                    Some(_) => {
                        return Err(BoundaryError::Invalid("decorator render policy changed"))
                    }
                },
            };
            if previous.is_none_or(|old| old.revision != revision) {
                diff.ops
                    .push(DiffOp::SetDecoratorRevision { key, revision });
            }
            changes.insert(key, Some(Observed { policy, revision }));
        }
        Ok(Observation {
            generation: diff.generation,
            reset,
            changes,
        })
    }
    /// Replace only after the complete packet has encoded successfully.
    pub(crate) fn stage(&mut self, observation: Option<Observation>) {
        self.pending = observation;
    }
    /// Retire a detached view without altering model, sync or queued I/O.
    pub(crate) fn retire(&mut self) {
        self.generation = None;
        self.exposed.clear();
        self.pending = None;
    }
    /// Transfer is an observation only for an attached, synchronous consuming view.
    pub(crate) fn expose(&mut self) {
        if let Some(observation) = self.pending.take() {
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
        }
    }
}

#[cfg(test)]
mod test;
