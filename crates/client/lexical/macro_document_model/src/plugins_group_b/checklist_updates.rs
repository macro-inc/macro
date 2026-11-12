//! One current session-owned presentation baseline, derived only from real commits.
use super::checklist_presentation::SettingsIntent;
use super::{
    checklist_controls::collect_checklist_metadata_for_list, checklist_facts::FactsRevision,
    checklist_plan::plan_checklist,
};
use lexical_model::{Commit, EditorState, Error, KeyParts, NodeKey};
use lexical_rich_nodes::list::{ListNode, ListType};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;
#[cfg(test)]
mod presentation_test;
#[cfg(test)]
mod test;
mod types;
use types::{ListUpdate, Presentation};

/// A native presentation delivery, never a model publication or graph capability.
#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct PlanUpdates(Delivery, #[serde(skip)] Arc<()>);

struct PendingDelivery {
    receipt: PlanUpdates,
    clear: bool,
    changes: Vec<(NodeKey, Option<Presentation>)>,
}

/// A remount draft has no effect until its encoded output is exposed.
pub struct PlanReset {
    producer: ChecklistProducer,
}
impl PlanReset {
    /// The exact full reset to encode beside the actual Initialize effect.
    pub fn deliveries(&self) -> Vec<PlanUpdates> {
        self.producer.pending_deliveries()
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Delivery {
    Cleared {
        generation: u32,
        sequence: String,
    },
    Delta {
        generation: u32,
        #[serde(rename = "factsVersion")]
        facts_version: String,
        sequence: String,
        reset: bool,
        lists: Vec<ListUpdate>,
    },
}

/// An unconfigured producer emits nothing and retains no graph or dirty history.
#[derive(Default)]
pub struct ChecklistProducer {
    facts: Option<FactsRevision>,
    baseline: BTreeMap<NodeKey, Presentation>,
    pending: VecDeque<PendingDelivery>,
    candidates: BTreeSet<NodeKey>,
    recompute_all: bool,
    acknowledge_facts: bool,
    reset: bool,
    clear_pending: bool,
    sequence: u64,
    presentation_overrides: BTreeMap<NodeKey, Arc<Value>>,
    presentation_invalidated: bool,
    #[cfg(test)]
    recomputed: usize,
}
impl ChecklistProducer {
    /// Validate an actual current-generation metadata input before replacing facts.
    pub fn accept(&mut self, revision: &FactsRevision, state: &EditorState) -> Result<(), Error> {
        if revision.generation != state.max_key().generation() {
            return Err(Error::Invariant("checklist facts generation"));
        }
        if let Some(previous) = &self.facts {
            if revision.version < previous.version {
                return Err(Error::Invariant("stale checklist facts revision"));
            }
            if revision.version == previous.version {
                if revision.facts != previous.facts {
                    return Err(Error::Invariant("conflicting checklist facts revision"));
                }
                if revision.rebind && self.pending.is_empty() {
                    self.recompute_all = true;
                    self.acknowledge_facts = true;
                    self.presentation_invalidated = true;
                    self.reset = true;
                }
                return Ok(());
            }
        }
        if !self.pending.is_empty() {
            return Err(Error::Invariant("checklist delivery pending"));
        }
        if self
            .sequence
            .checked_add(1 + u64::from(self.clear_pending))
            .is_none()
        {
            self.invalidate_presentation();
            return Err(Error::Invariant("checklist delivery exhausted"));
        }
        self.reset = self.facts.is_none();
        self.facts = Some(revision.clone());
        self.presentation_invalidated = true;
        self.recompute_all = true;
        self.acknowledge_facts = true;
        Ok(())
    }

    /// Clear only after the owning surface really replaced or unbound its core.
    /// The delivery counter remains monotonic for this actual session instance.
    pub fn clear(&mut self) {
        self.clear_pending |= self.facts.is_some() || !self.baseline.is_empty();
        self.facts = None;
        self.presentation_overrides.clear();
        self.presentation_invalidated = true;
        self.candidates.clear();
        self.recompute_all = false;
        self.acknowledge_facts = false;
        self.reset = false;
    }

    /// An actual access change or accepted remote application revokes old UI intents now.
    /// Final-state planning and sequence allocation remain in the sealed output epilogue.
    pub fn invalidate_presentation(&mut self) {
        self.presentation_overrides.clear();
        self.presentation_invalidated = true;
        if self.facts.is_some() {
            self.recompute_all = true;
            self.acknowledge_facts = true;
        }
    }

    /// Accepted remote application drops a local choice without adding output debt
    /// to ordinary remote updates which have no presentation override.
    pub fn remote_applied(&mut self) {
        if !self.presentation_overrides.is_empty() {
            self.invalidate_presentation();
        }
    }

    /// Validate configuration and target independently of stale-view comparison.
    /// A stale input is processed without ever opening a model transaction.
    pub fn accepts_presentation(
        &mut self,
        intent: &SettingsIntent,
        state: &EditorState,
    ) -> Result<bool, Error> {
        let facts = self
            .facts
            .as_ref()
            .ok_or(Error::Invariant("checklist settings producer unconfigured"))?;
        if facts.generation != state.max_key().generation()
            || intent.generation != state.max_key().generation()
        {
            return Err(Error::Invariant("checklist settings generation"));
        }
        let key = NodeKey::from_parts(KeyParts {
            index: intent.key,
            generation: intent.generation,
        });
        if collect_checklist_metadata_for_list(state, key)?.is_none() {
            return Err(Error::Invariant("checklist settings target"));
        }
        if self.sequence == u64::MAX {
            self.invalidate_presentation();
            return Ok(false);
        }
        Ok(!self.presentation_invalidated && intent.observed_sequence == self.sequence)
    }

    /// Retain only an admitted reader choice. Never write or retain the graph.
    pub fn set_presentation(
        &mut self,
        intent: &SettingsIntent,
        state: &EditorState,
    ) -> Result<(), Error> {
        if !self.accepts_presentation(intent, state)? {
            return Err(Error::Invariant("checklist settings admission changed"));
        }
        let key = NodeKey::from_parts(KeyParts {
            index: intent.key,
            generation: intent.generation,
        });
        self.presentation_overrides
            .insert(key, intent.settings.clone());
        self.candidates.insert(key);
        self.acknowledge_facts = true;
        Ok(())
    }

    fn previous(&self, key: NodeKey) -> Option<&Presentation> {
        for delivery in self.pending.iter().rev() {
            if let Some((_, presentation)) = delivery.changes.iter().find(|(node, _)| *node == key)
            {
                return presentation.as_ref();
            }
            if delivery.clear {
                return None;
            }
        }
        self.baseline.get(&key)
    }

    /// Retained exact deliveries; retrying them never allocates another sequence.
    pub fn pending_deliveries(&self) -> Vec<PlanUpdates> {
        self.pending
            .iter()
            .map(|pending| pending.receipt.clone())
            .collect()
    }

    /// Commit only an exact issued receipt at the head of the pending FIFO.
    /// Unknown, already exposed and out-of-order receipts leave debt unchanged.
    pub fn expose(&mut self, receipt: &PlanUpdates) {
        if !self
            .pending
            .front()
            .is_some_and(|pending| Arc::ptr_eq(&pending.receipt.1, &receipt.1))
        {
            return;
        }
        if let Some(pending) = self.pending.pop_front() {
            if pending.clear {
                self.baseline.clear();
            }
            for (key, presentation) in pending.changes {
                match presentation {
                    Some(presentation) => {
                        self.baseline.insert(key, presentation);
                    }
                    None => {
                        self.baseline.remove(&key);
                    }
                }
            }
        }
    }

    /// Prepare a full reset without changing retained deliveries or the baseline.
    pub fn prepare_reset(&self, state: &EditorState) -> Result<PlanReset, Error> {
        let mut producer = Self {
            facts: self.facts.clone(),
            sequence: self.sequence,
            presentation_overrides: self.presentation_overrides.clone(),
            presentation_invalidated: self.presentation_invalidated,
            recompute_all: self.facts.is_some(),
            acknowledge_facts: self.facts.is_some(),
            reset: self.facts.is_some(),
            clear_pending: self.clear_pending
                || (self.facts.is_none()
                    && (!self.pending.is_empty() || !self.baseline.is_empty())),
            ..Self::default()
        };
        producer.finish(state)?;
        Ok(PlanReset { producer })
    }

    /// Infallible exposure of the full reset after successful encoding/transfer.
    pub fn expose_reset(&mut self, mut draft: PlanReset) {
        for receipt in draft.producer.pending_deliveries() {
            draft.producer.expose(&receipt);
        }
        *self = draft.producer;
    }

    /// Borrow actual accepted commit evidence and retain only affected list keys.
    pub fn observe(&mut self, commits: &[Commit]) {
        if self.facts.is_none() {
            return;
        }
        for commit in commits {
            if commit.full_reconcile {
                self.recompute_all = true;
            }
            for key in commit
                .changes
                .dirty_leaves
                .iter()
                .chain(commit.changes.dirty_elements.keys())
                .chain(commit.changes.mutations.keys())
            {
                for state in [&commit.prev, &commit.next] {
                    let view = state.view();
                    for candidate in std::iter::once(*key).chain(view.ancestors(*key)) {
                        if view.parent(candidate) == Some(NodeKey::ROOT)
                            && view
                                .get::<ListNode>(candidate)
                                .is_some_and(|list| list.list_type() == ListType::Check)
                        {
                            self.candidates.insert(candidate);
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Derive against the final actual state; unchanged presentation emits nothing.
    pub fn finish(&mut self, state: &EditorState) -> Result<Vec<PlanUpdates>, Error> {
        let sequence_before = self.sequence;
        let generation = state.max_key().generation();
        if self
            .facts
            .as_ref()
            .is_some_and(|facts| facts.generation != generation)
        {
            self.clear();
        }
        self.presentation_overrides.retain(|key, _| {
            state.view().parent(*key) == Some(NodeKey::ROOT)
                && state
                    .view()
                    .get::<ListNode>(*key)
                    .is_some_and(|list| list.list_type() == ListType::Check)
        });
        let facts = self.facts.as_ref();
        let mut keys = self.candidates.clone();
        if facts.is_some() && self.recompute_all {
            keys.extend(self.baseline.keys().copied());
            keys.extend(
                self.pending
                    .iter()
                    .flat_map(|pending| pending.changes.iter().map(|(key, _)| *key)),
            );
            keys.extend(state.view().children(NodeKey::ROOT).filter(|key| {
                state
                    .view()
                    .get::<ListNode>(*key)
                    .is_some_and(|list| list.list_type() == ListType::Check)
            }));
        }
        let mut next = Vec::new();
        let mut changes = Vec::new();
        if let Some(facts) = facts {
            // Key sets deduplicate only; emit changed lists in actual root order.
            let order: Vec<_> = if keys.len() <= 1 {
                keys.iter().copied().collect()
            } else {
                state
                    .view()
                    .children(NodeKey::ROOT)
                    .filter(|key| keys.contains(key))
                    .chain(
                        keys.iter()
                            .copied()
                            .filter(|key| state.view().parent(*key) != Some(NodeKey::ROOT)),
                    )
                    .collect()
            };
            for key in order {
                let presentation =
                    collect_checklist_metadata_for_list(state, key)?.map(|mut meta| {
                        if let Some(settings) = self.presentation_overrides.get(&key) {
                            meta.settings = settings.clone();
                        }
                        #[cfg(test)]
                        {
                            self.recomputed += 1;
                        }
                        Presentation::new(
                            &meta,
                            plan_checklist(
                                Some(&meta),
                                &facts.facts.tasks,
                                &facts.facts.names,
                                &facts.facts.calendar,
                            ),
                        )
                    });
                if let Some(presentation) = &presentation {
                    if let Some(change) = types::difference(
                        key,
                        if self.reset || self.clear_pending {
                            None
                        } else {
                            self.previous(key)
                        },
                        presentation,
                    ) {
                        changes.push(change);
                    }
                } else if self.previous(key).is_some() {
                    changes.push(ListUpdate::Remove {
                        list_key: key.into(),
                    });
                }
                next.push((key, presentation));
            }
        }
        let delivery_count = u64::from(self.clear_pending)
            + u64::from(self.facts.is_some() && (self.acknowledge_facts || !changes.is_empty()));
        if self.sequence.checked_add(delivery_count).is_none() {
            self.invalidate_presentation();
            return Err(Error::Invariant("checklist delivery exhausted"));
        }
        if self.clear_pending {
            self.sequence += 1;
            self.pending.push_back(PendingDelivery {
                receipt: PlanUpdates(
                    Delivery::Cleared {
                        generation,
                        sequence: self.sequence.to_string(),
                    },
                    Arc::new(()),
                ),
                clear: true,
                changes: vec![],
            });
        }
        if let Some(facts) = &self.facts
            && (self.acknowledge_facts || !changes.is_empty())
        {
            self.sequence += 1;
            self.pending.push_back(PendingDelivery {
                receipt: PlanUpdates(
                    Delivery::Delta {
                        generation,
                        facts_version: facts.version.to_string(),
                        sequence: self.sequence.to_string(),
                        reset: self.reset,
                        lists: changes,
                    },
                    Arc::new(()),
                ),
                clear: self.reset,
                changes: next,
            });
        }
        if self.sequence > sequence_before {
            self.presentation_invalidated = false;
        }
        self.candidates.clear();
        self.recompute_all = false;
        self.acknowledge_facts = false;
        self.reset = false;
        self.clear_pending = false;
        Ok(self.pending_deliveries())
    }
}
