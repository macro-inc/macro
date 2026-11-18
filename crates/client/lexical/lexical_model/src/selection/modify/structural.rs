//! Structural deletion before host text movement.
use crate::*;

impl Transaction<'_> {
    pub(super) fn delete_structural_boundary(
        &mut self,
        slot: SelectionSlot,
        direction: EditDirection,
    ) -> Result<bool, Error> {
        let range = self.range_at(slot)?.clone();
        let direction = if direction == EditDirection::Backward {
            CaretDirection::Previous
        } else {
            CaretDirection::Next
        };
        let initial = CaretRange::extend(
            self.view(),
            caret_from_point(self.view(), &range.anchor, direction)?,
        );
        let (a, b) = initial.text_slices(self.view())?;
        if a.into_iter().chain(b).any(|slice| slice.distance != 0) {
            return Ok(false);
        }
        let mut block = None;
        let mut merge = None;
        let mut cursor = initial.node_carets(self.view(), RootMode::ShadowRoot)?;
        while let Some(caret) = cursor.next(self.view())? {
            let key = caret.origin();
            if let NodeCaret::Child(child) = caret {
                if self.is_inline(key) {
                    continue;
                }
                if self.is_shadow_root(key) {
                    if merge.is_some() {
                        break;
                    }
                    let anchor = initial.anchor.origin();
                    if self.is_element(anchor) && self.is_empty(anchor) {
                        let normalized = normalize_caret(self.view(), caret.into())?;
                        self.install_caret_range_at(slot, CaretRange::collapsed(normalized))?;
                        self.remove(anchor, false)?;
                    }
                    return Ok(true);
                }
                if block.is_some() {
                    merge = Some(child);
                }
            } else if merge.is_some() {
                break;
            } else if self.is_element(key) {
                if !self.is_inline(key) {
                    block = Some(key);
                } else if !self.has_ancestor(initial.anchor.origin(), key) {
                    break;
                }
            } else if self.is_decorator(key) {
                if !self.is_isolated(key) {
                    let anchor = initial.anchor.origin();
                    if block.is_some()
                        && (self.is_keyboard_selectable(key) || !self.is_inline(key))
                        && self.is_element(anchor)
                        && self.is_empty(anchor)
                    {
                        self.remove(anchor, false)?;
                        let mut nodes = NodeSelection::new();
                        nodes.add(key);
                        self.install_selection_at(SelectionSlot::Active, Selection::Node(nodes))?;
                    } else {
                        self.remove(key, false)?;
                    }
                }
                return Ok(true);
            } else {
                break;
            }
        }
        if let (Some(block), Some(caret)) = (block, merge) {
            if self.is_empty(caret.origin)
                && !self.is_empty(block)
                && self.parent(caret.origin) == self.parent(block)
            {
                self.remove(caret.origin, true)?;
                return Ok(true);
            }
            let anchor = if !self.is_empty(caret.origin) && self.is_empty(block) {
                SiblingCaret::new(block, direction)
                    .rewind(self.view())?
                    .into()
            } else {
                initial.anchor
            };
            self.install_caret_range_at(slot, CaretRange::new(anchor, caret.into())?)?;
            self.remove_text_at(slot)?;
            return Ok(true);
        }
        Ok(false)
    }

    fn install_caret_range_at(
        &mut self,
        slot: SelectionSlot,
        carets: CaretRange,
    ) -> Result<(), Error> {
        let mut range = self.range_at(slot)?.clone();
        range.anchor = point_from_caret(self.view(), &carets.anchor)?;
        range.focus = point_from_caret(self.view(), &carets.focus)?;
        range.dirty = true;
        self.install_selection_at(slot, Selection::Range(range))
    }
}

impl Transaction<'_> {
    pub(super) fn modify_structural_boundary(
        &mut self,
        slot: SelectionSlot,
        alter: Alter,
        direction: EditDirection,
        granularity: Granularity,
        mut check_block: bool,
    ) -> Result<bool, Error> {
        let range = self.range_at(slot)?.clone();
        let direction = if direction == EditDirection::Backward {
            CaretDirection::Previous
        } else {
            CaretDirection::Next
        };
        let initial = caret_from_point(self.view(), &range.focus, direction)?;
        let mut focus = initial;
        let extendable = match initial {
            PointCaret::Text(text) => text.is_extendable(self.view())?,
            _ => false,
        };
        if !extendable {
            let node = match initial {
                PointCaret::Child(child) => NodeCaret::Child(child),
                _ => NodeCaret::Sibling(initial.sibling_caret()),
            };
            let mut siblings = node.siblings(self.view());
            while let Some(sibling) = siblings.next(self.view())? {
                check_block = false;
                if self.is_decorator(sibling.origin) && !self.is_isolated(sibling.origin) {
                    focus = sibling.into();
                    if granularity == Granularity::LineBoundary && self.is_inline(sibling.origin) {
                        continue;
                    }
                }
                break;
            }
            if check_block {
                let mode = if alter == Alter::Extend {
                    RootMode::ShadowRoot
                } else {
                    RootMode::Root
                };
                let mut nodes =
                    CaretRange::extend(self.view(), initial).node_carets(self.view(), mode)?;
                while let Some(next) = nodes.next(self.view())? {
                    if matches!(next, NodeCaret::Child(_)) {
                        if !self.is_inline(next.origin()) {
                            focus = next.into();
                        }
                    } else if self.is_element(next.origin()) {
                        continue;
                    } else if self.is_decorator(next.origin()) && !self.is_inline(next.origin()) {
                        focus = next.into();
                    }
                    break;
                }
            }
        }
        if focus == initial {
            return Ok(false);
        }
        if alter == Alter::Move
            && granularity != Granularity::LineBoundary
            && self.is_decorator(focus.origin())
            && self.is_keyboard_selectable(focus.origin())
        {
            let mut nodes = NodeSelection::new();
            nodes.add(focus.origin());
            self.install_selection_at(SelectionSlot::Active, Selection::Node(nodes))?;
            return Ok(true);
        }
        let point = point_from_caret(self.view(), &normalize_caret(self.view(), focus)?)?;
        if alter == Alter::Move {
            self.set_point_at(slot, PointRole::Anchor, point)?;
        }
        self.set_point_at(slot, PointRole::Focus, point)?;
        Ok(check_block || granularity != Granularity::LineBoundary)
    }
}
