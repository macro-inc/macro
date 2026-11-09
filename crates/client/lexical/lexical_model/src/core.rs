//! Sans-IO editor state machine: one input, its commits, a structural diff and host effects.
use crate::*;
use smallvec::SmallVec;
use std::sync::Arc;
mod input;
mod output;
mod prepared;
mod remote;
mod staging;
mod text;
pub use input::*;
pub use output::*;
/// Owns the editor, optional local history, and immutable host policy.
pub struct EditorCore {
    editor: Editor,
    history: Option<History>,
    composition: Composition,
    config: CoreConfig,
    initial: Option<Output>,
}
impl EditorCore {
    /// Take initial hook commits from the editor. History begins after initialization.
    pub fn new(mut editor: Editor, config: CoreConfig) -> Self {
        let initial_diff = editor.initial_diff.take();
        let initial = editor.take_initial_commits();
        let composition = editor
            .composition_key
            .map_or(Composition::Idle, |key| Composition::Composing { key });
        let mut core = Self {
            editor,
            history: config
                .history
                .map(|config| History::new(config, HistoryTime(0))),
            composition,
            config,
            initial: None,
        };
        if !initial.is_empty() {
            let mut iter = initial.into_iter();
            if let Some(mut commit) = iter.next() {
                commit.following.extend(iter);
                if let Some(mut diff) = initial_diff {
                    if !core.config.diff.include_state {
                        diff.ops.retain(|op| !matches!(op, DiffOp::State { .. }));
                    }
                    core.initial =
                        Some(core.build_output(&commit, Handled::No, vec![], None, None, diff));
                }
            }
        }
        core
    }
    /// Drain the build-time result once, before applying inputs.
    pub fn take_initial_output(&mut self) -> Option<Output> {
        self.initial.take()
    }
    /// Current immutable document snapshot.
    pub fn state(&self) -> &EditorState {
        self.editor.state()
    }
    /// Read-only editor configuration and extension state.
    pub fn editor(&self) -> &Editor {
        &self.editor
    }
    /// Current composition ownership.
    pub fn composition(&self) -> Composition {
        self.composition
    }
    /// Optional local snapshot history.
    pub fn history(&self) -> Option<&History> {
        self.history.as_ref()
    }
    /// Toggle host selection effects without replacing the editor.
    pub fn set_editable(&mut self, editable: bool) {
        self.config.editable = editable;
    }
    /// Apply one input atomically, retaining any explicitly published early commits on error.
    /// s2: EVT-14, EVT-23, EVT-24, EVT-25, EVT-28, EVT-29, EVT-30, EVT-31, EVT-36, HIS-60, HIS-61, HIS-62, HIS-63, HIS-64
    pub fn apply(&mut self, input: Input, now: HistoryTime) -> Result<Output, ApplyError> {
        self.initial = None;
        let error = |error| ApplyError {
            error,
            committed: Box::default(),
        };
        if let Input::Batch(inputs) = &input
            && inputs.iter().any(|input| !input.batchable())
        {
            return Err(error(Error::InputNotBatchable));
        }
        let inputs = match &input {
            Input::Batch(inputs) => inputs.as_slice(),
            _ => std::slice::from_ref(&input),
        };
        if inputs.iter().any(|input| {
            matches!(
                input,
                Input::Command {
                    command: Command::InsertClipboardNodes {
                        selection: SelectionSlot::Detached(_),
                        ..
                    },
                    ..
                }
            )
        }) {
            return Err(error(Error::UnknownSelectionSlot));
        }
        if self.editor.mode() == EditorMode::Headless
            && inputs.iter().any(|input| {
                input
                    .selection()
                    .is_some_and(|selection| *selection != ViewSelection::KeepModel)
            })
        {
            return Err(error(Error::ViewSelectionInHeadless));
        }
        // A missing listener cannot derive selection or consume carried tags.
        if let Input::Command { command, .. } = &input
            && !has_listener(&self.editor, self.history.is_some(), command)
        {
            return self
                .output(&self.editor.noop_commit(), Handled::No, vec![], None, None)
                .map_err(error);
        }
        let parsed = if let Input::SetState { state, .. } = &input {
            Some(self.editor.parse_editor_state(state).map_err(error)?)
        } else {
            None
        };
        let old_history = self.history.clone();
        let mut effects = vec![];
        let mut tx = self.editor.transaction();
        let mut handled = Handled::No;
        let mut installed = None;
        let mut displayed_delta = None;
        let mut selection_installed = false;
        let result = (|| {
            let mut fresh = true;
            for item in inputs {
                // An unchanged DOM input ignores its reported selection upstream.
                // Validate the span before any pending selection or model write.
                let unchanged = match item {
                    Input::TextDeltaFromView(delta) if !delta.composition_end => {
                        delta.is_unchanged(tx.view())?
                    }
                    Input::TextFromView {
                        key,
                        text,
                        composition_end: false,
                        ..
                    } => tx.view().text_data(*key)?.text.as_str() == text,
                    _ => false,
                };
                if unchanged {
                    continue;
                }
                let command_empty = matches!(item,Input::Command {command,..} if tx.editor.listener_table.levels(command.kind()).is_none() && !(self.history.is_some() && matches!(command,Command::Undo|Command::Redo|Command::ClearHistory|Command::ClearEditor)));
                if fresh
                    && !command_empty
                    && let Some(selection) = item.selection()
                {
                    let typing = if matches!(
                        item,
                        Input::TextDeltaFromView(ViewTextDelta {
                            composition_end: false,
                            ..
                        }) | Input::TextFromView {
                            composition_end: false,
                            ..
                        }
                    ) {
                        tx.selection()
                            .and_then(Selection::as_range)
                            .map(|range| (range.format, range.style.clone()))
                    } else {
                        None
                    };
                    tx.selection_from_view(selection.clone())?;
                    if let Some((format, style)) = typing
                        && let Some(Selection::Range(range)) = tx.pending.selection.as_mut()
                    {
                        range.format = format;
                        range.style = style;
                    }
                    installed = tx.selection().cloned();
                    selection_installed = true;
                    fresh = false;
                }
                if !command_empty {
                    fresh = false;
                }
                handled = run(
                    &mut tx,
                    &mut self.history,
                    item,
                    parsed.as_ref(),
                    &mut displayed_delta,
                    &mut effects,
                )?;
                if inputs.len() > 1 {
                    tx.flush()?;
                }
            }
            Ok::<(), Error>(())
        })();
        let early = tx
            .preceding
            .as_deref()
            .map(output::flatten)
            .unwrap_or_default();
        let commit = match result.and_then(|()| tx.commit()) {
            Ok(commit) => commit,
            Err(failure) => {
                self.history = old_history;
                if let Some(history) = &mut self.history {
                    for commit in early
                        .iter()
                        .filter(|entry| !entry.changes.is_empty() || entry.selection_changed)
                    {
                        history.record(commit, now);
                    }
                }
                self.composition = self
                    .editor
                    .composition_key
                    .map_or(Composition::Idle, |key| Composition::Composing { key });
                return Err(ApplyError {
                    error: failure,
                    committed: Box::new(early),
                });
            }
        };
        let commit = self.editor.run_after_commit(commit);
        if let Some(history) = &mut self.history {
            for entry in commit
                .chain()
                .filter(|entry| !entry.changes.is_empty() || entry.selection_changed)
            {
                if let (_, Some(availability)) = history.record(entry, now) {
                    effects.push(Effect::HistoryState(availability));
                }
            }
        }
        self.composition = self
            .editor
            .composition_key
            .map_or(Composition::Idle, |key| Composition::Composing { key });
        let view_match = match &input {
            Input::TextDeltaFromView(delta)
                if self
                    .editor
                    .state
                    .view()
                    .text(delta.key)
                    .is_some_and(|node| {
                        displayed_delta.as_ref().map_or_else(
                            || {
                                delta
                                    .is_unchanged(self.editor.state.view())
                                    .unwrap_or(false)
                            },
                            |text| node.text.as_str() == text,
                        )
                    }) =>
            {
                Some(delta.key)
            }
            Input::TextFromView { key, text, .. }
                if self
                    .editor
                    .state
                    .view()
                    .text(*key)
                    .is_some_and(|node| node.text.as_str() == text) =>
            {
                Some(*key)
            }
            _ => None,
        };
        let elide = matches!(
            input,
            Input::TextFromView { .. }
                | Input::TextDeltaFromView(_)
                | Input::SelectionFromView { .. }
                | Input::Composition { .. }
        );
        // Serialization failures after publication must retain the chain too.
        let accepted_selection = selection_installed.then_some(installed.clone());
        self.output(
            &commit,
            handled,
            effects,
            view_match,
            elide.then_some(installed),
        )
        .map(|mut output| {
            output.installed_selection = accepted_selection;
            output
        })
        .map_err(|error| ApplyError {
            error,
            committed: Box::new(output::flatten(&commit)),
        })
    }
    fn output(
        &self,
        commit: &Commit,
        handled: Handled,
        effects: Vec<Effect>,
        view_match: Option<NodeKey>,
        installed: Option<Option<Selection>>,
    ) -> Result<Output, Error> {
        let diff = commit.diff(&self.config.diff)?;
        Ok(self.build_output(commit, handled, effects, view_match, installed, diff))
    }
    fn build_output(
        &self,
        commit: &Commit,
        handled: Handled,
        mut effects: Vec<Effect>,
        view_match: Option<NodeKey>,
        installed: Option<Option<Selection>>,
        mut diff: Diff,
    ) -> Output {
        if let Some(key) = view_match {
            diff.view_text_matches = Some(key);
            diff.ops
                .retain(|op| !matches!(op,DiffOp::Text {key:node,..} if *node==key));
        }
        let chain = commit.chain().collect::<Vec<_>>();
        let final_state = chain.last().map_or(&commit.next, |entry| &entry.next);
        let selection = final_state.selection();
        let dirty = chain.iter().any(|entry| !entry.changes.is_empty());
        let selection_changed = chain.iter().any(|entry| entry.selection_changed);
        let skip_selection = chain
            .iter()
            .any(|entry| entry.tags.contains(&UpdateTag::SkipDomSelection));
        let unchanged = installed
            .as_ref()
            .is_some_and(|installed| installed.as_ref() == selection);
        let elide = unchanged && (!dirty || (view_match.is_some() && diff.ops.is_empty()));
        if self.config.editable
            && !skip_selection
            && !elide
            && (dirty || selection_changed || selection.is_none())
            && chain.iter().any(|entry| !entry.is_noop())
        {
            let (format, style) = selection
                .and_then(Selection::as_range)
                .map_or((TextFormat::empty(), Arc::from("")), |range| {
                    (range.format, range.style.clone())
                });
            effects.push(Effect::SetViewSelection {
                selection: output::view_selection(selection),
                format,
                style,
            });
            if !chain
                .iter()
                .any(|entry| entry.tags.contains(&UpdateTag::SkipScrollIntoView))
                && let Some(selection) = selection
            {
                let focus = match selection {
                    Selection::Range(range) => Some(range.focus.key()),
                    Selection::Node(nodes) => nodes.keys().next(),
                    Selection::Table(table) => Some(table.focus.key()),
                };
                if let Some(key) = focus {
                    effects.push(Effect::ScrollIntoView(key));
                }
            }
        }
        let mut decorators = crate::collections::IndexSet::default();
        for entry in &chain {
            for (key, mutation) in &entry.changes.mutations {
                let view = if *mutation == Mutation::Destroyed {
                    entry.prev.view()
                } else {
                    entry.next.view()
                };
                if view.is_decorator(*key) {
                    decorators.insert(*key);
                }
            }
            effects.extend(entry.events.iter().cloned().map(Effect::PluginEvent));
            if let Some(failure) = &entry.follow_up_error {
                effects.push(Effect::FollowUpFailed {
                    plugin: failure.plugin,
                    kind: failure.error.kind(),
                    message: Arc::from(failure.error.to_string()),
                });
            }
        }
        if !decorators.is_empty() {
            effects.push(Effect::DecoratorsChanged(decorators.into_iter().collect()));
        }
        if self.config.track_text_content
            && chain.first().is_some_and(|first| {
                first.prev.root_text_content() != final_state.root_text_content()
            })
        {
            effects.push(Effect::TextContentChanged);
        }
        if selection_changed && !selection.is_some_and(Selection::is_range) {
            effects.push(Effect::SelectionChange);
        }
        if chain.iter().any(|entry| entry.default_prevented) {
            effects.push(Effect::PreventDefault);
        }
        // No listener means no published update, even though the standalone dispatch API returns a no-op value.
        let commits = if commit.is_noop() && commit.chain().all(Commit::is_noop) {
            SmallVec::new()
        } else {
            output::flatten(commit)
        };
        Output {
            installed_selection: None,
            commits,
            diff,
            effects,
            handled,
        }
    }
}
fn has_listener(editor: &Editor, history: bool, command: &Command) -> bool {
    editor.listener_table.levels(command.kind()).is_some()
        || (history
            && matches!(
                command,
                Command::Undo | Command::Redo | Command::ClearHistory | Command::ClearEditor
            ))
}
fn dispatch(
    tx: &mut Transaction<'_>,
    history: &mut Option<History>,
    command: &Command,
    effects: &mut Vec<Effect>,
) -> Result<Handled, Error> {
    if let Command::InsertClipboardNodes {
        selection: SelectionSlot::Detached(_),
        ..
    } = command
    {
        return Err(Error::UnknownSelectionSlot);
    }
    if tx.dispatch_inner(command, true)? == Handled::Yes {
        return Ok(Handled::Yes);
    }
    if let Some(history) = history {
        match command {
            Command::Undo => {
                history.undo_in(tx)?;
                effects.push(Effect::HistoryState(history.availability()));
                return Ok(Handled::Yes);
            }
            Command::Redo => {
                history.redo_in(tx)?;
                effects.push(Effect::HistoryState(history.availability()));
                return Ok(Handled::Yes);
            }
            Command::ClearHistory => {
                history.clear();
                effects.push(Effect::HistoryState(history.availability()));
                return Ok(Handled::Yes);
            }
            Command::ClearEditor => history.clear(),
            _ => {}
        }
    }
    Ok(Handled::No)
}
fn run(
    tx: &mut Transaction<'_>,
    history: &mut Option<History>,
    input: &Input,
    parsed: Option<&EditorState>,
    displayed_delta: &mut Option<String>,
    effects: &mut Vec<Effect>,
) -> Result<Handled, Error> {
    match input {
        Input::TextDeltaFromView(delta) => {
            let displayed = delta.displayed_text(tx.view())?;
            if delta.composition_end {
                text::composition(
                    tx,
                    &CompositionEvent::End {
                        key: delta.key,
                        text: displayed.clone(),
                        anchor: delta.anchor,
                        focus: delta.focus,
                        data: delta.composition_data.clone().unwrap_or_default(),
                    },
                    effects,
                )?;
            } else {
                text::from_view(
                    tx,
                    delta.key,
                    &displayed,
                    (delta.anchor, delta.focus),
                    false,
                    delta.composition_data.as_deref(),
                    effects,
                )?;
            }
            *displayed_delta = Some(displayed);
            Ok(Handled::No)
        }
        Input::TextFromView {
            key,
            text,
            anchor,
            focus,
            composition_end,
            composition_data,
            ..
        } => {
            if *composition_end {
                text::composition(
                    tx,
                    &CompositionEvent::End {
                        key: *key,
                        text: text.clone(),
                        anchor: *anchor,
                        focus: *focus,
                        data: composition_data.clone().unwrap_or_default(),
                    },
                    effects,
                )?;
            } else {
                text::from_view(
                    tx,
                    *key,
                    text,
                    (*anchor, *focus),
                    false,
                    composition_data.as_deref(),
                    effects,
                )?;
            }
            Ok(Handled::No)
        }
        Input::Command { command, .. } => dispatch(tx, history, command, effects),
        Input::KeyDown {
            event,
            routed,
            routed_prevent_default,
            ..
        } => {
            if dispatch(tx, history, &Command::KeyDown(event.clone()), effects)? == Handled::Yes {
                return Ok(Handled::Yes);
            }
            if let Some(command) = routed {
                if *routed_prevent_default {
                    tx.prevent_default();
                }
                dispatch(tx, history, command, effects)
            } else {
                Ok(Handled::No)
            }
        }
        Input::SelectionFromView { selection, change } => {
            tx.selection_from_view(selection.clone())?;
            if let Some(change) = change {
                tx.selection_change_format(change)?;
                dispatch(tx, history, &Command::SelectionChange, effects)
            } else {
                Ok(Handled::No)
            }
        }
        Input::Composition { event, .. } => text::composition(tx, event, effects),
        Input::ApplyRemote { changes, options } => {
            for tag in options.tags.iter() {
                tx.add_tag(tag.clone());
            }
            tx.options.skip_transforms = options.skip_transforms;
            remote::apply(tx, changes, effects)?;
            Ok(Handled::No)
        }
        Input::Undo => dispatch(tx, history, &Command::Undo, effects),
        Input::Redo => dispatch(tx, history, &Command::Redo, effects),
        Input::SetState { tags, .. } => {
            tx.set_editor_state(
                parsed
                    .ok_or(Error::Invariant("parsed state missing"))?
                    .clone(),
                tags.clone(),
            )?;
            Ok(Handled::No)
        }
        Input::Batch(_) => Err(Error::InputNotBatchable),
        Input::InsertTextEvent {
            phase,
            data,
            data_transfer_text,
            facts,
            last_key,
            ..
        } => {
            if *phase == TextEventPhase::BeforeInput {
                match data.as_deref() {
                    Some("\n") => {
                        tx.prevent_default();
                        dispatch(
                            tx,
                            history,
                            &Command::InsertLineBreak {
                                select_start: false,
                            },
                            effects,
                        )?;
                        return Ok(Handled::Yes);
                    }
                    Some("\n\n") => {
                        tx.prevent_default();
                        dispatch(tx, history, &Command::InsertParagraph, effects)?;
                        return Ok(Handled::Yes);
                    }
                    None => {
                        if let Some(text) = data_transfer_text {
                            tx.prevent_default();
                            tx.insert_raw_text(text)?;
                            return Ok(Handled::Yes);
                        }
                        return Ok(Handled::No);
                    }
                    _ => {}
                }
            }
            if let Some(text) = data
                && let Some(range) = tx.selection().and_then(Selection::as_range).cloned()
                && tx.should_prevent_default_and_insert_text(&range, text, *facts)?
            {
                if *phase == TextEventPhase::BeforeInput {
                    tx.prevent_default();
                }
                dispatch(tx, history, &Command::InsertText(text.clone()), effects)?;
                tx.move_selection_past_trailing_acceptance_boundary(text, last_key.as_deref())?;
                Ok(Handled::Yes)
            } else {
                Ok(Handled::No)
            }
        }
    }
}
#[cfg(test)]
mod test;

#[cfg(feature = "foreign-nodes")]
mod compatibility;
