//! Capture ownership only: no graph access, record payloads or retirement epochs.
use crate::{compatibility_generated::owned as compat, BoundaryError};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum NativeOwner {
    Update(u32),
    Stage(u64),
}

#[derive(Debug)]
#[cfg_attr(test, derive(Clone, PartialEq))]
struct Entry {
    reference: compat::ForeignRecordRef,
    explicit: u64,
    native: u64,
    graph: bool,
    emission: bool,
}

impl Entry {
    fn prunable(&self) -> bool {
        self.explicit == 0 && self.native == 0 && !self.graph && !self.emission
    }
}

#[derive(Debug)]
#[cfg_attr(test, derive(Clone, PartialEq))]
pub(super) struct CaptureLeases {
    editor: u32,
    entries: BTreeMap<u64, Entry>,
    graphs: BTreeMap<u64, BTreeSet<u64>>,
    owners: BTreeMap<NativeOwner, BTreeSet<u64>>,
    // Inclusive retired ranges prevent ID reuse without retaining payloads or
    // requiring first emission to follow allocation order.
    retired: BTreeMap<u64, u64>,
}

impl CaptureLeases {
    pub fn new(editor: u32) -> Self {
        Self {
            editor,
            entries: BTreeMap::new(),
            graphs: BTreeMap::new(),
            owners: BTreeMap::new(),
            retired: BTreeMap::new(),
        }
    }

    pub fn emit(&mut self, reference: compat::ForeignRecordRef) -> Result<(), BoundaryError> {
        if reference.node.editor_id != self.editor {
            return Err(BoundaryError::Invalid("capture editor"));
        }
        let id = reference.capture_id;
        if id == 0 {
            return Err(BoundaryError::Invalid("capture identity"));
        }
        if let Some(entry) = self.entries.get_mut(&id) {
            if entry.reference != reference {
                return Err(BoundaryError::Invalid("capture authority"));
            }
            if entry.explicit != 0 {
                return Ok(());
            }
            entry.graph = true;
            entry.emission = true;
        } else {
            if self
                .retired
                .range(..=id)
                .next_back()
                .is_some_and(|(_, end)| *end >= id)
            {
                return Err(BoundaryError::Invalid("retired capture identity"));
            }
            self.entries.insert(
                id,
                Entry {
                    reference,
                    explicit: 0,
                    native: 0,
                    graph: true,
                    emission: true,
                },
            );
        }
        self.graphs
            .entry(reference.node.version)
            .or_default()
            .insert(id);
        Ok(())
    }

    /// Validate the entire aggregate before transferring any pin or changing a count.
    pub fn apply(
        &mut self,
        request: &compat::CompatCaptureLeases,
    ) -> Result<Vec<u64>, BoundaryError> {
        let plan = self.plan(request)?;
        for &(id, retain, retained, _) in &plan {
            let entry = self.entries.get_mut(&id).expect("validated capture");
            entry.explicit = retained;
            if retain != 0 {
                entry.graph = false;
                entry.emission = false;
                let version = entry.reference.node.version;
                self.unindex_graph(version, id);
            }
        }
        for &(id, _, _, explicit) in &plan {
            self.entries
                .get_mut(&id)
                .expect("validated capture")
                .explicit = explicit;
        }
        Ok(self.prune(plan.into_iter().map(|(id, _, _, _)| id)))
    }

    /// Preflight without transferring pins, reserving ownership or changing counts.
    pub fn validate(&self, request: &compat::CompatCaptureLeases) -> Result<(), BoundaryError> {
        self.plan(request).map(|_| ())
    }

