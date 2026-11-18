//! Editor composition and collaborative history.
use crate::{InitialView, SessionError, ViewEffect};
use doc_sync_core::{Access, Now};
use lexical_loro::{FIXUP_ORIGIN, LOCAL_ORIGIN, LoroProjection, PlainPolicy, SyncPolicy};
use lexical_model::*;
use loro::LoroDoc;
use loro_internal::undo::UndoManager;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
mod apply;
mod browser_history;
mod builder;
pub(crate) mod reported_errors;
pub use reported_errors::ReportedModelErrorObserver;
mod history;
#[cfg(feature = "application")]
mod metadata;
#[cfg(feature = "application")]
mod reconcile_ids;
#[cfg(feature = "application")]
pub(crate) use builder::with_session_plugins_excluding_root;
pub use builder::{
    default_editor_builder, register_editor_commands, with_session_plugins,
    with_session_plugins_with_id_state,
};
static PLAIN: PlainPolicy = PlainPolicy;
/// Tag on the update that restores a selection from history awareness; it is
/// never a history entry of its own.
const COLLAB_SELECTION_TAG: &str = "collab-selection";

/// History grouping time. Source's merge rule and Loro's merge interval both read Date.now
/// (collaboration/undo.ts getMergeAction, `changeTime < prevChangeTime + delay`), so a
/// backwards wall jump merges there as it does here, and only the wall clock decides.
fn history_time(now: Now) -> Result<HistoryTime, SessionError> {
    u64::try_from(now.wall.0)
        .map(HistoryTime)
        .map_err(|_| SessionError::Configuration("wall clock is before the Unix epoch"))
}

/// Outcome of rebuilding the editor from the document.
pub(super) enum Attached {
    /// An empty document opened without edit access; Initialize is already queued.
    EmptyRead,
    /// Attached and ready; the application load follow-up may run.
    Ready {
        /// The metadata plugin requested its upgrade during initialization.
        #[cfg(feature = "application")]
        upgrade: bool,
    },
}

