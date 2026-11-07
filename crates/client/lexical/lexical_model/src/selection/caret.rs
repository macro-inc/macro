//! Directional caret traversal used by upstream range deletion.
use crate::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Child,
    Sibling,
    Text(Utf16Offset),
}
#[derive(Clone, Copy)]
struct Caret {
    key: NodeKey,
    kind: Kind,
    next: bool,
}
impl Caret {
    fn from_point(view: StateRef<'_>, point: Point) -> Result<Self, Error> {
        let (key, kind) = match point {
            Point::Text { key, offset } => {
                if offset > view.text_data(key)?.text.utf16_len() {
                    return Err(Error::Utf16OffsetOutOfRange(offset));
                }
                (key, Kind::Text(offset))
            }
            Point::Element {
                key,
                offset: ChildIndex(0),
            } => {
                view.element_data(key)?;
                (key, Kind::Child)
            }
            Point::Element { key, offset } => {
                let offset = offset.0.min(view.element_data(key)?.children_size());
                if offset == 0 {
                    (key, Kind::Child)
                } else {
                    let child = view
                        .child_at_index(key, ChildIndex(offset - 1))
                        .ok_or(Error::SpliceOutOfRange)?;
                    (child, Kind::Sibling)
                }
            }
        };
        Ok(Self {
            key,
            kind,
            next: true,
        })
    }
    fn sibling(self) -> Self {
        Self {
            kind: Kind::Sibling,
            ..self
        }
    }
    fn same_node(self, other: Self) -> bool {
        self.key == other.key && (self.kind == Kind::Child) == (other.kind == Kind::Child)
    }
    fn adjacent(self, view: StateRef<'_>) -> Option<Self> {
        let key = match (self.kind, self.next) {
            (Kind::Child, true) => view.first_child(self.key),
            (Kind::Child, false) => view.last_child(self.key),
            (_, true) => view.next_sibling(self.key),
            (_, false) => view.prev_sibling(self.key),
        }?;
        Some(Self {
            key,
            kind: Kind::Sibling,
            ..self
        })
    }
    fn adjacent_child(self, view: StateRef<'_>) -> Option<Self> {
        self.adjacent(view).map(|caret| {
            if view.is_element(caret.key) {
                Self {
                    kind: Kind::Child,
                    ..caret
                }
            } else {
                caret
            }
        })
    }
    fn parent_at(self, view: StateRef<'_>) -> Option<NodeKey> {
        if self.kind == Kind::Child {
            Some(self.key)
        } else {
            view.parent(self.key)
        }
    }
    fn parent(self, view: StateRef<'_>) -> Option<Self> {
        let key = self.parent_at(view).filter(|key| *key != NodeKey::ROOT)?;
        Some(Self {
            key,
            kind: Kind::Sibling,
            ..self
        })
    }
    fn flip(self, view: StateRef<'_>) -> Result<Self, Error> {
        if let Kind::Text(_) = self.kind {
            return Ok(Self {
                next: !self.next,
                ..self
            });
        }
        if let Some(adjacent) = self.adjacent(view) {
            return Ok(Self {
                next: !self.next,
                ..adjacent
            });
        }
        Ok(Self {
            key: self.parent_at(view).ok_or(Error::NoParent(self.key))?,
            kind: Kind::Child,
            next: !self.next,
        })
    }
    fn rewind(self, view: StateRef<'_>) -> Result<Self, Error> {
        let opposite = Self {
            next: !self.next,
            kind: Kind::Sibling,
            ..self
        };
        if let Some(previous) = opposite.adjacent(view) {
            return Ok(Self {
                next: self.next,
                ..previous
            });
        }
        Ok(Self {
            key: view.parent(self.key).ok_or(Error::NoParent(self.key))?,
            kind: Kind::Child,
            ..self
        })
    }
    fn candidates(self, view: StateRef<'_>) -> Result<Vec<Self>, Error> {
        let mut out = vec![self];
        let mut current = if self.kind == Kind::Child {
            self.parent(view)
        } else {
            Some(self.sibling())
        };
        while let Some(caret) = current {
            out.push(caret.rewind(view)?);
            current = caret.parent(view);
        }
        Ok(out)
    }
    fn normalize(mut self, view: StateRef<'_>) -> Self {
        while self.kind == Kind::Child {
            let Some(next) = self
                .adjacent_child(view)
                .filter(|caret| caret.kind == Kind::Child)
            else {
                break;
            };
            self = next;
        }
        if view.is_text(self.key) {
            if !matches!(self.kind, Kind::Text(_)) {
                self.kind = Kind::Text(if self.next {
                    view.text_content_size(self.key)
                } else {
                    Utf16Offset::ZERO
                });
            }
        } else if let Some(adjacent) = self.adjacent(view).filter(|caret| view.is_text(caret.key)) {
            self = Self {
                kind: Kind::Text(if self.next {
                    Utf16Offset::ZERO
                } else {
                    view.text_content_size(adjacent.key)
                }),
                ..adjacent
            };
        }
        self
    }
    fn point(self, view: StateRef<'_>) -> Result<Point, Error> {
        match self.kind {
            Kind::Text(offset) => Ok(Point::text(self.key, offset)),
            Kind::Child => Ok(Point::element(
                self.key,
                ChildIndex(if self.next {
                    0
                } else {
                    view.children_size(self.key)
                }),
            )),
            Kind::Sibling if view.is_text(self.key) => Ok(Point::text(
                self.key,
                if self.next {
                    view.text_content_size(self.key)
                } else {
                    Utf16Offset::ZERO
                },
            )),
            Kind::Sibling => Ok(Point::element(
                view.parent(self.key).ok_or(Error::NoParent(self.key))?,
                ChildIndex(
                    view.index_within_parent(self.key)
                        .ok_or(Error::NoParent(self.key))?
                        .0
                        + u32::from(self.next),
                ),
            )),
        }
    }
}
impl Transaction<'_> {
    pub(super) fn remove_caret_range(
        &mut self,
        slot: SelectionSlot,
        preserve_first: bool,
    ) -> Result<(), Error> {
        self.guard_write()?;
        let range = self.range_at(slot)?.clone();
        if range.is_collapsed() {
            let point = Caret::from_point(self.view(), range.anchor)?.point(self.view())?;
            return self.collapsed_selection_at(slot, point, range.format, range.style);
        }
        let backward = self.view().point_is_before(range.focus, range.anchor)?;
        let (start, end) = if backward {
            (range.focus, range.anchor)
        } else {
            (range.anchor, range.focus)
        };
        let anchor = Caret::from_point(self.view(), start)?;
        let focus = Caret::from_point(self.view(), end)?;
        let mut anchors = anchor.candidates(self.view())?;
        let mut focuses = focus.flip(self.view())?.candidates(self.view())?;
        let mut seen = crate::collections::IndexSet::default();
        let mut removed = vec![];
        let step = |caret: Caret| {
            caret
                .adjacent_child(self.view())
                .or_else(|| caret.parent(self.view()))
        };
        let mut current = if anchor.same_node(focus) {
            None
        } else {
            step(anchor.sibling_if_text())
        };
        while let Some(caret) = current {
            if matches!(focus.kind, Kind::Text(_)) && caret.same_node(focus) {
                break;
            }
            if caret.kind == Kind::Child {
                seen.insert(caret.key);
            } else if !self.is_element(caret.key) || seen.contains(&caret.key) {
                removed.push(caret.key);
            }
            current = if caret.same_node(focus) {
                None
            } else {
                step(caret)
            };
        }
        let mut slices = vec![];
        if let Kind::Text(offset) = anchor.kind {
            let to = if anchor.same_node(focus) && matches!(focus.kind, Kind::Text(_)) {
                end.offset()
            } else {
                self.text_content_size(anchor.key).get()
            };
            slices.push((anchor.key, offset, Utf16Offset(to)));
        }
        if let Kind::Text(offset) = focus.kind
            && !(anchor.same_node(focus) && matches!(anchor.kind, Kind::Text(_)))
        {
            slices.push((focus.key, Utf16Offset::ZERO, offset));
        }
        for key in removed {
            self.remove(key, false)?;
        }
        let mut preserve = preserve_first;
        for (key, from, to) in slices {
            let data = self.view().text_data(key)?.clone();
            if (to - from == data.text.utf16_len() && !preserve)
                || ((data.is_token() || self.is::<Tab>(key)) && from != to)
            {
                self.remove(key, false)?;
            } else if from != to {
                preserve = false;
                self.text(key)?.splice_text(from..to, "", false)?;
                let next = if data.is_segmented() {
                    let content = self.text_content(key).into_owned();
                    let plain = self.create_text(&content)?;
                    self.text(plain)?
                        .set_format(data.format)?
                        .set_style(&data.style)?;
                    self.replace(key, plain, false)?;
                    plain.key()
                } else {
                    key
                };
                for candidates in [&mut anchors, &mut focuses] {
                    if let Some(first) = candidates.first_mut().filter(|caret| caret.key == key) {
                        *first = Caret {
                            key: next,
                            kind: Kind::Text(from),
                            ..*first
                        };
                    }
                }
            }
        }
        let a = anchors
            .iter()
            .copied()
            .find(|caret| self.is_attached(caret.key))
            .map(|caret| caret.normalize(self.view()));
        let f = focuses
            .iter()
            .copied()
            .find(|caret| self.is_attached(caret.key))
            .map(|caret| caret.normalize(self.view()));
        if let Some((first, last)) = a
            .zip(f)
            .and_then(|(a, f)| self.caret_merge_targets(a, f, &seen))
        {
            let children = self.children_keys(last)?;
            self.caret_splice(
                ChildCaret {
                    origin: first,
                    direction: CaretDirection::Previous,
                }
                .into(),
                0,
                &children,
                CaretDirection::Next,
            )?;
            let mut parent = self.parent(last);
            self.remove(last, true)?;
            while let Some(key) = parent.filter(|key| self.is_empty(*key)) {
                parent = self.parent(key);
                self.remove(key, true)?;
            }
        }
        let best = a
            .into_iter()
            .chain(f)
            .chain(anchors)
            .chain(focuses)
            .find(|caret| self.is_attached(caret.key))
            .ok_or(Error::SelectionLost)?;
        let mut best = best.normalize(self.view());
        if best.next == backward {
            best = best.flip(self.view())?;
        }
        self.collapsed_selection_at(slot, best.point(self.view())?, range.format, range.style)
    }
    fn caret_merge_targets(
        &self,
        a: Caret,
        f: Caret,
        seen: &crate::collections::IndexSet<NodeKey>,
    ) -> Option<(NodeKey, NodeKey)> {
        let ap = a.parent_at(self.view())?;
        let fp = f.parent_at(self.view())?;
        let mut left = self.ancestors(ap).collect::<Vec<_>>();
        left.reverse();
        left.push(ap);
        let mut right = self.ancestors(fp).collect::<Vec<_>>();
        right.reverse();
        right.push(fp);
        let common = left.iter().zip(&right).take_while(|(a, b)| a == b).count();
        let pick = |chain: &[NodeKey], focus: bool| {
            let mut block = None;
            for key in chain.iter().skip(common).copied() {
                if self.is_root_or_shadow_root(key) {
                    return None;
                }
                if block.is_none() && self.is_block(key) && (!focus || seen.contains(&key)) {
                    block = Some(key);
                }
            }
            block
        };
        pick(&left, false).zip(pick(&right, true))
    }
}
impl Caret {
    fn sibling_if_text(self) -> Self {
        if matches!(self.kind, Kind::Text(_)) {
            self.sibling()
        } else {
            self
        }
    }
}
