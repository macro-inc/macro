//! Snapshot history and standalone merge classification (upstream lexical-history).
use crate::*;
use std::num::NonZeroU32;
/// Mutable history policy, read at each evaluation.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct HistoryConfig {
    /// Typing merge interval, default 300 ms.
    pub delay_ms: u64,
    /// Maximum undo entries, or no limit.
    pub max_depth: Option<NonZeroU32>,
}
impl Default for HistoryConfig {
    fn default() -> Self {
        Self {
            delay_ms: 300,
            max_depth: None,
        }
    }
}
/// How a commit affects the current candidate.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HistoryAction {
    /// Replace current candidate without pushing it.
    Merge,
    /// Start a new undo boundary.
    Push,
    /// Ignore this candidate.
    Discard,
}
/// Change class used by the delay-based merge rule.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChangeType {
    /// Other structural or selection change.
    Other,
    /// Intermediate composition update.
    ComposingCharacter,
    /// Insert a UTF-16 unit after the caret.
    InsertCharacterAfterSelection,
    /// Delete one UTF-16 unit before the caret.
    DeleteCharacterBeforeSelection,
    /// Delete one UTF-16 unit after the caret.
    DeleteCharacterAfterSelection,
}
/// Both history stack availability values.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct HistoryAvailability {
    /// Undo has an entry.
    pub can_undo: bool,
    /// Redo has an entry.
    pub can_redo: bool,
}
/// Merge getter state, usable without keeping undo/redo stacks.
#[derive(Clone)]
pub struct MergeTracker {
    previous_time: HistoryTime,
    previous_type: ChangeType,
    composition_start: Option<(HistoryTime, ChangeType, EditorState)>,
    delay_ms: u64,
}
impl MergeTracker {
    /// Create the getter at an explicit host time.
    pub fn new(delay_ms: u64, now: HistoryTime) -> Self {
        Self {
            previous_time: now,
            previous_type: ChangeType::Other,
            composition_start: None,
            delay_ms,
        }
    }
    /// Change the typing merge interval.
    pub fn set_delay(&mut self, delay_ms: u64) {
        self.delay_ms = delay_ms;
    }
    /// Classify a transition and advance the getter even when discarded.
    /// s2: HIS-30, HIS-31, HIS-32, HIS-33, HIS-34, HIS-35, HIS-36, HIS-37, HIS-38, HIS-39, HIS-40, HIS-41, HIS-42
    pub fn classify(&mut self, commit: &Commit, now: HistoryTime) -> HistoryAction {
        if commit.tags.contains(&UpdateTag::CompositionStart) {
            self.composition_start =
                Some((self.previous_time, self.previous_type, commit.prev.clone()));
        }
        if commit.tags.contains(&UpdateTag::Historic) {
            self.previous_type = ChangeType::Other;
            self.previous_time = now;
            return HistoryAction::Discard;
        }
        let mut previous = &commit.prev;
        if commit.tags.contains(&UpdateTag::CompositionEnd)
            && let Some((time, change, state)) = &self.composition_start
        {
            self.previous_time = *time;
            self.previous_type = *change;
            previous = state;
        }
        let change = change_type(previous, commit);
        let push = commit.tags.contains(&UpdateTag::HistoryPush);
        let action = if !push && commit.tags.contains(&UpdateTag::HistoryMerge) {
            HistoryAction::Merge
        } else if change == ChangeType::ComposingCharacter {
            HistoryAction::Discard
        } else if commit.changes.is_empty() {
            if commit.next.selection().is_some() {
                HistoryAction::Merge
            } else {
                HistoryAction::Discard
            }
        } else if !push
            && change != ChangeType::Other
            && change == self.previous_type
            && now.0 < self.previous_time.0.saturating_add(self.delay_ms)
        {
            HistoryAction::Merge
        } else if commit.changes.dirty_leaves.len() == 1
            && commit
                .changes
                .dirty_leaves
                .first()
                .is_some_and(|key| text_unchanged(*key, previous, &commit.next))
        {
            HistoryAction::Merge
        } else {
            HistoryAction::Push
        };
        self.previous_time = now;
        self.previous_type = change;
        action
    }
}
fn change_type(previous: &EditorState, commit: &Commit) -> ChangeType {
    use ChangeType::*;
    if commit.changes.is_empty() && commit.composition_key.is_none() {
        return Other;
    }
    if commit.composition_key.is_some() {
        return ComposingCharacter;
    }
    let Some(prev_selection) = previous
        .selection()
        .and_then(Selection::as_range)
        .filter(|s| s.is_collapsed())
    else {
        return Other;
    };
    let Some(next_selection) = commit
        .next
        .selection()
        .and_then(Selection::as_range)
        .filter(|s| s.is_collapsed())
    else {
        return Other;
    };
    let prev = previous.view();
    let next = commit.next.view();
    let nodes = commit
        .changes
        .dirty_leaves
        .iter()
        .copied()
        .filter(|key| next.contains(*key))
        .chain(
            commit
                .changes
                .dirty_elements
                .iter()
                .filter_map(|(key, intent)| {
                    (*key != NodeKey::ROOT
                        && *intent == DirtyIntent::Intentional
                        && next.contains(*key))
                    .then_some(*key)
                }),
        )
        .collect::<Vec<_>>();
    if nodes.len() > 1 {
        let key = next_selection.anchor.key();
        // Pinned upstream requires a single UTF-16 unit for the first character.
        if !prev.contains(key)
            && prev.contains(prev_selection.anchor.key())
            && next
                .text(key)
                .is_some_and(|data| data.text.utf16_len() == Utf16Offset(1))
            && next_selection.anchor.offset() == 1
        {
            return InsertCharacterAfterSelection;
        }
        return Other;
    }
    let Some(key) = nodes.first() else {
        return Other;
    };
    let (Some(a), Some(b)) = (prev.text(*key), next.text(*key)) else {
        return Other;
    };
    if a.mode != b.mode
        || a.text == b.text
        || prev_selection.anchor.key() != next_selection.anchor.key()
        || !matches!(next_selection.anchor, Point::Text { .. })
    {
        return Other;
    }
    let diff = i64::from(b.text.utf16_len().0) - i64::from(a.text.utf16_len().0);
    let shift =
        i64::from(next_selection.anchor.offset()) - i64::from(prev_selection.anchor.offset());
    match (diff, shift) {
        (1, 1) => InsertCharacterAfterSelection,
        (-1, -1) => DeleteCharacterBeforeSelection,
        (-1, 0) => DeleteCharacterAfterSelection,
        _ => Other,
    }
}
fn text_unchanged(key: NodeKey, previous: &EditorState, next: &EditorState) -> bool {
    let prev = previous.view();
    let next_view = next.view();
    if !prev.is_text(key) || !next_view.is_text(key) || prev.parent(key) != next_view.parent(key) {
        return false;
    }
    if let (Some(a), Some(b)) = (
        previous.selection().and_then(Selection::as_range),
        next.selection().and_then(Selection::as_range),
    ) && matches!(
        (a.anchor, a.focus, b.anchor, b.focus),
        (
            Point::Element { .. },
            Point::Element { .. },
            Point::Text { .. },
            Point::Text { .. }
        )
    ) {
        return false;
    }
    match (prev.export_json(key), next_view.export_json(key)) {
        (Ok(a), Ok(b)) => {
            to_js_json_string(&serde_json::Value::Object(a))
                == to_js_json_string(&serde_json::Value::Object(b))
        }
        _ => false,
    }
}
/// Per-editor snapshot undo/redo history.
#[derive(Clone)]
pub struct History {
    current: Option<EditorState>,
    current_commit: Option<CommitId>,
    undo_stack: Vec<EditorState>,
    redo_stack: Vec<EditorState>,
    tracker: MergeTracker,
    config: HistoryConfig,
}
impl History {
    /// Create empty stacks and a merge tracker at the explicit host time.
    pub fn new(config: HistoryConfig, now: HistoryTime) -> Self {
        Self::with_stacks(config, now, None, vec![], vec![])
    }
    /// Seed history with existing snapshots (one registry per editor).
    pub fn with_stacks(
        config: HistoryConfig,
        now: HistoryTime,
        current: Option<EditorState>,
        undo: Vec<EditorState>,
        redo: Vec<EditorState>,
    ) -> Self {
        Self {
            current,
            current_commit: None,
            undo_stack: undo,
            redo_stack: redo,
            tracker: MergeTracker::new(config.delay_ms, now),
            config,
        }
    }
    /// Record one commit identity at most once, reporting upstream availability notifications.
    /// s2: HIS-50, HIS-51, HIS-52, HIS-53, HIS-54, HIS-55, HIS-56
    pub fn record(
        &mut self,
        commit: &Commit,
        now: HistoryTime,
    ) -> (HistoryAction, Option<HistoryAvailability>) {
        if self.current_commit == Some(commit.id) {
            return (HistoryAction::Discard, None);
        }
        let action = self.tracker.classify(commit, now);
        if action == HistoryAction::Discard {
            return (action, None);
        }
        let mut report = false;
        if action == HistoryAction::Push {
            if !self.redo_stack.is_empty() {
                self.redo_stack.clear();
                report = true;
            }
            if let Some(current) = &self.current {
                self.undo_stack.push(current.clone());
                if let Some(max) = self.config.max_depth {
                    let excess = self.undo_stack.len().saturating_sub(max.get() as usize);
                    self.undo_stack.drain(..excess);
                }
                report = true;
            }
        }
        self.current = Some(commit.next.clone());
        self.current_commit = Some(commit.id);
        (action, report.then(|| self.availability()))
    }
    /// Restore the last undo entry inside a running update, sealing it.
    pub fn undo_in(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error> {
        self.restore_in(tx, false)
    }
    /// Restore the last redo entry inside a running update, sealing it.
    pub fn redo_in(&mut self, tx: &mut Transaction<'_>) -> Result<bool, Error> {
        self.restore_in(tx, true)
    }
    fn restore_in(&mut self, tx: &mut Transaction<'_>, redo: bool) -> Result<bool, Error> {
        let stack = if redo {
            &self.redo_stack
        } else {
            &self.undo_stack
        };
        let Some(state) = stack.last().cloned() else {
            return Ok(false);
        };
        tx.set_editor_state(state.clone(), TagSet::from_tags([UpdateTag::Historic]))?;
        let (from, to) = if redo {
            (&mut self.redo_stack, &mut self.undo_stack)
        } else {
            (&mut self.undo_stack, &mut self.redo_stack)
        };
        from.pop();
        if let Some(current) = &self.current {
            to.push(current.clone());
        }
        self.current = Some(state);
        self.current_commit = None;
        Ok(true)
    }
    /// Restore undo and record its historic commit and follow-ups.
    pub fn undo(&mut self, editor: &mut Editor, now: HistoryTime) -> Result<Option<Commit>, Error> {
        self.restore(editor, now, false)
    }
    /// Restore redo and record its historic commit and follow-ups.
    pub fn redo(&mut self, editor: &mut Editor, now: HistoryTime) -> Result<Option<Commit>, Error> {
        self.restore(editor, now, true)
    }
    fn restore(
        &mut self,
        editor: &mut Editor,
        now: HistoryTime,
        redo: bool,
    ) -> Result<Option<Commit>, Error> {
        if if redo {
            self.redo_stack.is_empty()
        } else {
            self.undo_stack.is_empty()
        } {
            return Ok(None);
        }
        // The standalone upstream undo installs its snapshot directly (no pending update).
        let state = if redo {
            self.redo_stack.last()
        } else {
            self.undo_stack.last()
        }
        .cloned()
        .ok_or(Error::Invariant("history stack"))?;
        let mut commit =
            editor.set_editor_state(state.clone(), TagSet::from_tags([UpdateTag::Historic]))?;
        let (from, to) = if redo {
            (&mut self.redo_stack, &mut self.undo_stack)
        } else {
            (&mut self.undo_stack, &mut self.redo_stack)
        };
        from.pop();
        if let Some(current) = &self.current {
            to.push(current.clone());
        }
        self.current = Some(state);
        self.current_commit = None;
        for entry in commit.chain() {
            self.record(entry, now);
        }
        // Availability is exposed by the owning core after this operation.
        commit.default_prevented = false;
        Ok(Some(commit))
    }
    /// Clear current and both stacks, retaining getter state as upstream does.
    pub fn clear(&mut self) {
        self.current = None;
        self.current_commit = None;
        self.undo_stack.clear();
        self.redo_stack.clear();
    }
    /// Reconfigure merge delay and future push depth enforcement.
    pub fn set_config(&mut self, config: HistoryConfig) {
        self.config = config;
        self.tracker.set_delay(config.delay_ms);
    }
    /// Current configuration.
    pub fn config(&self) -> HistoryConfig {
        self.config
    }
    /// Current stack availability.
    pub fn availability(&self) -> HistoryAvailability {
        HistoryAvailability {
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
        }
    }
    /// Number of undo entries.
    pub fn undo_depth(&self) -> usize {
        self.undo_stack.len()
    }
    /// Number of redo entries.
    pub fn redo_depth(&self) -> usize {
        self.redo_stack.len()
    }
}
#[cfg(test)]
mod test;
