//! Notes: footnotes at the bottom of the page they are referenced on,
//! endnotes after the body.

use super::super::super::{Item, StoryRef};
use super::super::offset_items;
use super::super::stack::{Stack, StackCtx, stack_story};
use super::Flow;

/// The story id of the footnote separator.
const SEPARATOR: i64 = -1;
/// The story id of the footnote continuation notice.
const CONTINUATION_NOTICE: i64 = -3;

impl Flow<'_, '_> {
    /// The footnote of a special `kind` (the separator, the continuation
    /// notice), laid out.
    fn special_note(&self, kind: &str, story: StoryRef) -> Option<Stack> {
        let notes = self.env.doc.footnotes();
        let note = notes.by_id.values().find(|n| n.kind == kind)?;
        Some(stack_story(
            self.env,
            &note.story,
            None,
            &StackCtx {
                story,
                width: self.section().text_width(),
                table: Default::default(),
                fields: self.fields(),
                note_number: None,
                float_frames: false,
                page: None,
            },
        ))
    }

    /// The room Word keeps below a page's footnotes for the notice that a
    /// note goes on overleaf, when the document has one.
    fn notice_height(&mut self) -> f32 {
        if self.notice.is_none() {
            let story = StoryRef::Footnote(CONTINUATION_NOTICE);
            let height = self
                .special_note("continuationNotice", story)
                .map_or(0.0, |s| s.height);
            self.notice = Some(height);
        }
        self.notice.unwrap_or(0.0)
    }

    pub(super) fn separator_stack(&mut self) -> Option<Stack> {
        if self.separator.is_none() {
            let sep = self.special_note("separator", StoryRef::Footnote(SEPARATOR));
            self.separator = Some(match sep {
                Some(stack) => stack,
                None => Stack {
                    items: vec![Item::Rule {
                        x0: 0.0,
                        y0: 6.0,
                        x1: 144.0,
                        y1: 6.0,
                        border: crate::model::props::Border {
                            style: crate::model::props::LineStyle::Single,
                            width: 0.5,
                            space: 0.0,
                            color: crate::model::props::ColorRef::Auto,
                        },
                    }],
                    anchors: Vec::new(),
                    height: 12.0,
                    notes: Vec::new(),
                    frames: Vec::new(),
                },
            });
        }
        self.separator.clone()
    }

    pub(super) fn note_height(&mut self, id: i64) -> f32 {
        if let Some(st) = self.note_stacks.get(&id) {
            return st.height;
        }
        let Some(note) = self.env.doc.footnotes().by_id.get(&id) else {
            return 0.0;
        };
        let number = self
            .env
            .note_numbers
            .get(&(false, id))
            .cloned()
            .unwrap_or_default();
        let st = stack_story(
            self.env,
            &note.story,
            None,
            &StackCtx {
                story: StoryRef::Footnote(id),
                width: self.section().text_width(),
                table: Default::default(),
                fields: self.fields(),
                note_number: Some(number),
                float_frames: false,
                page: None,
            },
        );
        let h = st.height;
        self.note_stacks.insert(id, st);
        h
    }

    /// Extra note height needed for these note references on this page.
    pub(super) fn notes_needed(&mut self, ids: &[i64]) -> f32 {
        let fresh: Vec<i64> = {
            let cur = self.cur.as_ref();
            ids.iter()
                .copied()
                .filter(|id| cur.is_none_or(|c| !c.notes.contains(id)))
                .collect()
        };
        if fresh.is_empty() {
            return 0.0;
        }
        let mut h: f32 = fresh.iter().map(|&id| self.note_height(id)).sum();
        if self.cur.as_ref().is_some_and(|c| c.notes.is_empty()) {
            h += self.separator_stack().map_or(0.0, |s| s.height) + self.notice_height();
        }
        h
    }

    pub(super) fn add_notes(&mut self, ids: &[i64]) {
        let need = self.notes_needed(ids);
        if let Some(cur) = &mut self.cur {
            for id in ids {
                if !cur.notes.contains(id) {
                    cur.notes.push(*id);
                }
            }
            cur.notes_height += need;
        }
    }

    pub(super) fn place_endnotes(&mut self) {
        let notes = self.env.doc.endnotes();
        let mut ordered: Vec<(&String, i64)> = self
            .env
            .note_numbers
            .iter()
            .filter(|((endnote, _), _)| *endnote)
            .map(|((_, id), n)| (n, *id))
            .collect();
        if ordered.is_empty() {
            return;
        }
        ordered.sort_by_key(|(_, id)| *id);
        let width = self.section().text_width();
        let (col_left, _) = self.col_geom();
        for (number, id) in ordered {
            let Some(note) = notes.by_id.get(&id) else {
                continue;
            };
            let st = stack_story(
                self.env,
                &note.story,
                None,
                &StackCtx {
                    story: StoryRef::Endnote(id),
                    width,
                    table: Default::default(),
                    fields: self.fields(),
                    note_number: Some(number.clone()),
                    float_frames: false,
                    page: None,
                },
            );
            let (y, placed_any) = self
                .cur
                .as_ref()
                .map_or((0.0, false), |c| (c.y, c.placed_any));
            if y + st.height > self.avail_bottom() && placed_any {
                self.next_column(false);
            }
            let y = self.cur.as_ref().map_or(0.0, |c| c.y);
            let mut items = st.items.clone();
            offset_items(&mut items, col_left, y);
            if let Some(c) = &mut self.cur {
                c.body.extend(items);
                c.y += st.height;
                c.placed_any = true;
            }
        }
    }
}
