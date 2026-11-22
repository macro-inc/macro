//! Before/after selection metadata stays in the native Loro history entry.
use lexical_loro::SelectionCursors;
use loro::{LoroDoc, LoroValue, UndoItemMeta, cursor::Cursor};
use loro_internal::undo::UndoManager;
use std::sync::{Arc, Mutex, MutexGuard};

#[derive(Default)]
struct Cursors {
    before: Vec<Cursor>,
    popped: Option<Vec<Cursor>>,
    pushed: Option<UndoItemMeta>,
    history: bool,
}

#[derive(Clone, Default)]
pub(super) struct HistorySelection(Arc<Mutex<Cursors>>);

// A native counter is a nonnegative i32. The low bit records whether the
// target has two endpoints; the remaining i64 bits retain its exact span start.
// This metadata is local to UndoManager and never enters a document or frame.
fn value(start: i64, count: usize) -> LoroValue {
    LoroValue::I64(start * 2 + i64::from(count == 2))
}
fn count(meta: &UndoItemMeta) -> usize {
    match meta.value {
        LoroValue::I64(value) if value & 1 != 0 => 2,
        _ => 0,
    }
}
pub(super) fn start(meta: &UndoItemMeta) -> Option<i64> {
    match meta.value {
        LoroValue::I64(value) => Some(value / 2),
        _ => None,
    }
}
fn cursors(selection: Option<SelectionCursors>) -> Vec<Cursor> {
    selection.map_or_else(Vec::new, |selection| {
        vec![selection.anchor.cursor, selection.focus.cursor]
    })
}
fn current(doc: &LoroDoc, cursor: &Cursor) -> Cursor {
    let Some(position) = doc.get_cursor_pos(cursor).ok() else {
        return cursor.clone();
    };
    let Some(container) = doc.get_container(cursor.container.clone()) else {
        return cursor.clone();
    };
    let updated = match container {
        loro::Container::Text(text) => text.get_cursor(position.current.pos, position.current.side),
        loro::Container::MovableList(list) => {
            list.get_cursor(position.current.pos, position.current.side)
        }
        _ => None,
    };
    updated.unwrap_or_else(|| cursor.clone())
}
impl HistorySelection {
    fn lock(&self) -> MutexGuard<'_, Cursors> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    pub(super) fn install(&self, undo: &UndoManager) {
        let selection = self.clone();
        undo.set_on_push(Some(Box::new(move |_, span, _| {
            let mut state = selection.lock();
            let mut meta = UndoItemMeta::new();
            meta.value = value(i64::from(span.start), state.before.len());
            for cursor in &state.before {
                meta.add_cursor(cursor);
            }
            if state.history {
                for cursor in state.popped.iter().flatten() {
                    meta.add_cursor(cursor);
                }
                state.pushed = Some(meta.clone());
            }
            meta
        })));
        let selection = self.clone();
        undo.set_on_pop(Some(Box::new(move |_, _, meta| {
            let size = count(&meta);
            selection.lock().popped = Some(
                meta.cursors
                    .into_iter()
                    .take(size)
                    .map(|item| item.cursor)
                    .collect(),
            );
        })));
    }
    pub(super) fn prepare(&self, selection: Option<SelectionCursors>) {
        self.lock().before = cursors(selection);
    }
    pub(super) fn record_after(&self, undo: &UndoManager, selection: Option<SelectionCursors>) {
        if let Some(mut meta) = undo.top_undo_meta() {
            meta.cursors.truncate(count(&meta));
            for cursor in cursors(selection) {
                meta.add_cursor(&cursor);
            }
            undo.set_top_undo_meta(meta);
        }
    }
    pub(super) fn begin(&self, doc: &LoroDoc, meta: Option<&UndoItemMeta>) {
        let mut state = self.lock();
        state.history = true;
        state.pushed = None;
        state.popped = None;
        state.before = meta.map_or_else(Vec::new, |meta| {
            meta.cursors
                .iter()
                .skip(count(meta))
                .map(|item| current(doc, &item.cursor))
                .collect()
        });
    }
    pub(super) fn finish(&self, undo: &UndoManager, redo: bool) {
        let mut state = self.lock();
        state.history = false;
        if let Some(meta) = state.pushed.take() {
            // Loro's default undo loop substitutes a neighbouring entry's cursors.
            // Each editor group instead owns both of its committed selections.
            if redo {
                undo.set_top_undo_meta(meta);
            } else {
                undo.set_top_redo_meta(meta);
            }
        }
    }
    pub(super) fn take_popped(&self) -> Option<Vec<Cursor>> {
        self.lock().popped.take()
    }
    pub(super) fn applied(&self) {
        let mut state = self.lock();
        state.popped = None;
        state.pushed = None;
        state.history = false;
    }
}
