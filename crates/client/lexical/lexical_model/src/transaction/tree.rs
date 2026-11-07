//! Structural edits; property writes never change links directly.
use crate::node::Links;
use crate::*;
impl Transaction<'_> {
    /// Dispatch the registered `reset_on_copy` hook.
    pub fn reset_on_copy(
        &mut self,
        key: impl Into<NodeKey>,
        original: NodeKey,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).reset_on_copy)(self, key, original)
    }
    /// Dispatch the registered `remove` hook.
    pub fn remove(
        &mut self,
        key: impl Into<NodeKey>,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).remove)(self, key, preserve_empty_parent)
    }
    /// Dispatch the registered `replace` hook.
    pub fn replace(
        &mut self,
        key: impl Into<NodeKey>,
        replacement: impl Into<NodeKey>,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let key = key.into();
        let replacement = replacement.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).replace)(self, key, replacement, include_children)
    }
    /// Dispatch the registered `insert_after` hook.
    pub fn insert_after(
        &mut self,
        key: impl Into<NodeKey>,
        node: impl Into<NodeKey>,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let key = key.into();
        let node = node.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).insert_after)(self, key, node, restore_selection)
    }
    /// Dispatch the registered `insert_before` hook.
    pub fn insert_before(
        &mut self,
        key: impl Into<NodeKey>,
        node: impl Into<NodeKey>,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let key = key.into();
        let node = node.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).insert_before)(self, key, node, restore_selection)
    }
    /// Dispatch the registered `create_parent_element` hook.
    pub fn create_parent_element(&mut self, key: impl Into<NodeKey>) -> Result<NodeKey, Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).create_parent_element)(self, key)
    }
    /// Dispatch the registered `splice` hook.
    pub fn splice(
        &mut self,
        key: impl Into<NodeKey>,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).splice)(self, key, start, delete_count, nodes)
    }
    /// Dispatch the registered `append` hook.
    pub fn append(&mut self, key: impl Into<NodeKey>, nodes: &[NodeKey]) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).append)(self, key, nodes)
    }
    /// Dispatch the registered `set_indent` hook.
    pub fn set_indent(&mut self, key: impl Into<NodeKey>, indent: u32) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).set_indent)(self, key, indent)
    }
    /// Dispatch the registered `insert_new_after` hook.
    pub fn insert_new_after(
        &mut self,
        key: impl Into<NodeKey>,
        selection: SelectionSlot,
        restore_selection: bool,
    ) -> Result<Option<NodeKey>, Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).insert_new_after)(
            self,
            key,
            selection,
            restore_selection,
        )
    }
    /// Dispatch the registered `collapse_at_start` hook.
    pub fn collapse_at_start(
        &mut self,
        key: impl Into<NodeKey>,
        selection: SelectionSlot,
    ) -> Result<bool, Error> {
        self.guard_write()?;
        let key = key.into();
        let index = self.type_index(key).ok_or(Error::NodeNotFound(key))?;
        (self.pending.registry.vtable(index).collapse_at_start)(self, key, selection)
    }
    pub(crate) fn set_indent_base(&mut self, key: NodeKey, indent: u32) -> Result<(), Error> {
        match &mut self.writable(key)?.base {
            BaseData::Element(data) => {
                data.absent.remove(crate::node::AbsentKeys::INDENT);
                data.indent = indent;
                Ok(())
            }
            _ => Err(Error::NotAnElement(key)),
        }
    }
    /// Append through the virtual splice hook.
    pub fn default_append(&mut self, parent: NodeKey, nodes: &[NodeKey]) -> Result<(), Error> {
        self.guard_write()?;
        self.splice(parent, ChildIndex(self.children_size(parent)), 0, nodes)
    }
    /// Unlink without selection relocation or empty-parent cleanup.
    pub fn remove_from_parent(&mut self, key: impl Into<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        let links = self.view().slot(key).ok_or(Error::NodeNotFound(key))?.links;
        let Some(parent) = links.parent else {
            return Ok(());
        };
        if let Some(prev) = links.prev {
            self.writable(prev)?.links.next = links.next;
        }
        if let Some(next) = links.next {
            self.writable(next)?.links.prev = links.prev;
        }
        match &mut self.writable(parent)?.base {
            BaseData::Element(data) => {
                if data.first == Some(key) {
                    data.first = links.next;
                }
                if data.last == Some(key) {
                    data.last = links.prev;
                }
                data.size = data.size.saturating_sub(1);
            }
            _ => return Err(Error::NotAnElement(parent)),
        }
        self.writable(key)?.links = Links::default();
        Ok(())
    }
    /// Base element splice, including moves from another parent or within the same parent.
    pub fn default_splice(
        &mut self,
        parent: NodeKey,
        start: ChildIndex,
        delete_count: u32,
        nodes: &[NodeKey],
    ) -> Result<(), Error> {
        self.guard_write()?;
        let old = self.children_keys(parent)?;
        let start = start.0 as usize;
        let end = start
            .checked_add(delete_count as usize)
            .ok_or(Error::SpliceOutOfRange)?;
        if start > old.len() || end > old.len() {
            return Err(Error::SpliceOutOfRange);
        }
        let mut unique = crate::collections::IndexSet::default();
        for key in nodes {
            if *key == parent || self.has_ancestor(parent, *key) {
                return Err(Error::AppendSelf);
            }
            self.view().slot(*key).ok_or(Error::NodeNotFound(*key))?;
            if !unique.insert(*key) {
                return Err(Error::AppendSelf);
            }
            if parent == NodeKey::ROOT
                && !matches!(
                    self.kind(*key),
                    Some(NodeKind::Element | NodeKind::Decorator)
                )
            {
                return Err(Error::RootSpliceNonBlock);
            }
        }
        let before: Vec<_> = old
            .iter()
            .take(start)
            .copied()
            .filter(|key| !unique.contains(key))
            .collect();
        let after: Vec<_> = old
            .iter()
            .skip(end)
            .copied()
            .filter(|key| !unique.contains(key))
            .collect();
        let mut result = before;
        result.extend_from_slice(nodes);
        result.extend(after);
        for key in nodes {
            if let Some(source) = self.parent(*key)
                && source != parent
                && let Some(index) = self.index_within_parent(*key)
            {
                self.adjust_splice_selection(source, index.0, 1, 0, &[]);
            }
            self.remove_from_parent(*key)?;
        }
        for key in &old {
            if !result.contains(key) {
                self.remove_from_parent(*key)?;
            }
        }
        self.set_children(parent, &result)?;
        let removed: Vec<_> = old[start..end]
            .iter()
            .copied()
            .filter(|key| !result.contains(key))
            .collect();
        if result != old {
            self.adjust_splice_selection(
                parent,
                start as u32,
                delete_count,
                nodes.len() as u32,
                &removed,
            );
        }
        if result.is_empty()
            && !self.can_be_empty(parent)
            && !self.is_root_or_shadow_root(parent)
            && matches!(self.selection(), Some(Selection::Range(_)))
        {
            self.remove(parent, false)?;
        }
        Ok(())
    }
    fn set_children(&mut self, parent: NodeKey, children: &[NodeKey]) -> Result<(), Error> {
        for (i, key) in children.iter().enumerate() {
            let links = Links {
                parent: Some(parent),
                prev: i.checked_sub(1).and_then(|j| children.get(j)).copied(),
                next: children.get(i + 1).copied(),
            };
            if self
                .view()
                .slot(*key)
                .is_none_or(|node| node.links != links)
            {
                self.writable(*key)?.links = links;
            }
        }
        match &mut self.writable(parent)?.base {
            BaseData::Element(data) => {
                data.first = children.first().copied();
                data.last = children.last().copied();
                data.size = u32::try_from(children.len()).map_err(|_| Error::SpliceOutOfRange)?;
                Ok(())
            }
            _ => Err(Error::NotAnElement(parent)),
        }
    }
    fn adjust_splice_selection(
        &mut self,
        parent: NodeKey,
        start: u32,
        deleted: u32,
        inserted: u32,
        removed: &[NodeKey],
    ) {
        let affected = self.try_range_at(SelectionSlot::Active).map(|range| {
            [range.anchor, range.focus].map(|point| {
                removed
                    .iter()
                    .any(|key| point.key() == *key || self.has_ancestor(point.key(), *key))
            })
        });
        if let Some(Selection::Range(range)) = &mut self.pending.selection {
            for (i, point) in [&mut range.anchor, &mut range.focus]
                .into_iter()
                .enumerate()
            {
                if affected.is_some_and(|flags| flags[i]) {
                    *point = Point::element(parent, ChildIndex(start));
                } else if let Point::Element { key, offset } = point
                    && *key == parent
                    && offset.0 > start
                {
                    offset.0 = if offset.0 >= start + deleted {
                        offset.0 - deleted + inserted
                    } else {
                        start + inserted
                    };
                }
            }
        }
    }
    /// Base removal. Detached nodes are unchanged.
    pub fn default_remove(
        &mut self,
        key: NodeKey,
        restore_selection: bool,
        preserve_empty_parent: bool,
    ) -> Result<(), Error> {
        self.guard_write()?;
        if key == NodeKey::ROOT {
            return Err(Error::RemoveRoot);
        }
        let Some(parent) = self.parent(key) else {
            self.view().slot(key).ok_or(Error::NodeNotFound(key))?;
            return Ok(());
        };
        let position = self.index_within_parent(key).ok_or(Error::NoParent(key))?;
        let previous = self.prev_sibling(key);
        let next = self.next_sibling(key);
        let affected = self.try_range_at(SelectionSlot::Active).map(|range| {
            [range.anchor, range.focus]
                .map(|point| point.key() == key || self.has_ancestor(point.key(), key))
        });
        self.remove_from_parent(key)?;
        if let Some(Selection::Node(selection)) = &mut self.pending.selection {
            selection.nodes.shift_remove(&key);
        }
        if let Some(Selection::Range(range)) = &mut self.pending.selection {
            for (i, point) in [&mut range.anchor, &mut range.focus]
                .into_iter()
                .enumerate()
            {
                if affected.is_some_and(|flags| flags[i]) {
                    *point = Point::element(parent, position);
                } else if let Point::Element {
                    key: point_key,
                    offset,
                } = point
                    && *point_key == parent
                    && offset.0 > position.0
                {
                    offset.0 -= 1;
                }
            }
        }
        if restore_selection && affected.is_some_and(|flags| flags.into_iter().any(|v| v)) {
            let point = if let Some(previous) = previous {
                self.end_point(previous)?
            } else if let Some(next) = next {
                self.start_point(next)?
            } else {
                Point::element(parent, ChildIndex(0))
            };
            if let Some(Selection::Range(range)) = &mut self.pending.selection
                && let Some(affected) = affected
            {
                if affected[0] {
                    range.anchor = point;
                }
                if affected[1] {
                    range.focus = point;
                }
            }
        }
        if !preserve_empty_parent
            && !self.is_root_or_shadow_root(parent)
            && !self.can_be_empty(parent)
            && self.is_empty(parent)
        {
            self.default_remove(parent, restore_selection, false)?;
        }
        Ok(())
    }
    /// Base insertion after a sibling.
    pub fn default_insert_after(
        &mut self,
        anchor: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        if anchor == NodeKey::ROOT {
            return Err(Error::InsertAfterRoot);
        }
        if anchor == node {
            return Ok(node);
        }
        let parent = self.parent_or_err(anchor)?;
        let selection = self.pending.selection.clone();
        let position = self
            .index_within_parent(anchor)
            .ok_or(Error::NoParent(anchor))?;
        self.splice(parent, ChildIndex(position.0 + 1), 0, &[node])?;
        if !restore_selection {
            self.pending.selection = selection;
        }
        Ok(node)
    }
    /// Base insertion before a sibling.
    pub fn default_insert_before(
        &mut self,
        anchor: NodeKey,
        node: NodeKey,
        restore_selection: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        if anchor == NodeKey::ROOT {
            return Err(Error::InsertBeforeRoot);
        }
        if anchor == node {
            return Ok(node);
        }
        let parent = self.parent_or_err(anchor)?;
        let selection = self.pending.selection.clone();
        let position = self
            .index_within_parent(anchor)
            .ok_or(Error::NoParent(anchor))?;
        self.splice(parent, position, 0, &[node])?;
        if !restore_selection {
            self.pending.selection = selection;
        }
        Ok(node)
    }
    /// Base replacement, optionally transferring children.
    pub fn default_replace(
        &mut self,
        old: NodeKey,
        new: NodeKey,
        include_children: bool,
    ) -> Result<NodeKey, Error> {
        self.guard_write()?;
        if old == NodeKey::ROOT {
            return Err(Error::ReplaceRoot);
        }
        if old == new {
            return Ok(new);
        }
        if include_children
            && (self.kind(old) != Some(NodeKind::Element)
                || self.kind(new) != Some(NodeKind::Element))
        {
            return Err(Error::IncludeChildrenRequiresElements);
        }
        let selection = self.pending.selection.clone();
        if selection.is_some() {
            self.selection_replacements += 1;
        }
        let previous_size = self.children_size(new);
        let parent = self.parent_or_err(old)?;
        let position = self.index_within_parent(old).ok_or(Error::NoParent(old))?;
        if include_children {
            let children = self.children_keys(old)?;
            self.append(new, &children)?;
        }
        self.splice(parent, position, 1, &[new])?;
        if let Some(Selection::Range(previous)) = selection {
            let destination = self
                .last_descendant(new)
                .filter(|key| self.is_element(*key) || self.is_text(*key))
                .unwrap_or(new);
            let map = |point: Point| {
                if !include_children && point.key() == old {
                    if self.is_text(destination) {
                        Point::text(
                            destination,
                            Utf16Offset(point.offset()).min(self.text_content_size(destination)),
                        )
                    } else {
                        Point::element(destination, ChildIndex(point.offset()))
                    }
                } else {
                    match point {
                        Point::Text { key, offset } if key == old => Point::Text {
                            key: new,
                            offset: offset.min(self.text_content_size(new)),
                        },
                        Point::Element { key, offset } if key == old => Point::Element {
                            key: new,
                            offset: ChildIndex(
                                (previous_size + offset.0).min(self.children_size(new)),
                            ),
                        },
                        other => other,
                    }
                }
            };
            let anchor = (previous.anchor.key() == old).then(|| map(previous.anchor));
            let focus = (previous.focus.key() == old).then(|| map(previous.focus));
            if let Some(Selection::Range(range)) = &mut self.pending.selection {
                if let Some(point) = anchor {
                    range.anchor = point;
                }
                if let Some(point) = focus {
                    range.focus = point;
                }
            }
        }
        if self.composition_key == Some(old) {
            self.composition_key = Some(new);
        }
        Ok(new)
    }
    /// Remove all children through their virtual remove hooks.
    pub fn clear(&mut self, element: impl Into<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        let element = element.into();
        self.writable(element)?;
        let children = self.children_keys(element)?;
        for key in children {
            self.remove(key, true)?;
        }
        Ok(())
    }
    /// Move an inclusive sibling range after an anchor.
    pub fn insert_range_after(
        &mut self,
        node: impl Into<NodeKey>,
        first: impl Into<NodeKey>,
        last: Option<NodeKey>,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let mut anchor = node.into();
        let first = first.into();
        let mut range = vec![first];
        if let Some(last) = last {
            if last != first {
                for key in self.next_siblings(first) {
                    range.push(key);
                    if key == last {
                        break;
                    }
                }
            }
            if range.last() != Some(&last) {
                return Err(Error::InsertRangeAfterOrder);
            }
        } else {
            range.extend(self.next_siblings(first));
        }
        if range.contains(&anchor) {
            return Err(Error::InsertRangeAfterOrder);
        }
        for key in range {
            self.insert_after(anchor, key, true)?;
            anchor = key;
        }
        Ok(())
    }
    /// Split an element and its ancestors up to the root boundary.
    pub fn split_node(
        &mut self,
        element: impl Into<NodeKey>,
        offset: ChildIndex,
    ) -> Result<(Option<NodeKey>, NodeKey), Error> {
        self.guard_write()?;
        let element = element.into();
        if self.is_root_or_shadow_root(element) {
            return Err(Error::SplitRoot);
        }
        self.view()
            .element(element)
            .ok_or(Error::NotAnElement(element))?;
        let start = self.child_at_index(element, offset).unwrap_or(element);
        let (left, right, _) = self.split_ancestor(start, start)?;
        Ok((Some(left), right))
    }
    fn split_ancestor(
        &mut self,
        current: NodeKey,
        start: NodeKey,
    ) -> Result<(NodeKey, NodeKey, NodeKey), Error> {
        let parent = self.parent_or_err(current)?;
        let root = self.is_root_or_shadow_root(parent);
        let moved = if current == start && !root {
            current
        } else {
            self.copy_node(current, false)?
        };
        if root {
            if self.kind(current) != Some(NodeKind::Element)
                || self.kind(moved) != Some(NodeKind::Element)
            {
                return Err(Error::RootChildrenMustBeElements);
            }
            self.insert_after(current, moved, true)?;
            Ok((current, moved, moved))
        } else {
            let (left, right, new_parent) = self.split_ancestor(parent, start)?;
            let mut nodes = vec![moved];
            nodes.extend(self.next_siblings(current));
            self.append(new_parent, &nodes)?;
            Ok((left, right, moved))
        }
    }

    pub(crate) fn start_point(&self, key: NodeKey) -> Result<Point, Error> {
        let key = self.first_descendant(key).unwrap_or(key);
        match self.kind(key) {
            Some(NodeKind::Text) => Ok(Point::text(key, Utf16Offset::ZERO)),
            Some(NodeKind::Element) => Ok(Point::element(key, ChildIndex(0))),
            Some(_) => {
                let parent = self.parent_or_err(key)?;
                Ok(Point::element(
                    parent,
                    self.index_within_parent(key).ok_or(Error::NoParent(key))?,
                ))
            }
            None => Err(Error::NodeNotFound(key)),
        }
    }
    pub(crate) fn end_point(&self, key: NodeKey) -> Result<Point, Error> {
        let key = self.last_descendant(key).unwrap_or(key);
        match self.kind(key) {
            Some(NodeKind::Text) => Ok(Point::text(key, self.text_content_size(key))),
            Some(NodeKind::Element) => Ok(Point::element(key, ChildIndex(self.children_size(key)))),
            Some(_) => {
                let parent = self.parent_or_err(key)?;
                let index = self.index_within_parent(key).ok_or(Error::NoParent(key))?;
                Ok(Point::element(parent, ChildIndex(index.0 + 1)))
            }
            None => Err(Error::NodeNotFound(key)),
        }
    }
    /// Select the beginning of a node or its first descendant.
    pub fn select_start(&mut self, key: impl Into<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        let point = self.start_point(key.into())?;
        self.select_points(point, point)
    }
    /// Select the end of a node or its last descendant.
    pub fn select_end(&mut self, key: impl Into<NodeKey>) -> Result<(), Error> {
        self.guard_write()?;
        let point = self.end_point(key.into())?;
        self.select_points(point, point)
    }
    pub(crate) fn select_points(&mut self, anchor: Point, focus: Point) -> Result<(), Error> {
        let (format, style) = self
            .try_range_at(SelectionSlot::Active)
            .map(|r| (r.format, r.style.clone()))
            .unwrap_or_default();
        self.set_selection(Some(Selection::Range(RangeSelection {
            dirty: false,
            anchor,
            focus,
            format,
            style,
        })))
    }
    /// Select the previous sibling or the parent boundary.
    pub fn select_previous(
        &mut self,
        key: impl Into<NodeKey>,
        anchor: Option<Utf16Offset>,
        focus: Option<Utf16Offset>,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        if let Some(previous) = self.prev_sibling(key) {
            if self.kind(previous) == Some(NodeKind::Text) {
                let len = self.text_content_size(previous);
                return self.select_points(
                    Point::text(previous, anchor.unwrap_or(len)),
                    Point::text(previous, focus.unwrap_or(len)),
                );
            }
            return self.select_end(previous);
        }
        let parent = self.parent_or_err(key)?;
        self.select_points(
            Point::element(parent, ChildIndex(0)),
            Point::element(parent, ChildIndex(0)),
        )
    }
    /// Select the next sibling or the parent boundary.
    pub fn select_next(
        &mut self,
        key: impl Into<NodeKey>,
        anchor: Option<Utf16Offset>,
        focus: Option<Utf16Offset>,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let key = key.into();
        if let Some(next) = self.next_sibling(key) {
            if self.kind(next) == Some(NodeKind::Text) {
                return self.select_points(
                    Point::text(next, anchor.unwrap_or_default()),
                    Point::text(next, focus.unwrap_or_default()),
                );
            }
            return self.select_start(next);
        }
        let parent = self.parent_or_err(key)?;
        let point = Point::element(parent, ChildIndex(self.children_size(parent)));
        self.select_points(point, point)
    }
}
