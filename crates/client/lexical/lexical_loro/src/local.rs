use super::*;
use crate::index::Slot;
use lexical_model::{Mutation, UpdateTag};
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
/// The explicit before/after states and candidate keys of one projection pass.
struct Pass<'a> {
    all: &'a [&'a Commit],
    prev_state: &'a EditorState,
    next_state: &'a EditorState,
    candidates: OrderedMap<NodeKey, Mutation>,
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
    #[cfg(feature = "native-editor")]
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
        // Text splices diff against the editor's previous text, so unprojected changes to
        // projected containers would put them at stale offsets for every peer. Changes
        // elsewhere (unrelated maps, a checkout that leaves projected containers alone)
        // cannot.
        if self
            .events
            .lock()
            .map_err(|_| diverged("event buffer poisoned"))?
            .iter()
            .any(|batch| batch.touches_projection(&self.index))
        {
            return Err(diverged("pending remote events on projected containers"));
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
        let mut candidates = OrderedMap::default();
        for commit in &all {
            for (key, mutation) in &commit.changes.mutations {
                candidates.insert(*key, *mutation);
            }
        }
        let pass = Pass {
            all: &all,
            prev_state: &first.prev,
            next_state: &last.next,
            candidates,
        };
        self.project_states(doc, pass, origin, now, suppress_events, exports)
    }
    /// Write load-time state normalization and opt-in derived root search text in one
    /// local Loro commit, as Source's full-state sync does before its version upgrade.
    /// The supplied state-only commits expose retained root slots to this same pass;
    /// pending stored nulls are also deleted as in any local projection.
    pub fn refresh_root_search_text(
        &mut self,
        doc: &LoroDoc,
        state: &EditorState,
        normalizations: &[Commit],
        now: loro::Timestamp,
    ) -> Result<LocalProjected> {
        if self.search_text.is_none() && normalizations.is_empty() {
            return Ok(LocalProjected::default());
        }
        let candidates = state
            .view()
            .children(NodeKey::ROOT)
            .map(|key| (key, Mutation::Updated))
            .collect::<OrderedMap<_, _>>();
        let mut exports = std::mem::take(&mut self.own_exports);
        let all = normalizations
            .iter()
            .flat_map(Commit::chain)
            .collect::<Vec<_>>();
        let pass = Pass {
            all: &all,
            prev_state: all.first().map_or(state, |commit| &commit.prev),
            next_state: state,
            candidates,
        };
        let result = self.project_states(doc, pass, LOCAL_ORIGIN, now, false, &mut exports);
        self.own_exports = exports;
        if result.is_err() {
            self.child_index = crate::child_index::ChildIndex::default();
        }
        result
    }
    fn project_states(
        &mut self,
        doc: &LoroDoc,
        pass: Pass<'_>,
        origin: &'static str,
        now: loro::Timestamp,
        suppress_events: bool,
        exports: &mut (JsonExportBuffer, JsonExportBuffer),
    ) -> Result<LocalProjected> {
        let Pass {
            all,
            prev_state,
            next_state,
            mut candidates,
        } = pass;
        let prev = prev_state.view();
        let next = next_state.view();
        if origin == LOCAL_ORIGIN {
            for &key in self.stored_drift.iter().chain(self.model_drift.keys()) {
                if next.is_attached(key) {
                    candidates.entry(key).or_insert(Mutation::Updated);
                }
            }
        }
        // Source's whole-state sync writes per-peer local state after the update that set it;
        // a chain made only of such updates is never synced.
        let local_state_only = !all.is_empty()
            && self.policy.local_state_update_tag().is_some_and(|tag| {
                all.iter().all(|commit| {
                    commit
                        .tags
                        .iter()
                        .any(|t| matches!(t, UpdateTag::Custom(custom) if &**custom == tag))
                })
            });
        // Persistence is opt-in: a policy that declares its local-state update tag persists
        // local_state_keys; any other policy keeps them masked and never written.
        let writes_local_state = origin == LOCAL_ORIGIN
            && self.policy.local_state_update_tag().is_some()
            && !local_state_only;
        if writes_local_state {
            for &key in &self.local_state_pending {
                if next.is_attached(key) {
                    candidates.entry(key).or_insert(Mutation::Updated);
                }
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
        for commit in all {
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
        // A superseded retained root slot changes ROOT's stored export without dirtying it.
        if all.iter().any(|commit| commit.stored_state_superseded) {
            dirty.entry(NodeKey::ROOT).or_insert(Mutation::Updated);
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
            && self.indexed_state.same_snapshot(prev_state)
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
                        // Created with writer nulls over model absents: pending.
                        for node in std::iter::once(child)
                            .chain(next.descendants(child).map(|(descendant, _)| descendant))
                        {
                            let own = policy::stored_own(next, node, self.policy)?;
                            if policy::storage_null_keys(next, node, self.policy)
                                .iter()
                                .any(|name| !own.contains_key(*name))
                            {
                                self.pending_nulls.insert(node);
                            }
                        }
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
        let mut visited = OrderedSet::default();
        for (key, mutation) in dirty {
            visited.insert(key);
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
                )?
                .0;
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
            let inserted;
            (exports.1, inserted) = policy::storage_own_reusing(
                next,
                key,
                self.policy,
                std::mem::take(&mut exports.1),
            )?;
            // An existing node whose model field went from a value to absent is
            // DELETED, not nulled, as Source's mirror diff does (probe 8672bafb,
            // existing-node row). A stored null over a model absent stays (U, S,
            // probe 7e0cea51): the previous export carried the same null, so
            // nothing changes.
            for name in &inserted {
                if exports
                    .0
                    .json()
                    .get(name)
                    .is_some_and(|value| !value.is_null())
                {
                    exports.1.json_mut().shift_remove(name);
                }
            }
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
            if origin == LOCAL_ORIGIN && prev.contains(key) {
                // Strip both sides alike so an unchanged node is not rewritten.
                strip_absent_normalized_nulls(prev, key, self.policy, &map, exports.0.json_mut())?;
                strip_absent_normalized_nulls(next, key, self.policy, &map, exports.1.json_mut())?;
                // Source's Mirror writes its export over a value it read from Loro (load,
                // remote, history) at the next local sync: here, Source's import
                // normalization of each drifted field, unless this commit changed it.
                if self.stored_drift.contains(&key) {
                    let parent = self.index.synced_parent_map(doc, next, key, self.policy)?;
                    let model_fields = self.model_drift.get(&key);
                    for drift in stored_drift(&map, parent.as_ref(), self.policy)? {
                        if exports.0.json().get(drift.field) != exports.1.json().get(drift.field)
                            || model_fields.is_some_and(|fields| fields.contains(drift.field))
                        {
                            continue;
                        }
                        match drift.stored {
                            Some(value) => exports.0.json_mut().insert(drift.field.into(), value),
                            None => exports.0.json_mut().remove(drift.field),
                        };
                        match drift.normalized {
                            Some(value) => exports.1.json_mut().insert(drift.field.into(), value),
                            None => exports.1.json_mut().remove(drift.field),
                        };
                    }
                }
                // A remote-update default the stored map lacks: Source's whole-state sync writes
                // the model value here, unless this commit changed that field.
                if let Some(fields) = self.model_drift.get(&key) {
                    for field in fields {
                        if exports.0.json().get(*field) != exports.1.json().get(*field) {
                            continue;
                        }
                        match map.get(field) {
                            Some(stored) => {
                                let stored = schema::read_value(&stored)?;
                                exports.0.json_mut().insert((*field).into(), stored);
                            }
                            None => {
                                exports.0.json_mut().remove(*field);
                            }
                        }
                    }
                }
            }
            // Source writes no fixup for a remote-update default: keep the stored value.
            if origin == FIXUP_ORIGIN
                && let Some(fields) = self.model_drift.get(&key)
            {
                for field in fields {
                    match map.get(field) {
                        Some(stored) => {
                            let stored = schema::read_value(&stored)?;
                            exports.1.json_mut().insert((*field).into(), stored);
                        }
                        None => {
                            exports.1.json_mut().remove(*field);
                        }
                    }
                }
            }
            // A pending node: one write path. The exports here are exactly the pair diff_map
            // would take. When they are equal with the per-peer keys masked, only that state
            // changed: write it alone (diff_map would also insert slot-absent own fields) and
            // leave the exports, the cached buffers, as the unchanged masked export.
            if writes_local_state && self.local_state_pending.contains(&key) {
                let names = self.policy.local_state_keys();
                let mut before = exports.0.json().clone();
                let mut after = exports.1.json().clone();
                for name in names {
                    set_local_state(&mut before, name, None);
                    set_local_state(&mut after, name, None);
                }
                if before == after {
                    let count = stats.containers_written;
                    write_local_state_only(&map, &next.export_json(key)?, names, &mut stats)?;
                    if count != stats.containers_written {
                        #[cfg(feature = "test-faults")]
                        if let Some(remaining) = self.fail_after_writes.as_mut() {
                            if *remaining == 0 {
                                self.fail_after_writes = None;
                                return Err(diverged("injected projection write fault"));
                            }
                            *remaining -= 1;
                        }
                        written.insert(key);
                    }
                    self.index.bind(key, &map, self.policy)?;
                    continue;
                }
                let model = next.export_json(key)?;
                for name in names {
                    set_local_state(exports.0.json_mut(), name, stored_local_state(&map, name)?);
                    set_local_state(exports.1.json_mut(), name, model_local_state(&model, name));
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
            #[cfg(feature = "test-faults")]
            if let Some(remaining) = self.fail_after_writes.as_mut() {
                if *remaining == 0 {
                    self.fail_after_writes = None;
                    return Err(diverged("injected projection write fault"));
                }
                *remaining -= 1;
            }
            if count != stats.containers_written {
                written.insert(key);
            }
            self.index.bind(key, &map, self.policy)?;
            // Still pending while a writer-null key stays absent in the model and
            // null in the store.
            let stored_null = inserted.iter().any(|name| {
                matches!(
                    map.get(name),
                    Some(loro::ValueOrContainer::Value(loro::LoroValue::Null))
                )
            });
            if stored_null {
                self.pending_nulls.insert(key);
            } else {
                self.pending_nulls.shift_remove(&key);
            }
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
        #[cfg(feature = "native-editor")]
        let events_suppressed =
            suppress_events && doc.with_state(|state| state.suspend_recording_for_local_commit());
        // Only local_commit_without_events requests suppression, and it needs the feature.
        #[cfg(not(feature = "native-editor"))]
        let events_suppressed = {
            debug_assert!(!suppress_events);
            false
        };
        let recording = LocalEventRecording {
            doc,
            suspended: events_suppressed,
        };
        doc.commit_with(loro::CommitOptions::new().origin(origin).timestamp(now));
        if origin == LOCAL_ORIGIN {
            self.stored_drift.retain(|key| !visited.contains(key));
            self.model_drift.retain(|key, _| !visited.contains(key));
        }
        self.note_local_state_for(doc, next_state, candidates.keys().copied())?;
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
        self.indexed_state = next_state.clone();
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

/// A stored own field Source's import normalizes, with its stored and normalized values.
pub(crate) struct StoredDrift {
    pub(crate) field: &'static str,
    pub(crate) stored: Option<serde_json::Value>,
    pub(crate) normalized: Option<serde_json::Value>,
}

/// The own fields of `map` that Source's import normalization changes. Only fields the
/// policy declares can drift, so this never rewrites anything else.
pub(crate) fn stored_drift(
    map: &LoroMap,
    parent: Option<&LoroMap>,
    policy: &dyn SyncPolicy,
) -> Result<Vec<StoredDrift>> {
    let mut stored = schema::own_map(map, policy)?;
    mask_local_state(&mut stored, policy);
    let fields = match stored.get("type").and_then(serde_json::Value::as_str) {
        Some(ty) => policy.stored_normalized_fields(ty),
        None => return Ok(Vec::new()),
    };
    if fields.is_empty() {
        return Ok(Vec::new());
    }
    let mut normalized = stored.clone();
    policy::normalize_stored(&mut normalized, policy, || {
        parent
            .map(|parent| {
                let mut json = schema::own_map(parent, policy)?;
                mask_local_state(&mut json, policy);
                Ok(json)
            })
            .transpose()
    })?;
    Ok(fields
        .iter()
        .filter(|field| stored.get(**field) != normalized.get(**field))
        .map(|field| StoredDrift {
            field,
            stored: stored.get(*field).cloned(),
            normalized: normalized.get(*field).cloned(),
        })
        .collect())
}

/// Never re-insert a normalized field as null where Loro lacks it: Source's export leaves
/// it undefined, so only a container's own fresh insert writes that null.
fn strip_absent_normalized_nulls(
    view: StateRef<'_>,
    key: NodeKey,
    policy: &dyn SyncPolicy,
    map: &LoroMap,
    json: &mut SerializedNode,
) -> Result<()> {
    for field in policy.stored_normalized_fields(view.type_name(key)?) {
        if json.get(*field).is_some_and(serde_json::Value::is_null) && map.get(field).is_none() {
            json.remove(*field);
        }
    }
    Ok(())
}

/// A model node's value of the per-peer state `name`.
pub(crate) fn model_local_state(model: &SerializedNode, name: &str) -> Option<serde_json::Value> {
    model.get("$").and_then(|state| state.get(name)).cloned()
}

/// The stored value of the per-peer state `name` in `map`'s `$` container.
pub(crate) fn stored_local_state(map: &LoroMap, name: &str) -> Result<Option<serde_json::Value>> {
    match map.get("$") {
        Some(loro::ValueOrContainer::Container(loro::Container::Map(state))) => {
            state.get(name).as_ref().map(schema::read_value).transpose()
        }
        Some(loro::ValueOrContainer::Value(loro::LoroValue::Map(state))) => state
            .get(name)
            .map(|value| schema::read_value(&loro::ValueOrContainer::Value(value.clone())))
            .transpose(),
        _ => Ok(None),
    }
}

/// Set (or remove) `name` in an export's `$` object.
fn set_local_state(json: &mut SerializedNode, name: &str, value: Option<serde_json::Value>) {
    match value {
        Some(value) => {
            if let serde_json::Value::Object(state) = json
                .entry("$")
                .or_insert_with(|| serde_json::Value::Object(SerializedNode::new()))
            {
                state.insert(name.to_owned(), value);
            }
        }
        None => {
            if let Some(serde_json::Value::Object(state)) = json.get_mut("$") {
                state.remove(name);
                if state.is_empty() {
                    json.remove("$");
                }
            }
        }
    }
}

/// Write only the per-peer state `names` of `map` from the model, through the projection's
/// own `$` writer: schema::diff_map with `$` alone on both sides, which diffs a `$` Map
/// container key by key and gives a plain `$` value map the ordinary containerization.
fn write_local_state_only(
    map: &LoroMap,
    model: &SerializedNode,
    names: &[&str],
    stats: &mut ProjectionStats,
) -> Result<()> {
    let stored = match map.get("$") {
        Some(state) => schema::read_value(&state)?,
        None => serde_json::Value::Object(SerializedNode::new()),
    };
    let mut next = stored.as_object().cloned().unwrap_or_default();
    for name in names {
        match model_local_state(model, name) {
            Some(value) => {
                next.insert((*name).to_owned(), value);
            }
            None => {
                next.remove(*name);
            }
        }
    }
    let next = serde_json::Value::Object(next);
    if next == stored {
        return Ok(());
    }
    let before = SerializedNode::from_iter([("$".to_owned(), stored)]);
    let after = SerializedNode::from_iter([("$".to_owned(), next)]);
    schema::diff_map(map, &before, &after, schema::MapSchema::Node, stats)
}
