//! Conversions between selection points and carets.
use super::*;
/// Convert an element child index to a directional caret, clamping past the last child.
pub fn child_caret_at_index(
    view: StateRef<'_>,
    parent: NodeKey,
    index: ChildIndex,
    direction: CaretDirection,
) -> Result<NodeCaret, Error> {
    let mut caret = PointCaret::Child(
        ChildCaret::new(view, parent, CaretDirection::Next).ok_or(Error::NotAnElement(parent))?,
    );
    for _ in 0..index.0 {
        let Some(next) = caret.adjacent_caret(view) else {
            break;
        };
        caret = next.into();
    }
    Ok(match caret.in_direction(view, direction) {
        PointCaret::Child(c) => c.into(),
        other => other.sibling_caret().into(),
    })
}
/// Convert a selection point, validating its node kind.
pub fn caret_from_point(
    view: StateRef<'_>,
    point: &Point,
    direction: CaretDirection,
) -> Result<PointCaret, Error> {
    let key = point.key();
    let type_name = view.type_name(key)?;
    if matches!(point, Point::Text { .. }) && !view.is_text(key) {
        return Err(Error::CaretFromPointNotText {
            type_name: type_name.to_owned(),
            key,
        });
    }
    if matches!(point, Point::Element { .. }) && !view.is_element(key) {
        return Err(Error::CaretFromPointNotElement {
            type_name: type_name.to_owned(),
            key,
        });
    }
    Ok(match *point {
        Point::Text { key, offset } => {
            TextPointCaret::new(view, key, direction, TextOffsetSpec::At(offset))?.into()
        }
        Point::Element { key, offset } => {
            child_caret_at_index(view, key, offset, direction)?.into()
        }
    })
}
/// Convert a directional caret to an ordinary selection point.
pub fn point_from_caret(view: StateRef<'_>, caret: &PointCaret) -> Result<Point, Error> {
    let origin = caret.origin();
    Ok(match *caret {
        PointCaret::Text(c) => Point::text(origin, c.offset),
        PointCaret::Sibling(_) if view.is_text(origin) => Point::text(
            origin,
            text_node_offset(
                view,
                origin,
                direction_spec(caret.direction()),
                OffsetMode::Error,
            )?,
        ),
        PointCaret::Sibling(_) => Point::element(
            view.parent_or_err(origin)?,
            ChildIndex(
                view.index_within_parent(origin)
                    .ok_or(Error::NoParent(origin))?
                    .0
                    + u32::from(caret.direction() == CaretDirection::Next),
            ),
        ),
        PointCaret::Child(_) => {
            view.element_data(origin)?;
            Point::element(
                origin,
                ChildIndex(if caret.direction() == CaretDirection::Next {
                    0
                } else {
                    view.children_size(origin)
                }),
            )
        }
    })
}
/// Preserve range typing attributes while replacing its endpoints.
pub fn range_selection_from_caret_range(
    view: StateRef<'_>,
    selection: &mut RangeSelection,
    range: CaretRange,
) -> Result<(), Error> {
    let anchor = point_from_caret(view, &range.anchor)?;
    let focus = point_from_caret(view, &range.focus)?;
    selection.anchor = anchor;
    selection.focus = focus;
    selection.dirty = true;
    Ok(())
}
/// Derive range direction by comparing next-directed positions.
pub fn caret_range_from_selection(
    view: StateRef<'_>,
    selection: &RangeSelection,
) -> Result<CaretRange, Error> {
    let anchor = caret_from_point(view, &selection.anchor, CaretDirection::Next)?;
    let focus = caret_from_point(view, &selection.focus, CaretDirection::Next)?;
    let direction = if compare_point_caret_next(view, anchor, focus)? == Ordering::Greater {
        CaretDirection::Previous
    } else {
        CaretDirection::Next
    };
    CaretRange::new(
        anchor.in_direction(view, direction),
        focus.in_direction(view, direction),
    )
}
/// Descend to the deepest equivalent position, preferring text endpoints.
pub fn normalize_caret(view: StateRef<'_>, mut caret: PointCaret) -> Result<PointCaret, Error> {
    while let PointCaret::Child(child) = caret {
        let Some(NodeCaret::Child(next)) = NodeCaret::Child(child).adjacent_child_caret(view)
        else {
            break;
        };
        caret = next.into();
    }
    if matches!(caret, PointCaret::Text(_)) {
        return Ok(caret);
    }
    if view.is_text(caret.origin()) {
        return Ok(TextPointCaret::new(
            view,
            caret.origin(),
            caret.direction(),
            direction_spec(caret.direction()),
        )?
        .into());
    }
    if let Some(adjacent) = caret.adjacent_caret(view)
        && view.is_text(adjacent.origin)
    {
        return Ok(TextPointCaret::new(
            view,
            adjacent.origin,
            caret.direction(),
            direction_spec(caret.direction().flip()),
        )?
        .into());
    }
    Ok(caret)
}
impl Transaction<'_> {
    /// Set an active endpoint from a caret.
    pub fn set_point_from_caret(
        &mut self,
        role: PointRole,
        caret: PointCaret,
    ) -> Result<(), Error> {
        let point = point_from_caret(self.view(), &caret)?;
        self.set_point(role, point)
    }
    /// Set a range selection, preserving existing range format and style.
    pub fn set_selection_from_caret_range(&mut self, range: CaretRange) -> Result<(), Error> {
        let preserves_range = self.selection().is_some_and(Selection::is_range);
        let mut selection = self
            .view()
            .selection()
            .and_then(Selection::as_range)
            .cloned()
            .unwrap_or_else(|| {
                RangeSelection::new(
                    Point::element(NodeKey::ROOT, ChildIndex(0)),
                    Point::element(NodeKey::ROOT, ChildIndex(0)),
                )
            });
        range_selection_from_caret_range(self.view(), &mut selection, range)?;
        if preserves_range {
            self.set_selection(Some(Selection::Range(selection)))
        } else {
            self.replace_selection(Some(Selection::Range(selection)))
        }
    }
    /// Update the active range endpoints.
    pub fn update_range_selection_from_caret_range(
        &mut self,
        range: CaretRange,
    ) -> Result<(), Error> {
        self.range_selection()?;
        self.set_selection_from_caret_range(range)
    }
}
