//! Development-only restoration of recorder states with explicit allocation keys.
use crate::*;
use std::{collections::HashMap, sync::Arc};

impl Editor {
    /// Restore a recorded seed without running transforms or publishing a commit.
    /// Requires a fresh editor, a complete preorder layout and the next allocation key.
    pub fn restore_conformance_state(
        &mut self,
        json: &SerializedEditorState,
        layout: &[NodeKey],
        next: NodeKey,
        selection: Option<Selection>,
    ) -> Result<(), Error> {
        let invalid = || Error::Invariant("invalid conformance key layout");
        if !self.keys.is_fresh()
            || !self.state.is_empty_state()
            || layout.first() != Some(&NodeKey::ROOT)
            || layout
                .iter()
                .any(|key| key.generation() != 0 || *key >= next)
            || next.generation() != 0
        {
            return Err(invalid());
        }
        let unique: std::collections::HashSet<_> = layout.iter().collect();
        if unique.len() != layout.len() {
            return Err(invalid());
        }
        let mut state = self.parse_editor_state(json)?;
        let mut preorder = Vec::new();
        let mut stack = vec![NodeKey::ROOT];
        while let Some(key) = stack.pop() {
            preorder.push(key);
            let children: Vec<_> = state.view().children(key).collect();
            stack.extend(children.into_iter().rev());
        }
        if preorder.len() != layout.len() || state.node_count() != layout.len() {
            return Err(invalid());
        }
        let mapping: HashMap<_, _> = preorder.into_iter().zip(layout.iter().copied()).collect();
        let remap = |key: Option<NodeKey>| {
            key.map(|key| mapping.get(&key).copied().ok_or_else(invalid))
                .transpose()
        };
        let mut nodes = crate::state::NodeMap::default();
        for (key, slot) in &state.nodes {
            let mut slot = slot.as_ref().clone();
            slot.key = *mapping.get(key).ok_or_else(invalid)?;
            slot.links.parent = remap(slot.links.parent)?;
            slot.links.prev = remap(slot.links.prev)?;
            slot.links.next = remap(slot.links.next)?;
            if let BaseData::Element(element) = &mut slot.base {
                element.first = remap(element.first)?;
                element.last = remap(element.last)?;
            }
            nodes.insert(slot.key, Arc::new(slot));
        }
        state.nodes = nodes;
        state.max_key = layout.iter().copied().max().ok_or_else(invalid)?;
        if let Some(selection) = &selection {
            let view = state.view();
            let valid_point = |point: Point| match point {
                Point::Text { key, offset } => {
                    view.kind(key) == Some(NodeKind::Text)
                        && usize::try_from(offset.0).is_ok_and(|offset| {
                            offset <= view.text_content(key).encode_utf16().count()
                        })
                }
                Point::Element { key, offset } => {
                    view.kind(key) == Some(NodeKind::Element)
                        && usize::try_from(offset.0)
                            .is_ok_and(|offset| offset <= view.children(key).count())
                }
            };
            let valid = match selection {
                Selection::Range(range) => valid_point(range.anchor) && valid_point(range.focus),
                Selection::Node(nodes) => nodes.keys().all(|key| view.contains(key)),
                Selection::Table(_) => false,
            };
            if !valid {
                return Err(Error::Invariant("invalid conformance selection"));
            }
        }
        self.keys.raise_to(NodeKey::from_parts(KeyParts {
            generation: 0,
            index: next.index() - 1,
        }));
        self.state = state.with_selection(selection);
        Ok(())
    }
}

#[cfg(test)]
mod test;
