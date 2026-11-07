use super::*;
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
    #[tracing::instrument(name = "doc.projection.local", skip_all, err)]
    pub fn local_commit(
        &mut self,
        doc: &LoroDoc,
        commits: &[Commit],
        origin: &'static str,
        now: loro::Timestamp,
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
        for (key, mutation) in candidates {
            if !next.is_attached(key) {
                continue;
            }
            if let Some(owner) = synced_owner(next, key, self.policy) {
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
                            }
                            break;
                        }
                        parent = commit.prev.view().parent(p);
                    }
                }
            }
        }
        let before_vv = doc.oplog_vv();
        let mut stats = ProjectionStats::default();
        let mut handled = OrderedSet::default();
        let mut written = OrderedSet::default();
        // Parents are processed before descendants even if mutation publication order differs.
        let mut structural = dirty
            .keys()
            .copied()
            .filter(|k| next.is_element(*k))
            .collect::<Vec<_>>();
        structural.sort_by_key(|key| next.ancestors(*key).count());
        for key in structural {
            if handled.contains(&key) || !self.index.nodes.contains_key(&key) {
                continue;
            }
            stats.nodes_visited += 1;
            let a = if prev.contains(key) {
                synced_children(prev, key, self.policy)
            } else {
                Vec::new()
            };
            let b = synced_children(next, key, self.policy);
            // Compare against Loro too for remote transform write-back; prev may describe remote pre-apply state.
            if a != b || origin == FIXUP_ORIGIN {
                let map = self.index.map(doc, key)?;
                let list = match schema::children(&map)? {
                    Some(list) => list,
                    None => {
                        stats.containers_written += 1;
                        map.insert_container("children", LoroMovableList::new())?
                    }
                };
                if self.diff_children(doc, next, &list, &b, &mut handled, &mut stats)? {
                    written.insert(key);
                }
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
            let before = if origin == FIXUP_ORIGIN {
                let mut json = schema::own_map(&map)?;
                mask_local(&mut json, self.policy);
                json
            } else if prev.contains(key) {
                own(prev, key, self.policy)?
            } else {
                SerializedNode::new()
            };
            let new = own(next, key, self.policy)?;
            let old_type = map
                .get("type")
                .as_ref()
                .map(schema::read_value)
                .transpose()?;
            if old_type != new.get("type").cloned() {
                return Err(diverged(format!("type changed in place at {key}")));
            }
            let count = stats.containers_written;
            schema::diff_map(&map, &before, &new, schema::MapSchema::Node, &mut stats)?;
            if count != stats.containers_written {
                written.insert(key);
            }
            self.index.bind(key, &map)?;
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
                    let mut own = schema::own_map(&map)?;
                    mask_local(&mut own, self.policy);
                    schema::diff_map(&map, &own, &own, schema::MapSchema::Node, &mut stats)?;
                    self.index.bind(key, &map)?;
                }
            }
        }
        doc.commit_with(loro::CommitOptions::new().origin(origin).timestamp(now));
        let changed = before_vv != doc.oplog_vv();
        tracing::debug!(
            nodes_visited = stats.nodes_visited,
            containers_written = stats.containers_written,
            changed,
            "projection complete"
        );
        Ok(LocalProjected { changed, stats })
    }
    fn diff_children(
        &mut self,
        doc: &LoroDoc,
        view: StateRef<'_>,
        list: &LoroMovableList,
        new: &[NodeKey],
        handled: &mut OrderedSet<NodeKey>,
        stats: &mut ProjectionStats,
    ) -> Result<bool> {
        let mut old = Vec::new();
        for i in 0..list.len() {
            let map = schema::map_at(list.get(i), "children item")?;
            old.push(self.index.owner.get(&map.id()).map(|(k, _)| *k));
        }
        let original = old.clone();
        let mut live = old.clone();
        for i in (0..live.len()).rev() {
            if live
                .get(i)
                .copied()
                .flatten()
                .is_some_and(|k| !new.contains(&k))
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
            .filter(|k| old.contains(&Some(*k)))
            .collect::<Vec<_>>();
        let sequence = common
            .iter()
            .map(|k| {
                old.iter()
                    .position(|v| v == &Some(*k))
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
            if old.contains(&Some(*key)) {
                continue;
            }
            let map = list.insert_container(i, loro::LoroMap::new())?;
            let json = synced_node(view, *key, self.policy)?;
            schema::initialize_map(&map, &json, schema::MapSchema::Node)?;
            self.index.bind_tree(doc, view, *key, &map, self.policy)?;
            handled.insert(*key);
            for (child, _) in view.descendants(*key) {
                handled.insert(child);
            }
            stats.containers_written += 1;
            stats.nodes_visited += 1 + view.descendants(*key).count();
            live.insert(i, Some(*key));
        }
        // Rebind surviving positions only if necessary; cross-parent moves already replaced their own entries.
        Ok(original != live)
    }
    fn unbind_removed(&mut self, map: &LoroMap) -> Result<()> {
        if let Some((key, _)) = self.index.owner.get(&map.id()).copied() {
            if self.container_of(key) == Some(&map.id()) {
                self.index.unbind(key);
            }
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
