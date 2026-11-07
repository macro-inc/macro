use super::*;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Position {
    path: Vec<usize>,
    offset: u32,
    #[serde(rename = "type")]
    kind: PointType,
}
impl Position {
    fn view_point(&self, view: StateRef<'_>, previous: Option<Point>) -> Result<Point, Error> {
        let point = self.point(view)?;
        if self.kind == PointType::Text {
            return Ok(point);
        }
        let children = view.children_keys(point.key())?;
        let at_end = self.offset as usize == children.len() && !children.is_empty();
        let index = if at_end {
            children.len() - 1
        } else {
            self.offset as usize
        };
        let Some(mut child) = children.get(index).copied() else {
            return Ok(point);
        };
        if view.is_element(child)
            && !(view.can_be_empty(point.key()) && previous.is_some_and(|p| p.key() == point.key()))
        {
            child = if at_end {
                view.last_descendant(child)
            } else {
                view.first_descendant(child)
            }
            .unwrap_or(child);
            if view.is_text(child) {
                return Ok(Point::text(
                    child,
                    if at_end {
                        view.text_content_size(child)
                    } else {
                        Utf16Offset::ZERO
                    },
                ));
            }
            if view.is_element(child) {
                return Ok(Point::element(child, ChildIndex(0)));
            }
            let parent = view.parent(child).ok_or(Error::NoParent(child))?;
            // Upstream resets the offset to zero after descending into an
            // element's descendant, then adds one only for an end boundary.
            return Ok(Point::element(parent, ChildIndex(u32::from(at_end))));
        }
        if view.is_text(child) {
            return Ok(Point::text(
                child,
                if at_end {
                    view.text_content_size(child)
                } else {
                    Utf16Offset::ZERO
                },
            ));
        }
        Ok(point)
    }
    fn point(&self, view: StateRef<'_>) -> Result<Point, Error> {
        let mut key = NodeKey::ROOT;
        for i in &self.path {
            key = view
                .children_keys(key)?
                .get(*i)
                .copied()
                .ok_or(Error::PointNodeNotFound(key))?;
        }
        Ok(Point::new(key, self.offset, self.kind))
    }
}
#[derive(Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(crate) enum Command {
    Select {
        anchor: Position,
        focus: Position,
    },
    SelectionFromView {
        anchor: Position,
        focus: Position,
    },
    InsertText {
        text: String,
    },
    InsertRawText {
        text: String,
    },
    InsertParagraph,
    InsertLineBreak,
    InsertTab,
    RemoveText,
    FormatText {
        format: TextFormatType,
    },
    TextFromView {
        path: Vec<usize>,
        text: String,
        anchor: u32,
        focus: u32,
        #[serde(rename = "compositionEnd")]
        composition_end: bool,
    },
}
impl Command {
    pub(crate) fn is_view_input(&self) -> bool {
        matches!(
            self,
            Self::TextFromView { .. } | Self::SelectionFromView { .. }
        )
    }
    pub(crate) fn apply(&self, tx: &mut Transaction<'_>) -> Result<(), Error> {
        match self {
            Self::Select { anchor, focus } => {
                let range = RangeSelection::new(anchor.point(tx.view())?, focus.point(tx.view())?);
                tx.set_selection(Some(Selection::Range(range)))
            }
            Self::SelectionFromView { anchor, focus } => {
                let previous = tx.view().selection().and_then(Selection::as_range);
                let a = anchor.view_point(tx.view(), previous.map(|r| r.anchor))?;
                let f = focus.view_point(tx.view(), previous.map(|r| r.focus))?;
                tx.selection_from_view(ViewSelection::Range {
                    anchor: a,
                    focus: f,
                    resolution_dirty: false,
                })?;
                tx.selection_change_format(&SelectionChangeContext {
                    dom_range_same_node: anchor.path == focus.path && anchor.offset != focus.offset,
                    dom_anchor_offset: anchor.offset,
                    dom_focus_offset: focus.offset,
                    ..SelectionChangeContext::default()
                })
            }
            Self::InsertText { text } => tx.insert_text(text),
            Self::InsertRawText { text } => tx.insert_raw_text(text),
            Self::InsertParagraph => tx.insert_paragraph().map(|_| ()),
            Self::InsertLineBreak => tx.insert_line_break(false),
            Self::InsertTab => {
                let tab = tx.create(Tab::default())?;
                tx.insert_nodes(&[tab.key()])
            }
            Self::RemoveText => tx.remove_text(),
            Self::FormatText { format } => tx.format_text(*format, None),
            Self::TextFromView {
                path,
                text,
                anchor,
                focus,
                composition_end,
            } => {
                let point = Position {
                    path: path.clone(),
                    offset: 0,
                    kind: PointType::Text,
                }
                .point(tx.view())?;
                let mut text = text.clone();
                let mut anchor = *anchor;
                let mut focus = *focus;
                if *composition_end {
                    // Chromium's composition marker is a zero-width space.
                    let mut offset = 0;
                    text.retain(|ch| {
                        if ch == '\u{200b}' {
                            if anchor > offset {
                                anchor -= 1;
                            }
                            if focus > offset {
                                focus -= 1;
                            }
                            false
                        } else {
                            offset += ch.len_utf16() as u32;
                            true
                        }
                    });
                    tx.add_tag(UpdateTag::CompositionEnd);
                    tx.set_composition_key(None)?;
                }
                if *composition_end {
                    tx.selection_from_view(ViewSelection::Range {
                        anchor: Point::text(point.key(), Utf16Offset(anchor)),
                        focus: Point::text(point.key(), Utf16Offset(focus)),
                        resolution_dirty: false,
                    })?;
                }
                tx.text(point.key())?.set_text_content(&text)?;
                tx.apply_view_range(
                    Point::text(point.key(), Utf16Offset(anchor)),
                    Point::text(point.key(), Utf16Offset(focus)),
                    false,
                )
            }
        }
    }
}
