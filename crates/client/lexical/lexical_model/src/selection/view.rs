use crate::*;
use std::sync::Arc;
/// DOM-resolved input; the model never queries a browser.
#[derive(Clone, Debug, PartialEq)]
pub enum ViewSelection {
    /// Preserve the model selection.
    KeepModel,
    /// Clear the selection.
    None,
    /// Resolved range endpoints.
    Range {
        /// Anchor point.
        anchor: Point,
        /// Focus point.
        focus: Point,
        /// DOM resolution moved a point.
        resolution_dirty: bool,
    },
    /// Whole selected nodes.
    Node(Vec<NodeKey>),
    /// Selected table cells.
    Table {
        /// Table key.
        table: NodeKey,
        /// First cell.
        anchor_cell: NodeKey,
        /// Last cell.
        focus_cell: NodeKey,
    },
}
/// Recently marked collapsed typing style, timed by the host.
#[derive(Clone, Debug, PartialEq)]
pub struct MarkedSelectionFormat {
    /// Typing format.
    pub format: TextFormat,
    /// Typing CSS.
    pub style: Arc<str>,
    /// Anchor key.
    pub key: NodeKey,
    /// Anchor offset.
    pub offset: u32,
}
/// Host facts used for selection-change processing.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SelectionChangeContext {
    /// DOM range endpoints share a node.
    pub dom_range_same_node: bool,
    /// Recent typing style.
    pub marked: Option<MarkedSelectionFormat>,
    /// DOM anchor offset.
    pub dom_anchor_offset: u32,
    /// DOM focus offset.
    pub dom_focus_offset: u32,
    /// Android's saved pre-delete range.
    pub post_delete_restore: Option<RangeSelection>,
    /// Host observed a triple click.
    pub triple_click: bool,
}
impl Transaction<'_> {
    /// Apply host-resolved selection points and typing attributes.
    pub fn selection_from_view(&mut self, selection: ViewSelection) -> Result<(), Error> {
        match selection {
            ViewSelection::KeepModel => Ok(()),
            ViewSelection::None => self.set_selection(None),
            ViewSelection::Node(keys) => {
                let mut nodes = NodeSelection::new();
                for key in keys {
                    nodes.add(key);
                }
                self.set_selection(Some(Selection::Node(nodes)))
            }
            ViewSelection::Table {
                table,
                anchor_cell,
                focus_cell,
            } => {
                let selection = TableSelection::new(table, anchor_cell, focus_cell);
                if selection.is_valid(self.view()) {
                    self.set_selection(Some(Selection::Table(selection)))?;
                }
                Ok(())
            }
            ViewSelection::Range {
                anchor,
                focus,
                resolution_dirty,
            } => {
                let mut range = RangeSelection::new(anchor, focus);
                self.normalize_view_boundaries(&mut range)?;
                if let Some(previous) = self
                    .previous_selection()
                    .and_then(Selection::as_range)
                    .filter(|previous| previous.anchor.key() == range.anchor.key())
                {
                    range.format = previous.format;
                    range.style = previous.style.clone();
                } else if let Some(text) = self.view().text(range.anchor.key()) {
                    range.format = text.format;
                    range.style = text.style.clone();
                } else if let Some(element) = self.view().element(range.anchor.key()) {
                    range.format = element.text_format;
                    range.style = element.text_style.clone();
                }
                range.dirty = resolution_dirty;
                // DOM reads create a clean selection unless resolution changed it.
                self.guard_write()?;
                self.pending.selection = Some(Selection::Range(range));
                self.dirty_since_flush = true;
                Ok(())
            }
        }
    }
    pub(crate) fn normalize_view_boundaries(
        &self,
        range: &mut RangeSelection,
    ) -> Result<(), Error> {
        if !matches!(
            (range.anchor, range.focus),
            (Point::Text { .. }, Point::Text { .. })
        ) {
            return Ok(());
        }
        let before = range.anchor.is_before(self.view(), &range.focus)?;
        let collapsed = range.is_collapsed();
        range.anchor = self.resolve_boundary(range.anchor, before, collapsed)?;
        range.focus = self.resolve_boundary(range.focus, !before, collapsed)?;
        if collapsed {
            range.focus = range.anchor;
        }
        Ok(())
    }
    fn resolve_boundary(
        &self,
        point: Point,
        backward: bool,
        collapsed: bool,
    ) -> Result<Point, Error> {
        let key = point.node(self.view())?;
        if point.offset() == 0 && !backward {
            if let Some(prev) = self.prev_sibling(key) {
                if self.is_text(prev) {
                    return Ok(Point::text(prev, self.text_content_size(prev)));
                }
                if !collapsed && self.is_element(prev) && self.is_inline(prev) {
                    return Ok(Point::element(prev, ChildIndex(self.children_size(prev))));
                }
            }
        } else if point.offset() == self.text_content_size(key).get() {
            if let Some(next) = self.next_sibling(key) {
                if backward && self.is_element(next) && self.is_inline(next) {
                    return Ok(Point::element(next, ChildIndex(0)));
                }
            } else if (collapsed || backward)
                && let Some(parent) = self.parent(key)
                && self.is_inline(parent)
                && !self.can_insert_text_after(parent)
                && let Some(next) = self.next_sibling(parent)
                && self.is_text(next)
            {
                return Ok(Point::text(next, Utf16Offset::ZERO));
            }
        }
        Ok(point)
    }
    /// Update the active range from view points without losing typing attributes.
    pub fn apply_view_range(
        &mut self,
        anchor: Point,
        focus: Point,
        resolution_dirty: bool,
    ) -> Result<(), Error> {
        let mut range = self.range_selection()?.clone();
        range.anchor = anchor;
        range.focus = focus;
        self.normalize_view_boundaries(&mut range)?;
        let old = self.range_selection()?;
        if old.anchor != range.anchor {
            self.set_point(PointRole::Anchor, range.anchor)?;
        }
        if self.focus()? != range.focus {
            self.set_point(PointRole::Focus, range.focus)?;
        }
        if resolution_dirty {
            self.selection_dirty = true;
        }
        self.normalize_selection()
    }
    /// Update typing attributes after a host selection change.
    pub fn selection_change_format(
        &mut self,
        context: &SelectionChangeContext,
    ) -> Result<(), Error> {
        let Some(mut range) = self.try_range_at(SelectionSlot::Active).cloned() else {
            return Ok(());
        };
        if let Some(saved) = &context.post_delete_restore
            && range.is_collapsed()
        {
            let same = range.anchor.key() == saved.anchor.key()
                && range.anchor.offset() == saved.anchor.offset() + 1;
            let next = self.next_sibling(saved.anchor.key()) == Some(range.anchor.key())
                && range.anchor.offset() == 1;
            if same || next {
                range = saved.clone();
            }
        }
        if range.is_collapsed() {
            if let Some(marked) = &context.marked
                && marked.key == range.anchor.key()
                && marked.offset == range.anchor.offset()
            {
                range.format = marked.format;
                range.style = marked.style.clone();
            } else if let Some(text) = self.view().text(range.anchor.key()) {
                range.format = text.format;
                range.style = text.style.clone();
            } else if let Some(element) = self.view().element(range.anchor.key())
                && !(self.composition_key().is_none()
                    && self.text_content(NodeKey::ROOT).is_empty())
            {
                if element.is_empty() {
                    range.format = element.text_format;
                    range.style = element.text_style.clone();
                } else {
                    range.style = Arc::from("");
                }
            }
            range.dirty |= context.dom_range_same_node;
        } else {
            let backward = range.is_backward(self.view())?;
            let nodes = range.nodes(self.view())?;
            let (start, end) = if backward {
                (range.focus, range.anchor)
            } else {
                (range.anchor, range.focus)
            };
            let mut formats = None;
            for (i, key) in nodes.iter().enumerate() {
                if let Some(text) = self.view().text(*key) {
                    let from = if backward {
                        context.dom_focus_offset
                    } else {
                        context.dom_anchor_offset
                    };
                    let to = if backward {
                        context.dom_anchor_offset
                    } else {
                        context.dom_focus_offset
                    };
                    if text.text.utf16_len() == Utf16Offset::ZERO
                        || (i == 0 && *key == start.key() && from == text.text.utf16_len().get())
                        || (i + 1 == nodes.len() && *key == end.key() && to == 0)
                    {
                        continue;
                    }
                    formats = Some(
                        formats.map_or(text.format, |format: TextFormat| format & text.format),
                    );
                }
            }
            range.format = formats.unwrap_or_default();
        }
        if self
            .try_range_at(SelectionSlot::Active)
            .is_none_or(|before| *before != range)
        {
            range.dirty = true;
        }
        // Reading an unchanged DOM range must not manufacture a selection-only commit.
        self.pending.selection = Some(Selection::Range(range));
        self.dirty_since_flush = true;
        Ok(())
    }
    /// Host context is available only while command dispatch processes it.
    pub fn selection_change_context(&self) -> Option<&SelectionChangeContext> {
        self.selection_context.as_ref()
    }
}