    fn plan(
        &self,
        request: &compat::CompatCaptureLeases,
    ) -> Result<Vec<(u64, u64, u64, u64)>, BoundaryError> {
        if request.editor_id != self.editor {
            return Err(BoundaryError::Invalid("capture editor"));
        }
        let mut counts = BTreeMap::<u64, (u64, u64)>::new();
        for (ids, retain) in [(&request.retain, true), (&request.release, false)] {
            for &id in ids {
                if !self.entries.contains_key(&id) {
                    return Err(BoundaryError::Invalid("unknown capture identity"));
                }
                let count = counts.entry(id).or_default();
                let value = if retain { &mut count.0 } else { &mut count.1 };
                *value = value
                    .checked_add(1)
                    .ok_or(BoundaryError::Invalid("capture count overflow"))?;
            }
        }
        let mut plan = Vec::with_capacity(counts.len());
        for (id, (retain, release)) in counts {
            let entry = self.entries.get(&id).expect("validated capture");
            let retained = entry
                .explicit
                .checked_add(retain)
                .ok_or(BoundaryError::Invalid("capture count overflow"))?;
            let explicit = retained
                .checked_sub(release)
                .ok_or(BoundaryError::Invalid("capture count underflow"))?;
            plan.push((id, retain, retained, explicit));
        }
        Ok(plan)
    }

    /// A native owner holds each capture at most once, even across repeated calls.
    pub fn hold(&mut self, owner: NativeOwner, ids: &[u64]) -> Result<(), BoundaryError> {
        let ids: BTreeSet<_> = ids.iter().copied().collect();
        let existing = self.owners.get(&owner);
        let mut additions = Vec::new();
        for id in ids {
            let entry = self
                .entries
                .get(&id)
                .ok_or(BoundaryError::Invalid("unknown capture identity"))?;
            if existing.is_some_and(|held| held.contains(&id)) {
                continue;
            }
            let native = entry
                .native
                .checked_add(1)
                .ok_or(BoundaryError::Invalid("capture native count overflow"))?;
            additions.push((id, native));
        }
        for (id, native) in additions {
            self.entries.get_mut(&id).expect("validated capture").native = native;
            self.owners.entry(owner).or_default().insert(id);
        }
        Ok(())
    }

    pub fn release_owner(&mut self, owner: NativeOwner) -> Vec<u64> {
        let ids = self.owners.remove(&owner).unwrap_or_default();
        for id in &ids {
            let entry = self.entries.get_mut(id).expect("native-held capture");
            entry.native = entry.native.checked_sub(1).expect("native owner count");
        }
        self.prune(ids)
    }

    /// A dropped graph does not prove delivery/decoding of an emitted reply.
    pub fn abandon_graph(&mut self, version: u64) -> Vec<u64> {
        self.clear_graph(version, false)
    }

    /// The caller must establish the external JS fence before retiring emission pins.
    pub fn retire_graph(&mut self, version: u64) -> Vec<u64> {
        self.clear_graph(version, true)
    }

    fn clear_graph(&mut self, version: u64, retire: bool) -> Vec<u64> {
        let ids = self.graphs.remove(&version).unwrap_or_default();
        for id in &ids {
            let entry = self.entries.get_mut(id).expect("graph-pinned capture");
            entry.graph = false;
            if retire {
                entry.emission = false;
            }
            if entry.emission {
                self.graphs.entry(version).or_default().insert(*id);
            }
        }
        self.prune(ids)
    }

    fn unindex_graph(&mut self, version: u64, id: u64) {
        if let Some(ids) = self.graphs.get_mut(&version) {
            ids.remove(&id);
            if ids.is_empty() {
                self.graphs.remove(&version);
            }
        }
    }

    fn prune(&mut self, ids: impl IntoIterator<Item = u64>) -> Vec<u64> {
        let mut removed = Vec::new();
        for id in ids {
            if self.entries.get(&id).is_some_and(Entry::prunable) {
                self.entries.remove(&id);
                self.retire_id(id);
                removed.push(id);
            }
        }
        removed
    }

    fn retire_id(&mut self, id: u64) {
        let mut start = id;
        let mut end = id;
        let previous = self
            .retired
            .range(..id)
            .next_back()
            .map(|(&start, &end)| (start, end));
        if let Some((previous, _)) = previous.filter(|(_, end)| end.checked_add(1) == Some(id)) {
            start = previous;
            self.retired.remove(&previous);
        }
        let next = self
            .retired
            .range(id..)
            .next()
            .map(|(&start, &end)| (start, end));
        if let Some((next, last)) = next.filter(|(start, _)| id.checked_add(1) == Some(*start)) {
            end = last;
            self.retired.remove(&next);
        }
        self.retired.insert(start, end);
    }
}

#[cfg(test)]
mod test;
