//! Editor composition and collaborative history.
use crate::{InitialView, SessionError, ViewEffect};
use doc_sync_core::{Access, Now};
use lexical_loro::{FIXUP_ORIGIN, LOCAL_ORIGIN, LoroProjection, PlainPolicy, SyncPolicy};
use lexical_model::*;
use loro::LoroDoc;
use loro_internal::undo::UndoManager;
use std::sync::Arc;
mod builder;
mod history;
pub use builder::{
    default_editor_builder, register_editor_commands, with_session_plugins,
    with_session_plugins_with_id_state,
};
static PLAIN: PlainPolicy = PlainPolicy;

/// Annotation constructor supplied by the editor's application registry.
pub type CommentNodeFactory = fn(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>;

/// Rebuildable editor configuration shared by live editors and comment forks.
#[derive(Clone)]
pub struct EditorConfig {
    /// Registry and plugins, built anew for every document instance.
    pub builder: Arc<dyn Fn(EditorMode, u64) -> EditorBuilder + Send + Sync>,
    /// Create an annotation wrapper inside the isolated staging transaction.
    pub comment_node: CommentNodeFactory,
    /// Application projection exclusions.
    pub policy: &'static dyn SyncPolicy,
    /// Live model mode; comment staging always uses Headless.
    pub mode: EditorMode,
    /// Platform selection policy.
    pub view_host: ViewHost,
    /// Typing merge interval on the injected monotonic clock.
    pub delay_ms: u64,
    /// Trusted application commands that change only local policy-excluded state.
    pub local_commands: &'static [CommandKind],
}
impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            builder: Arc::new(default_editor_builder),
            comment_node: lexical_rich_nodes::mark::create_mark_node,
            policy: &PLAIN,
            mode: EditorMode::ViewAttached,
            view_host: ViewHost {
                engine: ViewEngine::Native,
                os: ViewOs::Other,
            },
            delay_ms: 400,
            local_commands: &[],
        }
    }
}
/// EditorCore, indexed projection and Loro-owned collaborative history.
pub struct EditorSurface {
    pub(crate) config: EditorConfig,
    pub(crate) core: EditorCore,
    pub(crate) projection: Option<LoroProjection>,
    undo: Option<UndoManager>,
    tracker: MergeTracker,
    history_selection: history::HistorySelection,
    group_active: bool,
    history_ready: bool,
    pub(crate) focused: bool,
    pub(crate) focus_known: bool,
    pub(crate) resynced: bool,
    item_started: Option<HistoryTime>,
    availability: HistoryAvailability,
    #[cfg(feature = "conformance")]
    pub(crate) undo_applied: Vec<crate::UndoObservation>,
    handled: Handled,
    cursor: Option<lexical_loro::SelectionCursors>,
    #[cfg(feature = "test-faults")]
    pub(crate) wrong_next_type: bool,
    #[cfg(feature = "test-faults")]
    pub(crate) fault_quote: bool,
    #[cfg(feature = "test-faults")]
    pub(crate) projection_fault_writes: Vec<crate::ProjectionFaultWrite>,
    #[cfg(test)]
    pub(crate) fail_next_remote: bool,
}
impl EditorSurface {
    pub(crate) fn new(config: EditorConfig, peer: u64, now: Now) -> Result<Self, SessionError> {
        let editor = Self::builder(&config, config.mode, peer).build()?;
        Ok(Self {
            core: Self::core(editor),
            projection: None,
            undo: None,
            tracker: MergeTracker::new(config.delay_ms, HistoryTime(now.mono.0)),
            config,
            history_selection: history::HistorySelection::default(),
            group_active: false,
            history_ready: false,
            focused: false,
            focus_known: false,
            resynced: false,
            item_started: None,
            availability: HistoryAvailability::default(),
            #[cfg(feature = "conformance")]
            undo_applied: Vec::new(),
            handled: Handled::No,
            cursor: None,
            #[cfg(feature = "test-faults")]
            wrong_next_type: false,
            #[cfg(feature = "test-faults")]
            fault_quote: false,
            #[cfg(feature = "test-faults")]
            projection_fault_writes: Vec::new(),
            #[cfg(test)]
            fail_next_remote: false,
        })
    }
    pub(crate) fn builder(config: &EditorConfig, mode: EditorMode, peer: u64) -> EditorBuilder {
        let builder = (config.builder)(mode, peer)
            .view_host(config.view_host)
            .opaque_unknown_types(true);
        if mode == EditorMode::Headless {
            builder.plugin(builder::RestoreModelSelection)
        } else {
            builder
        }
    }
    fn core(editor: Editor) -> EditorCore {
        EditorCore::new(
            editor,
            CoreConfig {
                history: None,
                editable: true,
                diff: DiffOptions::default(),
                track_text_content: false,
            },
        )
    }
    pub(crate) fn clear_binding(&mut self) {
        self.projection = None;
        self.undo = None;
    }
    /// Immutable model snapshot used by the view and synchronous queries.
    pub fn state(&self) -> &EditorState {
        self.core.state()
    }
    /// Immutable registered type metadata for bulk host queries.
    pub fn registry(&self) -> &std::sync::Arc<Registry> {
        self.core.editor().registry()
    }
    /// Static command subscriptions read once by the view at initialization.
    pub fn listener_table(&self) -> &ListenerTable {
        self.core.editor().listener_table()
    }
    /// Propagation result from the last admitted local command.
    pub fn command_handled(&self) -> Handled {
        self.handled
    }
    /// Collaborative undo/redo availability.
    pub fn history(&self) -> HistoryAvailability {
        self.availability
    }
    /// Actual native history stack depths for independent simulation lineage.
    #[cfg(feature = "conformance")]
    pub fn history_depths(&self) -> (usize, usize) {
        self.undo
            .as_ref()
            .map_or((0, 0), |undo| (undo.undo_count(), undo.redo_count()))
    }
    /// Resolve the current selection to durable Loro cursors when both nodes have ids.
    pub fn selection_cursors(&self) -> Option<lexical_loro::SelectionCursors> {
        self.cursor.clone()
    }
    pub(crate) fn init(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        let _open = tracing::info_span!("editor.open", peer = doc.peer_id()).entered();
        let load = tracing::info_span!("state.load", peer = doc.peer_id());
        let load_guard = load.enter();
        self.projection = None;
        self.undo = None;
        let has_root = crate::generic::root(doc, "root").is_some();
        let mut cleanup = false;
        let state = if has_root {
            let initial = lexical_loro::reconstruct_initial_state(doc, self.config.policy)?;
            cleanup = initial.has_transparent_wrappers && access == Access::Edit;
            initial.state
        } else {
            SerializedEditorState { root: serde_json::json!({"type":"root","version":1,"children":[],"direction":null,"format":"","indent":0}).as_object().cloned().ok_or(SessionError::Configuration("empty root must be an object"))? }
        };
        // Even an empty document runs build-time hooks and drains their output.
        self.core = Self::core(
            Self::builder(&self.config, self.config.mode, doc.peer_id())
                .initial_state(state)
                .build()?,
        );
        self.core.set_editable(access == Access::Edit);
        let initial = self.core.take_initial_output();
        let base = initial
            .as_ref()
            .and_then(|out| out.commits.first())
            .map_or(self.core.state(), |commit| &commit.prev);
        if !has_root && access != Access::Edit {
            self.cursor = None;
            self.history_ready = false;
            self.availability = HistoryAvailability::default();
            // Rendering an empty read surface must not create unpublished CRDT history.
            drop(load_guard);
            let _view = tracing::info_span!("view.initialize").entered();
            view.push(ViewEffect::Initialize(InitialView::Editor {
                diff: self.view_diff()?,
                state: self.core.state().to_json()?,
            }));
            return Ok(());
        }
        let mut projection = if cleanup {
            let state = lexical_loro::synced_json(self.core.state(), self.config.policy)?;
            lexical_loro::mirror::set_synced_state(doc, &state, self.config.policy)?;
            LoroProjection::attach(doc, self.core.state(), self.config.policy)?
        } else if has_root {
            LoroProjection::attach(doc, base, self.config.policy)?
        } else {
            LoroProjection::initialize(doc, base, self.config.policy, now.wall.0 / 1000)?
        };
        if let Some(output) = initial {
            if access == Access::Edit && !cleanup {
                projection.local_commit(doc, &output.commits, LOCAL_ORIGIN, now.wall.0 / 1000)?;
            }
            // Read/comment-only editors may retain unsynced hook fields (S11 §4.6).
            // Keep the index attached to the persisted base; do not write those fields.

            view.extend(output.effects.into_iter().map(ViewEffect::Editor));
        }
        self.projection = Some(projection);
        self.refresh_cursor(doc);
        let undo = UndoManager::new(doc.inner());
        undo.set_max_undo_steps(100);
        undo.set_merge_interval(0);
        undo.add_exclude_origin_prefix("history-");
        self.history_selection = history::HistorySelection::default();
        self.history_selection.install(&undo);
        self.undo = Some(undo);
        self.tracker = MergeTracker::new(self.config.delay_ms, HistoryTime(now.mono.0));
        self.group_active = false;
        self.item_started = None;
        self.availability = HistoryAvailability::default();
        // Initialization's ClearHistory boundary makes the manager ready for user edits.
        self.history_ready = true;
        drop(load_guard);
        let _view = tracing::info_span!("view.initialize").entered();
        // A full patch is generated from an empty editor in the same registry.
        let mut empty = Self::builder(&self.config, self.config.mode, doc.peer_id()).build()?;
        let (_, mut commit) = empty.update(|_| Ok(()))?;
        commit.next = self.core.state().clone();
        commit.full_reconcile = true;
        let diff = commit.diff(&DiffOptions::default())?;
        view.push(ViewEffect::Initialize(InitialView::Editor {
            diff,
            state: self.core.state().to_json()?,
        }));
        Ok(())
    }
    pub(crate) fn resync(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        let _span =
            tracing::warn_span!("doc.projection.resync", error.kind = "projection").entered();
        let cursor = self.cursor.clone();
        let mut undo = self.undo.take();
        if let Some(undo) = &mut undo {
            undo.group_end();
        }
        doc.commit_with(
            loro::CommitOptions::new()
                .origin(FIXUP_ORIGIN)
                .timestamp(now.wall.0 / 1000),
        );
        self.init(doc, now, access, view)?;
        self.undo = undo;
        self.cursor = cursor;
        self.remote_pending(doc, now, access, view, false)?;
        self.history_changed(view);
        self.resynced = true;
        Ok(())
    }
    /// Complete view patch relative to an empty editor, without changing state.
    pub fn view_diff(&self) -> Result<Diff, SessionError> {
        let mut empty = Self::builder(&self.config, self.config.mode, 0).build()?;
        let (_, mut commit) = empty.update(|_| Ok(()))?;
        commit.next = self.core.state().clone();
        commit.full_reconcile = true;
        Ok(commit.diff(&DiffOptions::default())?)
    }
    fn history_changed(&mut self, view: &mut Vec<ViewEffect>) {
        if let Some(undo) = &self.undo {
            let next = HistoryAvailability {
                can_undo: undo.can_undo(),
                can_redo: undo.can_redo(),
            };
            if next != self.availability {
                self.availability = next;
                view.push(ViewEffect::Editor(Effect::HistoryState(next)));
            }
        }
    }
    fn group(&mut self, commits: &[Commit], now: HistoryTime) -> Result<usize, SessionError> {
        let Some(undo) = &mut self.undo else {
            return Ok(0);
        };
        let count = undo.undo_count();
        if !self.history_ready {
            return Ok(count);
        }
        for commit in commits {
            if commit.changes.is_empty() && commit.prev.selection() == commit.next.selection() {
                continue;
            }
            if commit.tags.contains(&UpdateTag::Historic)
                || commit.tags.contains(&UpdateTag::Collaboration)
                || commit
                    .tags
                    .contains(&UpdateTag::Custom("collab-selection".into()))
            {
                continue;
            }
            let mut action = self.tracker.classify(commit, now);
            if action == HistoryAction::Push
                && self
                    .item_started
                    .is_some_and(|started| now.0 < started.0.saturating_add(self.config.delay_ms))
            {
                action = HistoryAction::Merge;
            }
            match action {
                HistoryAction::Push => {
                    undo.group_end();
                    self.group_active = undo.group_start().is_ok();
                }
                HistoryAction::Merge if !self.group_active => {
                    self.group_active = undo.group_start().is_ok();
                }
                _ => {}
            }
        }
        Ok(count)
    }
    pub(crate) fn apply(
        &mut self,
        doc: &LoroDoc,
        input: Input,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        self.handled = Handled::No;
        let cold_span = match &input {
            Input::SetState { .. } => Some(tracing::info_span!(
                "editor.set_state",
                outcome = tracing::field::Empty
            )),
            Input::Command {
                command: Command::Paste(payload),
                ..
            } => Some(tracing::info_span!(
                "editor.paste",
                bytes = payload.data.values().map(String::len).sum::<usize>(),
                outcome = tracing::field::Empty
            )),
            _ => None,
        };
        let _cold_guard = cold_span.as_ref().map(tracing::Span::enter);
        if !self.focus_known {
            match &input {
                Input::SelectionFromView {
                    selection: ViewSelection::None,
                    ..
                } => self.focused = false,
                Input::SelectionFromView { selection, .. } | Input::Command { selection, .. }
                    if !matches!(selection, ViewSelection::KeepModel | ViewSelection::None) =>
                {
                    self.focused = true
                }
                Input::TextFromView { .. }
                | Input::TextDeltaFromView(_)
                | Input::InsertTextEvent { .. }
                | Input::Composition { .. } => self.focused = true,
                _ => {}
            }
        }
        let history = match &input {
            Input::Undo
            | Input::Command {
                command: Command::Undo,
                ..
            } => Some(false),
            Input::Redo
            | Input::Command {
                command: Command::Redo,
                ..
            } => Some(true),
            _ => None,
        };
        if let Some(redo) = history {
            return self.navigate_history(doc, redo, now, access, view);
        }

        let clear = matches!(
            input,
            Input::Command {
                command: Command::ClearHistory | Command::ClearEditor,
                ..
            }
        );
        if matches!(
            input,
            Input::Command {
                command: Command::ClearHistory,
                ..
            }
        ) {
            if let Some(undo) = &self.undo {
                undo.clear();
            }
            self.group_active = false;
            self.item_started = None;
            self.history_ready = true;
            self.handled = Handled::Yes;
            self.tracker = MergeTracker::new(self.config.delay_ms, HistoryTime(now.mono.0));
            self.history_changed(view);
            return Ok(false);
        }
        let routed_history = match &input {
            Input::KeyDown {
                routed: Some(Command::Undo),
                ..
            } => Some(false),
            Input::KeyDown {
                routed: Some(Command::Redo),
                ..
            } => Some(true),
            _ => None,
        };
        self.history_selection.prepare(self.selection_cursors());
        let result = self.core.apply(input, HistoryTime(now.mono.0));
        // Run KeyDown and routed command listeners through the model first. Its
        // snapshot history is disabled here; only an unhandled successful route
        // falls through to collaborative history, after its commits are projected.
        let routed_history = routed_history.filter(|_| {
            result
                .as_ref()
                .is_ok_and(|output| output.handled == Handled::No)
        });
        let commits: &[Commit] = match &result {
            Ok(out) => &out.commits,
            Err(error) => &error.committed,
        };
        if let Ok(output) = &result
            && let Some(selection) = &output.installed_selection
        {
            self.history_selection
                .prepare(selection.as_ref().and_then(|selection| {
                    let previous = commits
                        .first()
                        .map_or(self.core.state(), |commit| &commit.prev);
                    self.projection.as_ref()?.cursor(doc, previous, selection)
                }));
        }
        let count = self.group(commits, HistoryTime(now.mono.0))?;
        #[cfg(feature = "test-faults")]
        let fault = if std::mem::take(&mut self.wrong_next_type) {
            self.prepare_projection_type_write(doc)?
        } else {
            None
        };
        let changed = if access == Access::Edit && !commits.is_empty() && self.projection.is_some()
        {
            let projection = self.projection.as_mut().ok_or(SessionError::NotReady)?;
            let projected = if self
                .undo
                .as_ref()
                .is_some_and(|undo| undo.accepts_projected_checkpoint(LOCAL_ORIGIN))
            {
                projection.local_commit_without_events(doc, commits, now.wall.0 / 1000)?
            } else {
                projection.local_commit(doc, commits, LOCAL_ORIGIN, now.wall.0 / 1000)?
            };
            if projected.events_suppressed && projected.changed {
                self.undo
                    .as_ref()
                    .ok_or(SessionError::NotReady)?
                    .record_projected_checkpoint()?;
            }
            projected.changed
        } else {
            false
        };
        #[cfg(feature = "test-faults")]
        if changed && let Some(fault) = fault {
            self.inject_projection_type_write(doc, fault)?;
        }
        if self.undo.as_ref().is_some_and(|u| u.undo_count() > count) {
            self.item_started = Some(HistoryTime(now.mono.0));
        }
        if clear {
            if let Some(undo) = &mut self.undo {
                undo.group_end();
                undo.clear();
            }
            self.group_active = false;
            self.item_started = None;
            self.tracker = MergeTracker::new(self.config.delay_ms, HistoryTime(now.mono.0));
            self.history_ready = true;
        }
        let failed = result.is_err();
        match result {
            Ok(output) => {
                self.handled = output.handled;
                Self::output(output, view);
            }
            Err(error) => {
                if let (Some(first), Some(last)) = (error.committed.first(), error.committed.last())
                {
                    let mut chain = first.clone();
                    chain.next = last.next.clone();
                    chain.full_reconcile = true;
                    view.push(ViewEffect::Diff(chain.diff(&DiffOptions::default())?));
                }
                view.push(ViewEffect::Error(SessionError::Model(error.error)));
            }
        }
        self.refresh_cursor(doc);
        if changed && let Some(undo) = &self.undo {
            self.history_selection
                .record_after(undo, self.selection_cursors());
        }
        self.history_changed(view);
        if let Some(span) = &cold_span {
            span.record("outcome", if failed { "error" } else { "ok" });
        }
        if let Some(redo) = routed_history {
            return Ok(self.navigate_history(doc, redo, now, access, view)? || changed);
        }
        Ok(changed)
    }
    #[cold]
    fn navigate_history(
        &mut self,
        doc: &LoroDoc,
        redo: bool,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<bool, SessionError> {
        self.handled = Handled::Yes;
        let undo = self.undo.as_mut().ok_or(SessionError::NotReady)?;
        undo.group_end();
        self.group_active = false;
        self.item_started = None;
        let meta = if redo {
            undo.top_redo_meta()
        } else {
            undo.top_undo_meta()
        };
        self.history_selection.begin(doc, meta.as_ref());
        let end = doc.oplog_vv().get(&doc.peer_id()).copied().unwrap_or(0);
        let ops = meta
            .and_then(|meta| {
                history::start(&meta).map(|start| i64::from(end).saturating_sub(start))
            })
            .unwrap_or(0);
        let span = if redo || ops > 100 {
            Some(if redo {
                tracing::info_span!(
                    "editor.redo",
                    ops,
                    history.applied = tracing::field::Empty,
                    outcome = tracing::field::Empty
                )
            } else {
                tracing::info_span!(
                    "editor.undo",
                    ops,
                    history.applied = tracing::field::Empty,
                    outcome = tracing::field::Empty
                )
            })
        } else {
            None
        };
        let _guard = span.as_ref().map(tracing::Span::enter);
        #[cfg(feature = "conformance")]
        let before_undo = crate::observation::visible_ids(doc);
        let changed = {
            let phase = span
                .as_ref()
                .map(|_| tracing::info_span!("editor.history.loro"));
            let _phase = phase.as_ref().map(tracing::Span::enter);
            let result = if redo { undo.redo() } else { undo.undo() };
            if result.is_err() {
                self.history_selection.applied();
            }
            let changed = result?;
            self.history_selection.finish(undo, redo);
            changed
        };
        if let Some(span) = &span {
            span.record("history.applied", changed);
        }
        if changed {
            #[cfg(feature = "conformance")]
            {
                let removed = match (before_undo, crate::observation::visible_ids(doc)) {
                    (Ok(before), Ok(after)) => Ok(before.difference(&after).copied().collect()),
                    (Err(error), _) | (_, Err(error)) => Err(error.to_string()),
                };
                self.undo_applied
                    .push(crate::UndoObservation { redo, removed });
            }
            let phase = span
                .as_ref()
                .map(|_| tracing::info_span!("editor.history.apply"));
            let _phase = phase.as_ref().map(tracing::Span::enter);
            self.remote_pending(doc, now, access, view, true)?;
        }
        if !changed {
            self.history_selection.applied();
        }
        if let Some(span) = &span {
            span.record("outcome", "ok");
        }
        self.history_changed(view);
        Ok(changed)
    }
    fn refresh_cursor(&mut self, doc: &LoroDoc) {
        self.cursor = self.projection.as_ref().and_then(|p| {
            self.core
                .state()
                .selection()
                .and_then(|selection| p.cursor(doc, self.core.state(), selection))
        });
    }
    fn output(output: Output, view: &mut Vec<ViewEffect>) {
        let mut tags = Vec::new();
        for tag in output.commits.iter().flat_map(|commit| commit.tags.iter()) {
            let tag = tag.to_string();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        if !tags.is_empty() {
            view.push(ViewEffect::CommitTags(tags));
        }

        for effect in &output.effects {
            if let Effect::FollowUpFailed { plugin, kind, .. } = effect {
                tracing::error!(
                    plugin = *plugin,
                    error.kind = *kind,
                    "editor follow-up failed"
                );
            }
        }
        if !output.diff.ops.is_empty() {
            view.push(ViewEffect::Diff(output.diff));
        }
        view.extend(
            output
                .effects
                .into_iter()
                .filter(|effect| !matches!(effect, Effect::RemoteNodesCreated(_)))
                .map(ViewEffect::Editor),
        );
    }
    pub(crate) fn remote_pending(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
        historic: bool,
    ) -> Result<bool, SessionError> {
        let popped = historic
            .then(|| self.history_selection.take_popped())
            .flatten();
        #[cfg(test)]
        if std::mem::take(&mut self.fail_next_remote) {
            return Err(lexical_loro::ProjectionError::Diverged {
                detail: "injected stale projection".into(),
            }
            .into());
        }
        if self.projection.is_none() {
            self.init(doc, now, access, view)?;
            return Ok(false);
        }
        let cursors = self.selection_cursors();
        let projection = self.projection.as_mut().ok_or(SessionError::NotReady)?;
        let changes = projection.take_remote(doc, self.core.state())?;
        let mut tags = TagSet::from_tags([
            UpdateTag::Collaboration,
            UpdateTag::Custom("from-loro".into()),
        ]);
        if historic {
            tags.insert(UpdateTag::Historic);
        }
        if !self.focused {
            tags.insert(UpdateTag::SkipDomSelection);
        }
        let output = self
            .core
            .apply(
                Input::ApplyRemote {
                    changes: changes.changes.clone(),
                    options: UpdateOptions {
                        skip_transforms: false,
                        tags,
                    },
                },
                HistoryTime(now.mono.0),
            )
            .map_err(|error| SessionError::Model(error.error))?;
        let created = output
            .effects
            .iter()
            .find_map(|effect| {
                if let Effect::RemoteNodesCreated(created) = effect {
                    Some(created.as_slice())
                } else {
                    None
                }
            })
            .unwrap_or(&[]);
        projection.bind_created(changes, created)?;
        let changed = if access == Access::Edit {
            projection
                .local_commit(doc, &output.commits, FIXUP_ORIGIN, now.wall.0 / 1000)?
                .changed
        } else {
            false
        };
        Self::output(output, view);
        if popped.as_ref().is_some_and(Vec::is_empty) {
            let input = if self.config.mode == EditorMode::Headless {
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(
                        &builder::RESTORE_MODEL_SELECTION,
                        None,
                    )),
                    selection: ViewSelection::KeepModel,
                }
            } else {
                Input::SelectionFromView {
                    selection: ViewSelection::None,
                    change: None,
                }
            };
            let output = self
                .core
                .apply(input, HistoryTime(now.mono.0))
                .map_err(|error| SessionError::Model(error.error))?;
            Self::output(output, view);
            if self.focused {
                view.push(ViewEffect::Editor(Effect::SetViewSelection {
                    selection: ViewSelection::None,
                    format: TextFormat::empty(),
                    style: Arc::from(""),
                }));
            }
        }
        let points = if let Some(cursors) = &popped {
            cursors.first().zip(cursors.get(1)).map(|(anchor, focus)| {
                (
                    projection.history_point(doc, self.core.state(), anchor),
                    projection.history_point(doc, self.core.state(), focus),
                )
            })
        } else {
            cursors.as_ref().map(|cursors| {
                (
                    projection.point(doc, self.core.state(), &cursors.anchor),
                    projection.point(doc, self.core.state(), &cursors.focus),
                )
            })
        };
        if let Some((Some(anchor), Some(focus))) = points {
            let input = if self.config.mode == EditorMode::Headless {
                Input::Command {
                    command: Command::Extension(ExtensionCommand::new(
                        &builder::RESTORE_MODEL_SELECTION,
                        Some(RangeSelection::new(anchor, focus)),
                    )),
                    selection: ViewSelection::KeepModel,
                }
            } else {
                Input::SelectionFromView {
                    selection: ViewSelection::Range {
                        anchor,
                        focus,
                        resolution_dirty: false,
                    },
                    change: None,
                }
            };
            let output = self
                .core
                .apply(input, HistoryTime(now.mono.0))
                .map_err(|error| SessionError::Model(error.error))?;
            Self::output(output, view);
            // SelectionFromView says the host already installed its input. Here it
            // only restores the model, so explicitly deliver the final cursor to a focused view.
            if self.focused {
                let range = self.core.state().selection().and_then(Selection::as_range);
                view.push(ViewEffect::Editor(Effect::SetViewSelection {
                    selection: ViewSelection::Range {
                        anchor,
                        focus,
                        resolution_dirty: false,
                    },
                    format: range.map_or(TextFormat::empty(), |range| range.format),
                    style: range.map_or_else(|| Arc::from(""), |range| range.style.clone()),
                }));
            }
        }
        self.history_selection.applied();
        self.refresh_cursor(doc);
        self.history_changed(view);
        Ok(changed)
    }
}

#[cfg(test)]
mod selection_test;

#[cfg(test)]
mod routed_history_test;

#[cfg(test)]
mod identity_test;

#[cfg(test)]
mod id_state_test;
