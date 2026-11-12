//! Source block-decorator stopping policy; the host supplies only caret geometry.
use lexical_model::*;

/// Vertical key being dispatched through the ordered native command list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// Previous top-level sibling.
    Up,
    /// Next top-level sibling.
    Down,
}

/// Fresh DOM measurements of the issued block and current caret.
#[derive(Clone, Copy, Debug)]
pub struct EdgeRects {
    /// Block top in viewport coordinates.
    pub block_top: f64,
    /// Block bottom in viewport coordinates.
    pub block_bottom: f64,
    /// Caret top in viewport coordinates.
    pub caret_top: f64,
    /// Caret bottom in viewport coordinates.
    pub caret_bottom: f64,
    /// Actual caret height; Source clamps its threshold to one pixel.
    pub caret_height: f64,
}

/// A native-issued stopping decision, tied to the exact pending selection.
#[derive(Debug, PartialEq)]
pub struct Plan {
    direction: Direction,
    selection: Selection,
    target: NodeKey,
    block: Option<NodeKey>,
}

fn stopping(read: &impl Read, key: NodeKey) -> Result<bool, Error> {
    Ok(read.is_attached(key)
        && read.is_decorator(key)
        && !read.is_inline(key)
        && read.is_keyboard_selectable(key)
        && matches!(
            read.type_name(key)?,
            "image" | "video" | "horizontalrule" | "database-query" | "document-card"
        ))
}

fn neighbor(read: &impl Read, key: NodeKey, direction: Direction) -> Option<NodeKey> {
    match direction {
        Direction::Up => read.prev_sibling(key),
        Direction::Down => read.next_sibling(key),
    }
}

/// Inspect the actual pending model, never a published mirror or a host target key.
pub fn prepare(read: &impl Read, direction: Direction, shift: bool) -> Result<Option<Plan>, Error> {
    if shift {
        return Ok(None);
    }
    let Some(selection) = read.selection() else {
        return Ok(None);
    };
    let (target, block) = match selection {
        Selection::Node(nodes) => {
            let nodes = nodes.nodes(read.view());
            let [node] = nodes.as_slice() else {
                return Ok(None);
            };
            if !stopping(read, *node)? {
                return Ok(None);
            }
            (neighbor(read, *node, direction), None)
        }
        Selection::Range(range) if range.is_collapsed() => {
            if range.focus.key() == NodeKey::ROOT {
                let index = match direction {
                    Direction::Up => range.focus.offset().checked_sub(1),
                    Direction::Down => Some(range.focus.offset()),
                };
                (
                    index.and_then(|index| read.child_at_index(NodeKey::ROOT, ChildIndex(index))),
                    None,
                )
            } else {
                let Some(block) = read.top_level_element(range.focus.key())? else {
                    return Ok(None);
                };
                (neighbor(read, block, direction), Some(block))
            }
        }
        _ => return Ok(None),
    };
    let Some(target) = target else {
        return Ok(None);
    };
    if !stopping(read, target)? {
        return Ok(None);
    }
    Ok(Some(Plan {
        direction,
        selection: selection.clone(),
        target,
        block,
    }))
}

impl Plan {
    /// Issued DOM measurement key only; it is not a caller-controlled mutation target.
    pub fn block(&self) -> Option<NodeKey> {
        self.block
    }

    /// Consume and revalidate the decision before selecting its native target.
    pub fn complete(
        self,
        tx: &mut Transaction<'_>,
        rects: Option<EdgeRects>,
    ) -> Result<bool, Error> {
        if prepare(tx, self.direction, false)?.as_ref() != Some(&self) {
            return Ok(false);
        }
        if self.block.is_some() {
            let Some(rects) = rects else {
                return Ok(false);
            };
            if ![
                rects.block_top,
                rects.block_bottom,
                rects.caret_top,
                rects.caret_bottom,
                rects.caret_height,
            ]
            .into_iter()
            .all(f64::is_finite)
            {
                return Err(Error::Invariant("nonfinite block navigation geometry"));
            }
            let beyond = match self.direction {
                Direction::Up => rects.caret_top - rects.block_top,
                Direction::Down => rects.block_bottom - rects.caret_bottom,
            };
            if beyond >= rects.caret_height.max(1.0) {
                return Ok(false);
            }
        }
        let mut selection = NodeSelection::new();
        selection.add(self.target);
        tx.set_selection(Some(Selection::Node(selection)))?;
        tx.prevent_default();
        Ok(true)
    }
}

#[cfg(test)]
mod test;
