//! Stable native insertion anchors for unchanged direct siblings.
use super::*;
use loro::{
    LoroMovableList,
    cursor::{Cursor, Side},
};

#[derive(Default)]
pub(crate) struct ChildIndex {
    counts: FxHashMap<NodeKey, usize>,
    anchors: FxHashMap<NodeKey, ChildAnchor>,
}
struct ChildAnchor {
    parent: NodeKey,
    map: ContainerID,
    cursor: Cursor,
}
pub(crate) struct Insertion {
    pub position: usize,
    pub keys: Vec<NodeKey>,
}
impl ChildIndex {
    pub fn remember(
        &mut self,
        view: StateRef<'_>,
        parent: NodeKey,
        map: &LoroMap,
        index: &NodeIndex,
        policy: &dyn SyncPolicy,
    ) -> Result<()> {
        self.counts.remove(&parent);
        let Some(list) = schema::children(map)? else {
            return Ok(());
        };
        if Some(view.children_size(parent)) != u32::try_from(list.len()).ok() {
            return Ok(());
        }
        for (position, key) in view.children(parent).enumerate() {
            if policy.is_dropped(view, key) || policy.is_transparent(view, key) {
                return Ok(());
            }
            let child = schema::map_at(list.get(position), "indexed children item")?;
            if index
                .nodes
                .get(&key)
                .is_none_or(|slots| slots.map != child.id())
            {
                return Ok(());
            }
            self.insert_anchor(parent, key, &list, position, child.id())?;
        }
        self.counts.insert(parent, list.len());
        Ok(())
    }
    pub fn insert_anchor(
        &mut self,
        parent: NodeKey,
        key: NodeKey,
        list: &LoroMovableList,
        position: usize,
        map: ContainerID,
    ) -> Result<()> {
        let cursor = list
            .get_cursor(position, Side::Middle)
            .ok_or_else(|| diverged("missing live child cursor"))?;
        self.anchors.insert(
            key,
            ChildAnchor {
                parent,
                map,
                cursor,
            },
        );
        Ok(())
    }
    pub fn inserted(&mut self, parent: NodeKey, count: usize) {
        if let Some(old) = self.counts.get_mut(&parent) {
            *old += count;
        }
    }
    /// Only fresh insertions into a previously validated, unchanged direct list.
    /// Reordering, visibility changes, foreign children and fixups use reconciliation.
    pub fn plan(
        &self,
        doc: &LoroDoc,
        views: [StateRef<'_>; 2],
        parent: NodeKey,
        changed: &[NodeKey],
        list: &LoroMovableList,
        policy: &dyn SyncPolicy,
    ) -> Result<Option<Vec<Insertion>>> {
        let [prev, next] = views;
        let Some(count) = self.counts.get(&parent).copied() else {
            return Ok(None);
        };
        if u32::try_from(count).ok() != Some(prev.children_size(parent)) || count != list.len() {
            return Ok(None);
        }
        let mut added = FxHashMap::default();
        for key in changed.iter().copied() {
            if prev.parent(key) == Some(parent) && next.parent(key) != Some(parent) {
                return Ok(None);
            }
            if next.parent(key) != Some(parent) {
                continue;
            }
            if policy.is_dropped(next, key) || policy.is_transparent(next, key) {
                return Ok(None);
            }
            if !prev.contains(key) {
                // A new ancestor around an existing node must preserve the old
                // ownership during replacement; leave it to reconciliation.
                if next.descendants(key).any(|(child, _)| prev.contains(child)) {
                    return Ok(None);
                }
                added.insert(key, ());
            } else if policy.is_dropped(prev, key) || policy.is_transparent(prev, key) {
                return Ok(None);
            }
        }
        if added.is_empty()
            || u32::try_from(count + added.len()).ok() != Some(next.children_size(parent))
        {
            return Ok(None);
        }
        // Validate every changed old link against the previous immutable tree.
        // A commit records both sides of a sibling splice, including moves.
        for key in changed
            .iter()
            .copied()
            .filter(|key| prev.parent(*key) == Some(parent))
        {
            let mut left = next.prev_sibling(key);
            while left.is_some_and(|key| added.contains_key(&key)) {
                left = left.and_then(|key| next.prev_sibling(key));
            }
            let mut right = next.next_sibling(key);
            while right.is_some_and(|key| added.contains_key(&key)) {
                right = right.and_then(|key| next.next_sibling(key));
            }
            if left != prev.prev_sibling(key) || right != prev.next_sibling(key) {
                return Ok(None);
            }
        }
        let mut runs = Vec::new();
        for key in added.keys().copied() {
            if next
                .prev_sibling(key)
                .is_some_and(|key| added.contains_key(&key))
            {
                continue;
            }
            let position = if let Some(left) = next.prev_sibling(key) {
                let Some(anchor) = self.anchors.get(&left) else {
                    return Ok(None);
                };
                if anchor.parent != parent {
                    return Ok(None);
                }
                // Resolve before any writes. Deleted-cursor fallback can commit
                // a pending transaction; only live cursors are admitted here.
                let Ok(position) = doc.get_cursor_pos(&anchor.cursor) else {
                    return Ok(None);
                };
                if position.update.is_some()
                    || list
                        .get(position.current.pos)
                        .and_then(|value| schema::map_at(Some(value), "anchor").ok())
                        .is_none_or(|map| map.id() != anchor.map)
                {
                    return Ok(None);
                }
                position.current.pos + 1
            } else {
                0
            };
            let mut keys = Vec::new();
            let mut current = Some(key);
            while let Some(key) = current.filter(|key| added.contains_key(key)) {
                keys.push(key);
                current = next.next_sibling(key);
            }
            runs.push(Insertion { position, keys });
        }
        runs.sort_by_key(|run| run.position);
        if runs.iter().map(|run| run.keys.len()).sum::<usize>() != added.len() {
            return Ok(None);
        }
        Ok(Some(runs))
    }
}

#[cfg(test)]
mod test;
