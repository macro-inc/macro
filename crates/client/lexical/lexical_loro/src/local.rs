use super::*;
use crate::index::Slot;
use lexical_model::Mutation;
use loro::{ExportMode, LoroMovableList};
/// Same predecessor/binary-search tie breaking as loro-mirror's LIS.
pub(crate) fn lis(sequence: &[usize]) -> OrderedSet<usize> {
    let mut predecessor = vec![None; sequence.len()];
    let mut tails: Vec<usize> = Vec::new();
    for (i, x) in sequence.iter().enumerate() {
        let mut low = 0;
        let mut high = tails.len();
        while low < high {
            let mid = (low + high) / 2;
            if tails
                .get(mid)
                .and_then(|j| sequence.get(*j))
                .is_some_and(|v| v < x)
            {
                low = mid + 1
            } else {
                high = mid
            }
        }
        if low > 0 {
            predecessor[i] = tails.get(low - 1).copied();
        }
        if low == tails.len() {
            tails.push(i)
        } else if let Some(tail) = tails.get_mut(low) {
            *tail = i;
        }
    }
    let mut result = OrderedSet::default();
    let mut next = tails.last().copied();
    while let Some(i) = next {
        result.insert(i);
        next = predecessor.get(i).copied().flatten();
    }
    result
}
impl LoroProjection {
    /// Project a complete output's commit/follow-up chain as one explicit Loro commit.
    pub fn local_commit(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        origin: &'static str,
        now: loro::Timestamp,
    ) -> Result<LocalProjected> {
        self.local_commit_impl(doc, commits, origin, now, false)
    }
    /// Project a known local output without duplicating its changes as Loro events.
    /// The owner must manually checkpoint undo when events_suppressed is true;
    /// imports, history and callers with other local observers use local_commit.
    pub fn local_commit_without_events(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        now: loro::Timestamp,
    ) -> Result<LocalProjected> {
        self.local_commit_impl(doc, commits, LOCAL_ORIGIN, now, true)
    }
    fn local_commit_impl(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        origin: &'static str,
        now: loro::Timestamp,
        suppress_events: bool,
    ) -> Result<LocalProjected> {
        // Move capacities out before any model hook can reenter an export.
        let mut exports = std::mem::take(&mut self.own_exports);
        let result =
            self.project_local_commit(doc, commits, origin, now, suppress_events, &mut exports);
        self.own_exports = exports;
        if result.is_err() {
            // Partial projection writes cannot leave reusable insertion anchors.
            self.child_index = crate::child_index::ChildIndex::default();
        }
        result
    }
    fn project_local_commit(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        origin: &'static str,
        now: loro::Timestamp,
        suppress_events: bool,
        exports: &mut (JsonExportBuffer, JsonExportBuffer),
    ) -> Result<LocalProjected> {
        if !matches!(origin, LOCAL_ORIGIN | FIXUP_ORIGIN) {
            return Err(diverged("unsupported projection origin"));
        }
        let mut all = Vec::new();
        let mut seen = OrderedSet::default();
        for commit in commits {
            for entry in commit.chain() {
                if seen.insert(entry.id) {
                    all.push(entry)
                }
            }
        }
        let (Some(first), Some(last)) = (all.first(), all.last()) else {
            return Ok(LocalProjected::default());
        };
        let prev = first.prev.view();
        let next = last.next.view();
        let mut candidates = OrderedMap::default();
        for commit in &all {
            for (key, mutation) in &commit.changes.mutations {
                candidates.insert(*key, *mutation);
            }
        }
        let mut dirty = OrderedMap::default();
        let mut structure = OrderedSet::default();
        for (&key, &mutation) in &candidates {
            let links_changed = prev.parent(key) != next.parent(key)
                || prev.prev_sibling(key) != next.prev_sibling(key)
                || prev.next_sibling(key) != next.next_sibling(key);
            let visibility_changed = prev.contains(key)
                && next.contains(key)
                && (self.policy.is_dropped(prev, key) != self.policy.is_dropped(next, key)
                    || self.policy.is_transparent(prev, key)
                        != self.policy.is_transparent(next, key));
            if links_changed || visibility_changed {
                for (view, parent) in [(prev, prev.parent(key)), (next, next.parent(key))] {
                    if let Some(parent) = parent
                        && let Some(owner) = synced_owner(view, parent, self.policy)
                        && next.is_attached(owner)
                    {
                        structure.insert(owner);
                        dirty.insert(owner, Mutation::Updated);
                    }
                }
            }
            if next.is_element(key)
                && (prev.first_child(key) != next.first_child(key)
                    || prev.last_child(key) != next.last_child(key)
                    || prev.children_size(key) != next.children_size(key))
            {
                structure.insert(key);
            }
            if !next.is_attached(key) {
                continue;
            }
            if let Some(owner) = synced_owner(next, key, self.policy) {
                if owner != key {
                    structure.insert(owner);
                }
                dirty.insert(
                    owner,
                    if owner == key {
                        mutation
                    } else {
                        Mutation::Updated
                    },
                );
            }
        }
        // A disappearing transparent wrapper can still change its surviving synced parent's list.
        for commit in &all {
            for (key, mutation) in &commit.changes.mutations {
                if *mutation == Mutation::Destroyed {
                    let mut parent = commit.prev.view().parent(*key);
                    while let Some(p) = parent {
                        if next.is_attached(p) {
                            if let Some(owner) = synced_owner(next, p, self.policy) {
                                dirty.insert(owner, Mutation::Updated);
                                structure.insert(owner);
                            }
                            break;
                        }
                        parent = commit.prev.view().parent(p);
                    }
                }
            }
        }
        // Element exports can derive fields from descendants (textStyle and
        // textFormat). Visit their own JSON without materializing child lists.
        let changed_keys = dirty.keys().copied().collect::<Vec<_>>();
        for key in changed_keys {
            for parent in next.ancestors(key) {
                if synced_owner(next, parent, self.policy) == Some(parent)
                    && !self.policy.is_transparent(next, parent)
                {
                    dirty.entry(parent).or_insert(Mutation::Updated);
                }
            }
        }
        let mut search_text = if origin == LOCAL_ORIGIN && !candidates.is_empty() {
            self.search_text
                .as_ref()
                .map(|search| {
                    let source_roots = candidates.keys().copied().flat_map(|key| {
                        [prev, next].into_iter().filter_map(move |view| {
                            if !view.contains(key) {
                                return None;
                            }
                            std::iter::once(key)
                                .chain(view.ancestors(key))
                                .find(|&owner| view.parent(owner) == Some(NodeKey::ROOT))
                        })
                    });
                    search.prepare(
                        next,
                        self.policy,
                        source_roots,
                        structure.contains(&NodeKey::ROOT),
                    )
                })
                .transpose()?
        } else {
            None
        };
        if let Some(draft) = &search_text {
            for key in draft.keys().filter(|key| next.is_attached(*key)) {
                dirty.entry(key).or_insert(Mutation::Updated);
            }
        }
        let structures_changed = !structure.is_empty();
        let before_vv = doc.oplog_vv();
        let mut stats = ProjectionStats::default();
        let mut handled = OrderedSet::default();
        let mut written = OrderedSet::default();
        // Parents are processed before descendants even if mutation publication order differs.
        let mut structural = structure
            .into_iter()
            .filter(|key| next.is_element(*key))
            .collect::<Vec<_>>();
        structural.sort_by_key(|key| next.ancestors(*key).count());
        // Indexed anchors are valid only against the exact model/native pair
        // which produced them. External commits (including own-field visibility
        // changes) and uncommitted native writes invalidate them before use.
        let anchors_valid = origin == LOCAL_ORIGIN
            && self.indexed_state.same_snapshot(&first.prev)
            && self.indexed_vv == before_vv
            && self.indexed_frontiers == doc.state_frontiers()
            && !doc.is_detached()
            && doc.inner().get_pending_txn_len() == 0;
        if !anchors_valid {
            self.child_index = crate::child_index::ChildIndex::default();
        }
        let mut insertions = OrderedMap::default();
        if anchors_valid && !structural.is_empty() {
            let mut changed_children: FxHashMap<NodeKey, Vec<NodeKey>> = FxHashMap::default();
            for key in candidates.keys().copied() {
                if let Some(parent) = prev.parent(key) {
                    changed_children.entry(parent).or_default().push(key);
                }
                if let Some(parent) = next.parent(key)
                    && Some(parent) != prev.parent(key)
                {
                    changed_children.entry(parent).or_default().push(key);
                }
            }
            for key in &structural {
                if !self.index.nodes.contains_key(key) {
                    continue;
                }
                let map = self.index.map(doc, *key)?;
                if let Some(list) = schema::children(&map)?
                    && let Some(plan) = self.child_index.plan(
                        doc,
                        [prev, next],
                        *key,
                        changed_children
                            .get(key)
                            .map(Vec::as_slice)
                            .unwrap_or_default(),
                        &list,
                        self.policy,
                    )?
                {
                    insertions.insert(*key, (list, plan));
                }
            }
        }
        // Creating a new ancestor can rebind an existing descendant before its
        // old parent is reconciled. Remember only affected parents' current
        // children so those old containers stay owned until their removal.
        let mut previous_owners = FxHashMap::default();
        for key in &structural {
            if !insertions.contains_key(key) && self.index.nodes.contains_key(key) {
                let map = self.index.map(doc, *key)?;
                for child in projected_children(&map, self.policy)? {
                    if let Some((key, Slot::Node)) = self.index.owner.get(&child.id()) {
                        previous_owners.insert(child.id(), *key);
                    }
                }
            }
        }
        let mut reconciled = Vec::new();
        for key in structural {
            if handled.contains(&key) || !self.index.nodes.contains_key(&key) {
                continue;
            }
            stats.nodes_visited += 1;
            if let Some((list, plan)) = insertions.swap_remove(&key) {
                let mut offset = 0;
                for run in plan {
                    for (rank, child) in run.keys.iter().copied().enumerate() {
                        let position = run.position + offset + rank;
                        let map = list.insert_container(position, LoroMap::new())?;
                        schema::initialize_map(
                            &map,
                            &self.new_storage_node(next, child, search_text.as_mut())?,
                            schema::MapSchema::Node,
                        )?;
                        self.index.bind_tree(next, child, &map, self.policy)?;
                        self.child_index
                            .insert_anchor(key, child, &list, position, map.id())?;
                        handled.insert(child);
                        for (descendant, _) in next.descendants(child) {
                            handled.insert(descendant);
                        }
                        stats.children_scanned += 1;
                        stats.containers_written += 1;
                        stats.nodes_visited += 1 + next.descendants(child).count();
                    }
                    offset += run.keys.len();
                }
                self.child_index.inserted(key, offset);
                written.insert(key);
                self.index
                    .bind(key, &self.index.map(doc, key)?, self.policy)?;
                continue;
            }
            // Complex transforms may rebind descendants across parents. Discard
            // their anchors and rebuild only the reconciled lists after writes.
            self.child_index = crate::child_index::ChildIndex::default();
            reconciled.push(key);
            let a = if prev.contains(key) {
                synced_children(prev, key, self.policy)
            } else {
                Vec::new()
            };
            let b = synced_children(next, key, self.policy);
            stats.children_scanned += a.len() + b.len();
            // Compare against Loro too for remote transform write-back; prev may describe remote pre-apply state.
            if a != b || origin == FIXUP_ORIGIN {
                let map = self.index.map(doc, key)?;
                let list = match schema::children(&map)? {
                    Some(list) => list,
                    None => {
                        stats.containers_written += 1;
                        written.insert(key);
                        map.insert_container("children", LoroMovableList::new())?
                    }
                };
                let current = projected_children(&map, self.policy)?
                    .iter()
                    .map(|map| self.index.owner.get(&map.id()).map(|(key, _)| *key))
                    .collect::<Option<Vec<_>>>();
                if current.as_deref() != Some(b.as_slice())
                    && self.diff_children(
                        next,
                        &list,
                        &b,
                        &previous_owners,
                        &mut handled,
                        (&mut stats, search_text.as_mut()),
                    )?
                {
                    written.insert(key);
                }
                self.index.bind(key, &map, self.policy)?;
            }
        }
        for (key, mutation) in dirty {
            if handled.contains(&key)
                || !self.index.nodes.contains_key(&key)
                || mutation == Mutation::Destroyed
            {
                continue;
            }
            stats.nodes_visited += 1;
            let map = self.index.map(doc, key)?;
            if prev.contains(key) {
                exports.0 = policy::storage_own_reusing(
                    prev,
                    key,
                    self.policy,
                    std::mem::take(&mut exports.0),
                )?;
            } else {
                exports.0 = JsonExportBuffer::default();
            }
            if origin == FIXUP_ORIGIN
                && let Some(text) = map.get("text")
            {
                exports
                    .0
                    .json_mut()
                    .insert("text".into(), schema::read_value(&text)?);
            }
            exports.1 = policy::storage_own_reusing(
                next,
                key,
                self.policy,
                std::mem::take(&mut exports.1),
            )?;
            if let Some(search) = &self.search_text {
                search.apply_expected(key, &self.index, exports.0.json_mut());
                let applied = match &mut search_text {
                    Some(draft) => draft.apply(key, exports.1.json_mut())?,
                    None => false,
                };
                if !applied {
                    search.apply_expected(key, &self.index, exports.1.json_mut());
                }
            }
            let before = exports.0.json();
            let new = exports.1.json();
            if origin == FIXUP_ORIGIN {
                let mut current = schema::own_map(&map, self.policy)?;
                mask_local_state(&mut current, self.policy);
                if schema::owned_equal(
                    &serde_json::Value::Object(current),
                    Some(&serde_json::Value::Object(before.clone())),
                    &serde_json::Value::Object(new.clone()),
                ) {
                    continue;
                }
            } else if before == new {
                continue;
            }
            let old_type = map
                .get("type")
                .as_ref()
                .map(schema::read_value)
                .transpose()?;
            if old_type != new.get("type").cloned() {
                return Err(diverged(format!("type changed in place at {key}")));
            }
            let count = stats.containers_written;
            schema::diff_map(&map, before, new, schema::MapSchema::Node, &mut stats)?;
            if count != stats.containers_written {
                written.insert(key);
            }
            self.index.bind(key, &map, self.policy)?;
        }
        // Containerize only ancestors whose cached flag says a plain composite remains.
        let mut visited = OrderedSet::default();
        for key in written {
            let mut current = Some(key);
            while let Some(key) = current {
                if !visited.insert(key) {
                    break;
                }
                current = next.parent(key);
                if synced_owner(next, key, self.policy) != Some(key) {
                    continue;
                }
                if self
                    .index
                    .nodes
                    .get(&key)
                    .is_some_and(|s| s.plain_composite)
                {
                    stats.nodes_visited += 1;
                    let map = self.index.map(doc, key)?;
                    let mut own = schema::own_map(&map, self.policy)?;
                    mask_local(&mut own, self.policy);
                    schema::diff_map(&map, &own, &own, schema::MapSchema::Node, &mut stats)?;
                    self.index.bind(key, &map, self.policy)?;
                }
            }
        }
        for key in reconciled {
            if self.index.nodes.contains_key(&key) {
                self.child_index.remember(
                    next,
                    key,
                    &self.index.map(doc, key)?,
                    &self.index,
                    self.policy,
                )?;
            }
        }
        // Defer suppression until the infallible commit boundary: fallible
        // projection writes retain their normal events and recovery behavior.
        let events_suppressed =
            suppress_events && doc.with_state(|state| state.suspend_recording_for_local_commit());
        let recording = LocalEventRecording {
            doc,
            suspended: events_suppressed,
        };
        doc.commit_with(loro::CommitOptions::new().origin(origin).timestamp(now));
        drop(recording);
        if let Some(search) = &mut self.search_text {
            if let Some(draft) = search_text {
                search.seal(draft, &self.index);
            } else if origin == FIXUP_ORIGIN && !candidates.is_empty() {
                search.invalidate_roots();
            }
            if structures_changed {
                search.retire_unbound(&self.index);
            }
        }
        self.indexed_state = last.next.clone();
        let after_vv = doc.oplog_vv();
        let changed = before_vv != after_vv;
        self.indexed_vv = after_vv;
        self.indexed_frontiers = doc.state_frontiers();
        tracing::debug!(
            nodes_visited = stats.nodes_visited,
            containers_written = stats.containers_written,
            changed,
            "projection complete"
        );
        Ok(LocalProjected {
            changed,
            events_suppressed,
            stats,
        })
    }
    fn new_storage_node(
        &self,
        view: StateRef<'_>,
        key: NodeKey,
        search_text: Option<&mut crate::search_text::Draft>,
    ) -> Result<SerializedNode> {
        let mut json = storage_node(view, key, self.policy)?;
        if let Some(draft) = search_text {
            draft.apply(key, &mut json)?;
        }
        Ok(json)
    }