/// Annotation constructor supplied by the editor's application registry.
pub type CommentNodeFactory = fn(&mut Transaction<'_>, Vec<String>) -> Result<NodeKey, Error>;

/// Rebuildable editor configuration shared by live editors and comment forks.
#[derive(Clone)]
pub struct EditorConfig {
    /// Internal clipboard namespace shared by copy and rich paste.
    pub namespace: String,
    /// Registry and plugins, built anew for every document instance.
    pub builder: Arc<dyn Fn(EditorMode, u64) -> EditorBuilder + Send + Sync>,
    /// Create an annotation wrapper inside the isolated staging transaction.
    pub comment_node: CommentNodeFactory,
    /// Application projection exclusions.
    pub policy: &'static dyn SyncPolicy,
    /// View-state selection; full-state mode retains its existing precedence.
    pub diff: DiffOptions,
    /// Live model mode; comment staging always uses Headless.
    pub mode: EditorMode,
    /// Platform selection policy.
    pub view_host: ViewHost,
    /// Follow browser collaboration awareness when applying Loro history.
    pub browser_history_awareness: bool,
    /// Collaborative history merge interval on the host-provided clocks.
    pub delay_ms: u64,
    /// Newer nonempty stored documents are rejected before projection or readiness.
    /// Generic surfaces leave this unset; the application body pins its schema counter.
    pub max_document_version: Option<f64>,
    /// Trusted application commands that change only local policy-excluded state.
    pub local_commands: &'static [CommandKind],
}
impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            namespace: builder::DEFAULT_NAMESPACE.into(),
            builder: Arc::new(default_editor_builder),
            comment_node: lexical_rich_nodes::mark::create_mark_node,
            policy: &PLAIN,
            diff: DiffOptions::default(),
            mode: EditorMode::ViewAttached,
            view_host: ViewHost {
                engine: ViewEngine::Native,
                os: ViewOs::Other,
            },
            browser_history_awareness: false,
            delay_ms: 400,
            max_document_version: None,
            local_commands: &[],
        }
    }
}
/// EditorCore, indexed projection and Loro-owned collaborative history.
pub struct EditorSurface {
    pub(crate) config: EditorConfig,
    pub(crate) reported_errors: Option<Arc<dyn ReportedModelErrorObserver>>,
    pub(crate) follow_up_errors: Option<Arc<reported_errors::Capture>>,
    pub(crate) core: EditorCore,
    #[cfg(feature = "application")]
    pub(crate) checklist:
        macro_document_model::plugins_group_b::checklist_updates::ChecklistProducer,
    pub(crate) projection: Option<LoroProjection>,
    undo: Option<UndoManager>,
    tracker: MergeTracker,
    history_selection: history::HistorySelection,
    group_active: bool,
    history_ready: bool,
    pub(crate) focused: bool,
    pub(crate) focus_known: bool,
    pub(crate) resynced: bool,
    history_clock: Arc<AtomicI64>,
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
    #[cfg(test)]
    pub(crate) fail_after_next_local_commit: bool,
    // Only the application load refresh reads it.
    #[cfg(all(feature = "test-faults", feature = "application"))]
    pub(crate) fail_load_refresh_after_writes: Option<usize>,
}
impl EditorSurface {
    /// Project only actual input-prefix facts, independently of model publication.
    fn failed_dom_disposition(error: &ApplyError, view: &mut Vec<ViewEffect>) {
        let disposition = error.dom_disposition;
        if !disposition.is_empty() {
            view.push(ViewEffect::Editor(Effect::InputDomDisposition(disposition)));
        }
        // Older hosts retain actual prevention even without the new stop channel.
        if disposition.default_prevented {
            view.push(ViewEffect::Editor(Effect::PreventDefault));
        }
    }
    pub(crate) fn new(config: EditorConfig, peer: u64, now: Now) -> Result<Self, SessionError> {
        let time = history_time(now)?;
        i64::try_from(config.delay_ms)
            .map_err(|_| SessionError::Configuration("history delay exceeds i64 milliseconds"))?;
        let editor = Self::builder(&config, config.mode, peer).build()?;
        Ok(Self {
            core: Self::core(editor, config.diff),
            reported_errors: None,
            follow_up_errors: None,
            #[cfg(feature = "application")]
            checklist: Default::default(),
            projection: None,
            undo: None,
            tracker: MergeTracker::new(config.delay_ms, time),
            config,
            history_selection: history::HistorySelection::default(),
            group_active: false,
            history_ready: false,
            focused: false,
            focus_known: false,
            resynced: false,
            history_clock: Arc::new(AtomicI64::new(now.wall.0)),
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
            #[cfg(test)]
            fail_after_next_local_commit: false,
            #[cfg(all(feature = "test-faults", feature = "application"))]
            fail_load_refresh_after_writes: None,
        })
    }
    pub(crate) fn builder(config: &EditorConfig, mode: EditorMode, peer: u64) -> EditorBuilder {
        let builder = (config.builder)(mode, peer)
            .extension_state(builder::ClipboardNamespace(config.namespace.clone()))
            .view_host(config.view_host)
            .opaque_unknown_types(true);
        if mode == EditorMode::Headless {
            builder.plugin(builder::RestoreModelSelection)
        } else if config.browser_history_awareness {
            builder.plugin(builder::RestoreHistoryAwareness)
        } else {
            builder
        }
    }
    fn core(editor: Editor, diff: DiffOptions) -> EditorCore {
        EditorCore::new(
            editor,
            CoreConfig {
                history: None,
                editable: true,
                diff,
                track_text_content: false,
            },
        )
    }
    pub(crate) fn clear_binding(&mut self) {
        #[cfg(feature = "application")]
        self.checklist.clear();
        self.projection = None;
        self.undo = None;
    }
    #[cfg(feature = "application")]
    pub(crate) fn accept_checklist_facts(
        &mut self,
        revision: &macro_document_model::plugins_group_b::checklist_facts::FactsRevision,
    ) -> Result<(), SessionError> {
        self.checklist.accept(revision, self.core.state())?;
        self.handled = Handled::Yes;
        Ok(())
    }
    /// True delegates to the existing Edit writer; false completes metadata-only input.
    #[cfg(feature = "application")]
    pub(crate) fn prepare_checklist_settings(
        &mut self,
        intent: &macro_document_model::plugins_group_b::checklist_presentation::SettingsIntent,
        access: Access,
        ready: bool,
    ) -> Result<bool, SessionError> {
        self.handled = Handled::No;
        if !ready {
            return Err(SessionError::NotReady);
        }
        if !self
            .checklist
            .accepts_presentation(intent, self.core.state())?
        {
            return Ok(false);
        }
        if access != Access::Edit {
            self.checklist.set_presentation(intent, self.core.state())?;
            self.handled = Handled::Yes;
            return Ok(false);
        }
        Ok(true)
    }
    /// The configured internal clipboard namespace, shared by all host exports.
    pub fn namespace(&self) -> &str {
        &self.config.namespace
    }
    /// Immutable model snapshot used by the view and synchronous queries.
    pub fn state(&self) -> &EditorState {
        self.core.state()
    }
    /// Preview/test-only stored comparison for this surface's current state and policy.
    #[cfg(feature = "dev-probes")]
    pub fn stored_comparison(&self) -> Result<SerializedEditorState, SessionError> {
        Ok(lexical_loro::stored_comparison(
            self.core.state(),
            self.config.policy,
        )?)
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
    /// Rebuild the editor and projection from the document and arm a fresh history.
    pub(super) fn attach_editor(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<Attached, SessionError> {
        let time = history_time(now)?;
        let interval = i64::try_from(self.config.delay_ms)
            .map_err(|_| SessionError::Configuration("history delay exceeds i64 milliseconds"))?;
        self.history_clock.store(now.wall.0, Ordering::Relaxed);
        let load = tracing::info_span!(
            "state.load",
            peer = doc.peer_id(),
            stored_drift.rescanned = tracing::field::Empty,
            stored_drift.drifted = tracing::field::Empty
        );
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
        let newer_version = self.config.max_document_version.is_some_and(|maximum| {
            state
                .root
                .get("children")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|children| !children.is_empty())
                && state
                    .root
                    .get("$")
                    .and_then(|fields| fields.get("documentMetadata"))
                    .and_then(|metadata| metadata.get("version"))
                    .and_then(serde_json::Value::as_f64)
                    .is_some_and(|version| version > maximum)
        });
        // Even an empty document runs build-time hooks and drains their output.
        self.core = Self::core(
            Self::builder(&self.config, self.config.mode, doc.peer_id())
                .initial_state(state)
                .build()?,
            self.config.diff,
        );
        // Source installs its parsed state locally, then rejects the load before
        // startSync/readiness. Keep that read-only presentation without attaching
        // projection or history; no rejected load may write or export local changes.
        if newer_version {
            self.group_active = false;
            self.history_ready = false;
            self.availability = HistoryAvailability::default();
            self.cursor = None;
            self.core.set_editable(false);
            view.push(ViewEffect::Initialize(InitialView::Editor {
                diff: self.view_diff()?,
                state: self.core.state().to_json()?,
            }));
            return Err(SessionError::VersionMismatch);
        }
        if let Some(capture) = &self.follow_up_errors {
            capture.clear();
            self.core.observe_follow_up_errors(capture.clone());
        }
        #[cfg(feature = "application")]
        self.checklist.clear();
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
            return Ok(Attached::EmptyRead);
        }
        let mut projection = if cleanup {
            lexical_loro::mirror::set_synced_editor_state(
                doc,
                self.core.state(),
                self.config.policy,
            )?;
            LoroProjection::attach(doc, self.core.state(), self.config.policy)?
        } else if has_root {
            LoroProjection::attach(doc, base, self.config.policy)?
        } else {
            LoroProjection::initialize(doc, base, self.config.policy, now.wall.0 / 1000)?
        };
        #[cfg(feature = "application")]
        let upgrade = initial
            .as_ref()
            .is_some_and(|output| Self::requests_metadata_upgrade(&output.effects));
        if let Some(output) = initial {
            if access == Access::Edit && !cleanup {
                projection.local_commit(doc, &output.commits, LOCAL_ORIGIN, now.wall.0 / 1000)?;
            }
            // Read/comment-only editors may retain unsynced hook fields (S11 §4.6).
            // Keep the index attached to the persisted base; do not write those fields.

            view.extend(output.effects.into_iter().map(ViewEffect::Editor));
        }
        // Source's setEditorState is not synced: stored values its import normalizes are
        // rewritten by the first later local projection (the load refresh on writable opens).
        let scan = projection.note_stored_drift(doc, self.core.state())?;
        load.record("stored_drift.rescanned", scan.rescanned);
        load.record("stored_drift.drifted", scan.drifted);
        self.projection = Some(projection);
        self.refresh_cursor(doc);
        let undo = UndoManager::new(doc.inner());
        undo.set_max_undo_steps(100);
        let clock = self.history_clock.clone();
        undo.set_time_source(Some(Arc::new(move || clock.load(Ordering::Relaxed))));
        undo.set_merge_interval(interval);
        undo.add_exclude_origin_prefix("history-");
        self.history_selection = history::HistorySelection::default();
        self.history_selection.install(&undo);
        self.undo = Some(undo);
        self.tracker = MergeTracker::new(self.config.delay_ms, time);
        self.group_active = false;
        self.availability = HistoryAvailability::default();
        // Initialization's ClearHistory boundary makes the manager ready for user edits.
        self.history_ready = true;
        drop(load_guard);
        Ok(Attached::Ready {
            #[cfg(feature = "application")]
            upgrade,
        })
    }
    pub(crate) fn init(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        let _open = tracing::info_span!("editor.open", peer = doc.peer_id()).entered();
        let attached = self.attach_editor(doc, now, access, view)?;
        let Attached::Ready {
            #[cfg(feature = "application")]
            upgrade,
        } = attached
        else {
            return Ok(());
        };
        // Source's first node-mutating update after load queues the history-merge
        // metadata upgrade. Its sync writes derived root search text, then the version:
        // two local commits in one undo group, after the initial content.
        #[cfg(feature = "application")]
        if access == Access::Edit {
            // Initialize carries the upgraded state; only failures reach the view.
            let mut upgrade_view = Vec::new();
            self.load_follow_up(doc, now, upgrade, &mut upgrade_view)?;
            view.extend(upgrade_view.into_iter().filter(|effect| {
                matches!(effect, ViewEffect::Editor(Effect::FollowUpFailed { .. }))
            }));
        }
        let _view = tracing::info_span!("view.initialize").entered();
        // A full patch is generated from an empty editor in the same registry.
        let mut empty = Self::builder(&self.config, self.config.mode, doc.peer_id()).build()?;
        let (_, mut commit) = empty.update(|_| Ok(()))?;
        commit.next = self.core.state().clone();
        commit.full_reconcile = true;
        let diff = commit.diff(&self.config.diff)?;
        view.push(ViewEffect::Initialize(InitialView::Editor {
            diff,
            state: self.core.state().to_json()?,
        }));
        self.history_changed(view);
        Ok(())
    }
    pub(crate) fn resync(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
    ) -> Result<(), SessionError> {
        self.history_clock.store(now.wall.0, Ordering::Relaxed);
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
        // The restored manager's push/pop callbacks write to the selection
        // store installed with it, not the fresh one `init` installs.
        let selection = self.history_selection.clone();
        self.init(doc, now, access, view)?;
        if let Some(undo) = undo {
            self.undo = Some(undo);
            self.history_selection = selection;
        }
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
        Ok(commit.diff(&self.config.diff)?)
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
    fn group(&mut self, commits: &[Commit], now: HistoryTime) -> Result<(), SessionError> {
        let Some(undo) = &mut self.undo else {
            return Ok(());
        };
        if !self.history_ready {
            return Ok(());
        }
        for commit in commits {
            if commit.changes.is_empty() && commit.prev.selection() == commit.next.selection() {
                continue;
            }
            if commit.tags.contains(&UpdateTag::Historic)
                || commit.tags.contains(&UpdateTag::Collaboration)
                || commit
                    .tags
                    .contains(&UpdateTag::Custom(COLLAB_SELECTION_TAG.into()))
            {
                continue;
            }
            let action = self.tracker.classify(commit, now);
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
        Ok(())
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
        self.history_clock.store(now.wall.0, Ordering::Relaxed);
        self.handled = Handled::Yes;
        let undo = self.undo.as_mut().ok_or(SessionError::NotReady)?;
        undo.group_end();
        self.group_active = false;
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
        // Source's localCursorUpdate is the only local awareness writer and
        // returns when there is no selection or no cursor for it: a table, node
        // or null selection, or a range point outside Loro (cursor.ts:84,
        // CollabProvider.tsx:291, :303). Awareness and presence keep the
        // previous value then. Native converts tables, so they are skipped here.
        let selection = self.core.state().selection();
        if selection.is_some_and(Selection::is_table) {
            return;
        }
        if let Some(cursor) = self.projection.as_ref().and_then(|p| {
            selection.and_then(|selection| p.cursor(doc, self.core.state(), selection))
        }) {
            self.cursor = Some(cursor);
        }
    }
    fn output(
        output: Output,
        view: &mut Vec<ViewEffect>,
        #[cfg(feature = "application")]
        checklist: &mut macro_document_model::plugins_group_b::checklist_updates::ChecklistProducer,
        observer: Option<&dyn ReportedModelErrorObserver>,
        capture: Option<&reported_errors::Capture>,
    ) {
        let failures = capture
            .map(reported_errors::Capture::take)
            .unwrap_or_default();
        #[cfg(feature = "application")]
        checklist.observe(&output.commits);
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
        if !output.diff.ops.is_empty() || !output.diff.decorator_renders.is_empty() {
            view.push(ViewEffect::Diff(output.diff));
        }
        let mut failures = failures.into_iter().peekable();
        for (index, effect) in output.effects.into_iter().enumerate() {
            if matches!(effect, Effect::RemoteNodesCreated(_)) {
                continue;
            }
            if failures
                .peek()
                .is_some_and(|(reported, _)| *reported == index)
                && let Some((_, cause)) = failures.next()
                && let Some(observer) = observer
            {
                observer.reported(cause.as_ref(), view.len());
            }
            view.push(ViewEffect::Editor(effect));
        }
    }
    pub(crate) fn remote_pending(
        &mut self,
        doc: &LoroDoc,
        now: Now,
        access: Access,
        view: &mut Vec<ViewEffect>,
        historic: bool,
    ) -> Result<bool, SessionError> {
        let time = history_time(now)?;
        self.history_clock.store(now.wall.0, Ordering::Relaxed);
        let browser_history = (historic && self.config.browser_history_awareness)
            .then(|| browser_history::AwarenessSelection::capture(self));
        let popped = historic
            .then(|| self.history_selection.take_popped())
            .flatten()
            .filter(|_| browser_history.is_none());
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
        // Source restores the local awareness after every from-Loro update,
        // whatever the model selection (CollabProvider.tsx:243-262).
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
        if browser_history.is_some() || !self.focused {
            tags.insert(UpdateTag::SkipDomSelection);
        }
        if let Some(capture) = &self.follow_up_errors {
            capture.clear();
        }
        let apply = Input::ApplyRemote {
            changes: changes.changes.clone(),
            options: UpdateOptions {
                skip_transforms: false,
                tags,
            },
        };
        let input = if browser_history.is_some() {
            Input::Batch(vec![
                Input::SelectionFromView {
                    selection: ViewSelection::None,
                    change: None,
                },
                apply,
            ])
        } else {
            apply
        };
        let output = self.core.apply(input, time).map_err(|error| {
            Self::failed_dom_disposition(&error, view);
            #[cfg(feature = "application")]
            self.checklist.observe(&error.committed);
            SessionError::Model(error.error)
        })?;
        #[cfg(feature = "application")]
        {
            self.checklist.remote_applied();
            self.checklist.observe(&output.commits);
        }
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
        // The import's own-map diffs include stored values that normalize away; created
        // nodes get theirs from the incoming maps.
        let touched: Vec<NodeKey> = changes
            .touched
            .iter()
            .copied()
            .chain(created.iter().map(|(_, key)| *key))
            .collect();
        projection.bind_created(changes, created)?;
        let rescan = tracing::debug_span!(
            "doc.stored_drift.rescan",
            touched = touched.len(),
            rescanned = tracing::field::Empty,
            drifted = tracing::field::Empty
        );
        let scan = rescan
            .in_scope(|| projection.note_stored_drift_for(doc, self.core.state(), touched))?;
        rescan.record("rescanned", scan.rescanned);
        rescan.record("drifted", scan.drifted);
        let changed = if access == Access::Edit {
            projection
                .local_commit(doc, &output.commits, FIXUP_ORIGIN, now.wall.0 / 1000)?
                .changed
        } else {
            false
        };
        Self::output(
            output,
            view,
            #[cfg(feature = "application")]
            &mut self.checklist,
            self.reported_errors.as_deref(),
            self.follow_up_errors.as_deref(),
        );
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
            if let Some(capture) = &self.follow_up_errors {
                capture.clear();
            }
            let output = self.core.apply(input, time).map_err(|error| {
                Self::failed_dom_disposition(&error, view);
                #[cfg(feature = "application")]
                self.checklist.observe(&error.committed);
                SessionError::Model(error.error)
            })?;
            Self::output(
                output,
                view,
                #[cfg(feature = "application")]
                &mut self.checklist,
                self.reported_errors.as_deref(),
                self.follow_up_errors.as_deref(),
            );
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
        #[cfg(feature = "application")]
        let changed = self.reconcile_root_id(doc, now, access, view)? || changed;
        if let Some(awareness) = browser_history {
            self.publish_browser_history_selection(view, None);
            return self
                .restore_browser_history_selection(
                    doc,
                    points.and_then(|(anchor, focus)| anchor.zip(focus)),
                    awareness,
                    now,
                    view,
                )
                .map(|()| changed);
        }
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
            if let Some(capture) = &self.follow_up_errors {
                capture.clear();
            }
            let output = self.core.apply(input, time).map_err(|error| {
                Self::failed_dom_disposition(&error, view);
                #[cfg(feature = "application")]
                self.checklist.observe(&error.committed);
                SessionError::Model(error.error)
            })?;
            Self::output(
                output,
                view,
                #[cfg(feature = "application")]
                &mut self.checklist,
                self.reported_errors.as_deref(),
                self.follow_up_errors.as_deref(),
            );
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

#[cfg(all(test, feature = "application"))]
mod grouping_test;
#[cfg(all(test, feature = "application", feature = "test-faults"))]
mod metadata_test;

#[cfg(all(test, feature = "application"))]
mod ai_ops_history_test;

#[cfg(all(test, feature = "application"))]
mod arrow_test;

#[cfg(test)]
mod identity_test;

#[cfg(test)]
mod id_state_test;

#[cfg(all(test, feature = "application"))]
mod code_gate_test;

#[cfg(test)]
mod namespace_test;

#[cfg(test)]
mod clipboard_id_test;

#[cfg(all(test, feature = "application"))]
mod import_storage_test;

#[cfg(all(test, feature = "application"))]
mod runtime_id_test;

#[cfg(all(test, feature = "application", feature = "compatibility"))]
mod root_text_cache_test;

#[cfg(all(test, feature = "application"))]
mod null_fields_test;

#[cfg(all(test, feature = "application"))]
mod root_id_test;

#[cfg(test)]
mod input_dom_prefix_test;

#[cfg(all(test, feature = "application"))]
mod root_id_remote_test;
