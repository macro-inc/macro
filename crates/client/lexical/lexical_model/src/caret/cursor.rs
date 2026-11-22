//! One-step-eager caret traversal.
use super::*;
/// A traversal that borrows a fresh view for every step.
pub trait StepwiseCursor {
    /// Returned position.
    type Item;
    /// Return the stored item, computing its successor before returning.
    fn next(&mut self, view: StateRef<'_>) -> Result<Option<Self::Item>, Error>;
    /// Read-only iteration over a fixed snapshot.
    fn iter<'state>(self, view: StateRef<'state>) -> CursorIter<'state, Self>
    where
        Self: Sized,
    {
        CursorIter { cursor: self, view }
    }
}
/// Read-only adapter retaining the snapshot borrow.
pub struct CursorIter<'state, Cursor> {
    cursor: Cursor,
    view: StateRef<'state>,
}
impl<Cursor: StepwiseCursor> Iterator for CursorIter<'_, Cursor> {
    type Item = Result<Cursor::Item, Error>;
    fn next(&mut self) -> Option<Self::Item> {
        self.cursor.next(self.view).transpose()
    }
}
/// A directional range, including partially selected boundary text.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CaretRange {
    /// Initial position.
    pub anchor: PointCaret,
    /// Final position.
    pub focus: PointCaret,
    /// Shared direction.
    pub direction: CaretDirection,
}
impl CaretRange {
    /// Construct a range with matching directions.
    pub fn new(anchor: PointCaret, focus: PointCaret) -> Result<Self, Error> {
        if anchor.direction() != focus.direction() {
            return Err(Error::CaretDirectionMismatch);
        }
        Ok(Self {
            anchor,
            focus,
            direction: anchor.direction(),
        })
    }
    /// Empty range at a position.
    pub fn collapsed(anchor: PointCaret) -> Self {
        Self {
            anchor,
            focus: anchor,
            direction: anchor.direction(),
        }
    }
    /// Range extending to the directional end of the document.
    pub fn extend(_view: StateRef<'_>, anchor: PointCaret) -> Self {
        Self {
            anchor,
            focus: SiblingCaret::new(NodeKey::ROOT, anchor.direction()).into(),
            direction: anchor.direction(),
        }
    }
    /// Whether anchor and focus are the same exact point.
    pub fn is_collapsed(&self) -> bool {
        self.anchor == self.focus
    }
    /// Reverse endpoints and arrows if the requested direction differs.
    pub fn in_direction(self, view: StateRef<'_>, direction: CaretDirection) -> Self {
        if self.direction == direction {
            self
        } else {
            Self {
                anchor: self.focus.in_direction(view, direction),
                focus: self.anchor.in_direction(view, direction),
                direction,
            }
        }
    }
    /// Boundary text slices; a shared text origin yields just one slice.
    pub fn text_slices(self, view: StateRef<'_>) -> Result<TextPointCaretSlices, Error> {
        if let (PointCaret::Text(anchor), PointCaret::Text(focus)) = (self.anchor, self.focus)
            && anchor.origin == focus.origin
        {
            return Ok((
                Some(TextPointCaretSlice {
                    caret: anchor,
                    distance: i64::from(focus.offset.0) - i64::from(anchor.offset.0),
                }),
                None,
            ));
        }
        let slice = |point, focus| -> Result<Option<TextPointCaretSlice>, Error> {
            let PointCaret::Text(caret) = point else {
                return Ok(None);
            };
            let direction = if focus {
                self.direction.flip()
            } else {
                self.direction
            };
            let end = text_node_offset(
                view,
                caret.origin,
                direction_spec(direction),
                OffsetMode::Error,
            )?;
            Ok(Some(TextPointCaretSlice {
                caret,
                distance: i64::from(end.0) - i64::from(caret.offset.0),
            }))
        };
        Ok((slice(self.anchor, false)?, slice(self.focus, true)?))
    }
    /// Create a traversal, computing its first item with this view.
    /// s2: CARET-06
    pub fn node_carets(
        self,
        view: StateRef<'_>,
        root_mode: RootMode,
    ) -> Result<NodeCaretCursor, Error> {
        Self::new(self.anchor, self.focus)?;
        let anchor = match self.anchor {
            PointCaret::Child(c) => NodeCaret::Child(c),
            _ => self.anchor.sibling_caret().into(),
        };
        let mut cursor = NodeCaretCursor {
            next_item: None,
            focus: self.focus,
            root_mode,
        };
        if !self.anchor.is_same_node_caret(&self.focus) {
            cursor.next_item = cursor.step(anchor, view);
        }
        Ok(cursor)
    }
}
/// The next stored position and captured focus of a range traversal.
#[derive(Clone, Copy, Debug)]
pub struct NodeCaretCursor {
    next_item: Option<NodeCaret>,
    focus: PointCaret,
    root_mode: RootMode,
}
impl NodeCaretCursor {
    fn step(&self, caret: NodeCaret, view: StateRef<'_>) -> Option<NodeCaret> {
        if PointCaret::from(caret).is_same_node_caret(&self.focus) {
            return None;
        }
        let next = caret.adjacent_child_caret(view).or_else(|| {
            PointCaret::from(caret)
                .parent_caret(view, self.root_mode)
                .map(Into::into)
        })?;
        if matches!(self.focus, PointCaret::Text(_))
            && PointCaret::from(next).is_same_node_caret(&self.focus)
        {
            None
        } else {
            Some(next)
        }
    }
}
impl StepwiseCursor for NodeCaretCursor {
    type Item = NodeCaret;
    fn next(&mut self, view: StateRef<'_>) -> Result<Option<NodeCaret>, Error> {
        let current = self.next_item;
        self.next_item = current.and_then(|caret| self.step(caret, view));
        Ok(current)
    }
}
/// One-step-eager adjacent-sibling traversal.
#[derive(Clone, Copy, Debug)]
pub struct SiblingCursor {
    next_item: Option<SiblingCaret>,
}
impl NodeCaret {
    /// Create a sibling traversal excluding the origin.
    pub fn siblings(self, view: StateRef<'_>) -> SiblingCursor {
        SiblingCursor {
            next_item: PointCaret::from(self).adjacent_caret(view),
        }
    }
}
impl StepwiseCursor for SiblingCursor {
    type Item = SiblingCaret;
    fn next(&mut self, view: StateRef<'_>) -> Result<Option<SiblingCaret>, Error> {
        let current = self.next_item;
        self.next_item = current.and_then(|caret| PointCaret::from(caret).adjacent_caret(view));
        Ok(current)
    }
}
/// A signed UTF-16 slice at a text caret.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TextPointCaretSlice {
    /// Boundary position.
    pub caret: TextPointCaret,
    /// Signed distance from the boundary.
    pub distance: i64,
}
/// Optional anchor and focus slices.
pub type TextPointCaretSlices = (Option<TextPointCaretSlice>, Option<TextPointCaretSlice>);
impl TextPointCaretSlice {
    /// Ordered absolute slice endpoints, clamped to representable positions.
    pub fn slice_indices(&self) -> std::ops::Range<Utf16Offset> {
        let other = i64::from(self.caret.offset.0)
            .saturating_add(self.distance)
            .clamp(0, i64::from(u32::MAX)) as u32;
        Utf16Offset(other.min(self.caret.offset.0))..Utf16Offset(other.max(self.caret.offset.0))
    }
    /// Borrow the selected text from the view.
    pub fn text_content<'state>(&self, view: StateRef<'state>) -> Result<&'state str, Error> {
        view.text_data(self.caret.origin)?
            .text
            .slice(self.slice_indices())
    }
    /// Absolute distance in UTF-16 units.
    pub fn text_content_size(&self) -> u64 {
        self.distance.unsigned_abs()
    }
}