    fn diff_children(
        &mut self,
        view: StateRef<'_>,
        list: &LoroMovableList,
        new: &[NodeKey],
        previous_owners: &FxHashMap<ContainerID, NodeKey>,
        handled: &mut OrderedSet<NodeKey>,
        (stats, mut search_text): (&mut ProjectionStats, Option<&mut crate::search_text::Draft>),
    ) -> Result<bool> {
        let mut normalized = false;
        for i in (0..list.len()).rev() {
            let map = schema::map_at(list.get(i), "children item")?;
            if self
                .policy
                .is_transparent_json(&schema::own_map(&map, self.policy)?)
                && projected_children(&map, self.policy)?
                    .iter()
                    .any(|child| self.index.owner.contains_key(&child.id()))
            {
                // A persisted transparent wrapper containing adopted nodes is
                // part of the synced view, not a genuinely foreign child.
                list.delete(i, 1)?;
                self.unbind_removed(&map)?;
                normalized = true;
                stats.containers_written += 1;
            }
        }
        let mut old = Vec::new();
        for i in 0..list.len() {
            let map = schema::map_at(list.get(i), "children item")?;
            old.push(
                self.index
                    .owner
                    .get(&map.id())
                    .map(|(k, _)| *k)
                    .or_else(|| previous_owners.get(&map.id()).copied()),
            );
        }
        stats.children_scanned += old.len();
        let positions = old
            .iter()
            .enumerate()
            .filter_map(|(i, key)| key.map(|key| (key, i)))
            .collect::<FxHashMap<_, _>>();
        let wanted = new.iter().copied().collect::<OrderedSet<_>>();
        let original = old.clone();
        let mut live = old.clone();
        for i in (0..live.len()).rev() {
            if live
                .get(i)
                .copied()
                .flatten()
                .is_some_and(|k| !wanted.contains(&k))
            {
                let removed = schema::map_at(list.get(i), "removed child")?;
                list.delete(i, 1)?;
                self.unbind_removed(&removed)?;
                live.remove(i);
                stats.containers_written += 1;
            }
        }
        let common = new
            .iter()
            .copied()
            .filter(|k| positions.contains_key(k))
            .collect::<Vec<_>>();
        let sequence = common
            .iter()
            .map(|k| {
                positions
                    .get(k)
                    .copied()
                    .ok_or_else(|| diverged("common child vanished"))
            })
            .collect::<Result<Vec<_>>>()?;
        let keep = lis(&sequence);
        for (rank, key) in common.iter().enumerate() {
            if keep.contains(&rank) {
                continue;
            }
            let from = live
                .iter()
                .position(|v| v == &Some(*key))
                .ok_or_else(|| diverged("moving child vanished"))?;
            live.remove(from);
            let to = if rank == 0 {
                0
            } else {
                let previous = common
                    .get(rank - 1)
                    .ok_or_else(|| diverged("missing move predecessor"))?;
                live.iter()
                    .position(|v| v == &Some(*previous))
                    .ok_or_else(|| diverged("move predecessor vanished"))?
                    + 1
            };
            live.insert(to, Some(*key));
            if from != to {
                list.mov(from, to)?;
                stats.containers_written += 1;
            }
        }
        for (i, key) in new.iter().enumerate() {
            if positions.contains_key(key) {
                continue;
            }
            let map = list.insert_container(i, loro::LoroMap::new())?;
            let json = self.new_storage_node(view, *key, search_text.as_deref_mut())?;
            schema::initialize_map(&map, &json, schema::MapSchema::Node)?;
            self.index.bind_tree(view, *key, &map, self.policy)?;
            handled.insert(*key);
            stats.nodes_visited += 1;
            for (child, _) in view.descendants(*key) {
                handled.insert(child);
                stats.nodes_visited += 1;
            }
            stats.containers_written += 1;
            live.insert(i, Some(*key));
        }
        // Rebind surviving positions only if necessary; cross-parent moves already replaced their own entries.
        Ok(normalized || original != live)
    }
    fn unbind_removed(&mut self, map: &LoroMap) -> Result<()> {
        if let Some((key, _)) = self.index.owner.get(&map.id()).copied()
            && self.container_of(key) == Some(&map.id())
        {
            self.index.unbind(key);
        }
        for child in projected_children(map, self.policy)? {
            self.unbind_removed(&child)?;
        }
        Ok(())
    }
    /// Project and export just the newly appended operations for the caller's transport.
    pub fn local(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        now: loro::Timestamp,
    ) -> Result<Option<Vec<u8>>> {
        let before = doc.oplog_vv();
        if self.local_commit(doc, commits, LOCAL_ORIGIN, now)?.changed {
            Ok(Some(doc.export(ExportMode::updates(&before))?))
        } else {
            Ok(None)
        }
    }
}

struct LocalEventRecording<'a> {
    doc: &'a LoroDoc,
    suspended: bool,
}
impl Drop for LocalEventRecording<'_> {
    fn drop(&mut self) {
        if self.suspended {
            self.doc.with_state(|state| state.start_recording());
        }
    }
}
