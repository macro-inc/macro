use crate::*;
use doc_sync_core::*;
use document_session::*;
use lexical_model::{EditorMode, Input};
use macro_document_model::plugins_group_b::CodeTokens;
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
pub(crate) enum Session {
    Editor(Box<DocumentSession<EditorSurface>>),
    Doc(Box<DocumentSession<GenericSurface>>),
}
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum ListenerMetadataProtocol {
    #[default]
    Disabled,
    Enabled,
    Closed,
}
pub(crate) struct Machine {
    pub(crate) session: Session,
    pub(crate) output: Vec<u8>,
    pub(crate) pending_checklist_output:
        Vec<macro_document_model::plugins_group_b::checklist_updates::PlanUpdates>,
    listener_metadata: Option<output::ListenerMetadataTail>,
    listener_metadata_protocol: ListenerMetadataProtocol,
    pub(crate) decorator_observer: crate::decorator_observer::DecoratorObserver,
    pub(crate) wake: Option<Millis>,
    wall_origin: f64,
    terminal: bool,
    initial_telemetry: Vec<wire::TelemetryMsg>,
    constructor_clock: Option<Arc<AtomicI64>>,
    view_commands: Option<Arc<crate::view_command_scope::Registry>>,
    /// Last issued session entry; never 0 once a call began, never wraps.
    entry: u64,
    /// The session's code tokenizer token.
    code_tokens: Option<(u64, Arc<crate::code_tokens::CodeTokenObserver>)>,
    /// The session's single reported-error observer: every bound observer, in bind order.
    reported_errors: Option<Arc<ReportedErrors>>,
    /// Recorded throws reported in the latest output; replaced by the next entry.
    code_token_failure: Option<crate::code_tokens::CodeTokenFailure>,
    #[cfg(test)]
    pub(crate) fail_next_output_generation: bool,
    #[cfg(not(feature = "compatibility"))]
    pub(crate) input_commits: crate::input_commit::InputCommitLedger,
    pub(crate) database_commit:
        Option<macro_document_model::plugins_group_b::DatabaseMainCommitResult>,
}
impl Machine {
    pub(crate) fn take_output(&mut self) -> Result<Vec<u8>, BoundaryError> {
        // Root/host callbacks may have changed membership since input encoded this
        // packet. Snapshot CURRENT authority at the actual transfer boundary.
        let replacement = if let Some(tail) = &self.listener_metadata {
            let Session::Editor(session) = &self.session else {
                return Err(BoundaryError::Invalid("editor listener metadata"));
            };
            Some(tail.replacement(session.surface().listener_table(), &self.output)?)
        } else {
            None
        };
        // Preserve the existing observer/lease failure boundary and destructive take.
        self.decorator_observer.expose()?;
        if let Some(replacement) = replacement {
            if let Some(tail) = self.listener_metadata.take() {
                tail.replace(replacement, &mut self.output);
            }
        }
        let receipts = std::mem::take(&mut self.pending_checklist_output);
        match &mut self.session {
            Session::Editor(session) => session.acknowledge_application_output(&receipts),
            Session::Doc(session) => session.acknowledge_application_output(&receipts),
        }
        Ok(std::mem::take(&mut self.output))
    }
    pub(crate) fn initialize_view(&mut self) -> Result<Vec<u8>, BoundaryError> {
        if !self.output.is_empty() {
            return Err(BoundaryError::Invalid(
                "initialize before pending output transfer",
            ));
        }
        let Session::Editor(session) = &self.session else {
            return Err(BoundaryError::Invalid("editor"));
        };
        let reset = session.prepare_checklist_reset()?;
        let mut out = SessionOutput {
            view: vec![ViewEffect::Initialize(InitialView::Editor {
                diff: session.surface().view_diff()?,
                state: session.surface().state().to_json()?,
            })],
            ..Default::default()
        };
        out.view.extend(
            reset
                .deliveries()
                .into_iter()
                .map(ViewEffect::ChecklistPlans),
        );
        let mut bytes = vec![];
        self.decorator_observer.with_initialization(|observer| {
            output::encode_observed(&out, false, &mut bytes, None, None, observer)
        })?;
        // initializeView itself transfers this local packet, with no host gap.
        if self.listener_metadata_protocol == ListenerMetadataProtocol::Enabled {
            output::append_listener_table(session.surface().listener_table(), &mut bytes)?;
        }
        self.decorator_observer.expose()?;
        if let Session::Editor(session) = &mut self.session {
            session.expose_checklist_reset(reset);
        }
        self.pending_checklist_output.clear();
        Ok(bytes)
    }
    pub(crate) fn effective_access(&self) -> wire::Access {
        let access = match &self.session {
            Session::Editor(session) => session.effective_access(),
            Session::Doc(session) => session.effective_access(),
        };
        match access {
            Access::Read => wire::Access::Read,
            Access::CommentOnly => wire::Access::CommentOnly,
            Access::Edit => wire::Access::Edit,
        }
    }
    pub(crate) fn create(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
        editor: bool,
    ) -> Result<Self, BoundaryError> {
        Self::create_with(abi, config, mono, wall, editor, false, None)
    }
    pub(crate) fn create_macro(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
    ) -> Result<Self, BoundaryError> {
        Self::create_with(abi, config, mono, wall, true, true, None)
    }
    pub(crate) fn create_macro_with_namespace(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
        namespace: &str,
        write_root_search_text: bool,
        code_tokens: CodeTokens,
    ) -> Result<Self, BoundaryError> {
        Self::create_with(
            abi,
            config,
            mono,
            wall,
            true,
            true,
            Some((namespace, write_root_search_text, code_tokens)),
        )
    }
    fn create_with(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
        editor: bool,
        application: bool,
        namespace: Option<(&str, bool, CodeTokens)>,
    ) -> Result<Self, BoundaryError> {
        if abi != generated::ABI_MAJOR {
            return Err(BoundaryError::AbiMismatch);
        }
        let (mut config, headless, view_host) =
            codec::config(wire::SessionConfigMsg::deserialize(config)?)?;
        let now = codec::now(mono, wall)?;
        let constructor_clock = application.then(|| Arc::new(AtomicI64::new(now.wall.0)));
        let capture = crate::telemetry::begin();
        let session = if editor {
            let mut editor_config = EditorConfig {
                view_host,
                mode: if headless {
                    EditorMode::Headless
                } else {
                    EditorMode::ViewAttached
                },
                ..EditorConfig::default()
            };
            let (namespace, code_tokens) = match namespace {
                Some((namespace, write_root_search_text, code_tokens)) => {
                    (Some((namespace, write_root_search_text)), code_tokens)
                }
                None => (None, CodeTokens::none()),
            };
            if let Some(clock) = &constructor_clock {
                editor_config = crate::macro_editor::config_with_tokens(
                    editor_config,
                    clock.clone(),
                    code_tokens,
                );
            }
            if let Some((namespace, write_root_search_text)) = namespace {
                editor_config.namespace = namespace.into();
                if write_root_search_text {
                    editor_config.policy =
                        &macro_document_model::sync::MACRO_SEARCH_TEXT_SYNC_POLICY;
                }
            }
            config.surface = SurfaceConfig::Editor(editor_config);
            Session::Editor(Box::new(DocumentSession::new(config, now)?))
        } else {
            Session::Doc(Box::new(DocumentSession::new(config, now)?))
        };
        Ok(Self {
            session,
            output: vec![],
            listener_metadata: None,
            listener_metadata_protocol: ListenerMetadataProtocol::Disabled,
            decorator_observer: Default::default(),
            pending_checklist_output: vec![],
            wake: None,
            wall_origin: wall - mono,
            terminal: false,
            initial_telemetry: capture.finish(),
            constructor_clock,
            view_commands: None,
            entry: 0,
            code_tokens: None,
            code_token_failure: None,
            reported_errors: None,
            #[cfg(test)]
            fail_next_output_generation: false,
            #[cfg(not(feature = "compatibility"))]
            input_commits: Default::default(),
            database_commit: None,
        })
    }
    /// Explicit transport opt-in, never inferred from a registry/query/registration.
    pub(crate) fn enable_listener_metadata(&mut self, owner: u64) -> Result<(), BoundaryError> {
        let registry = self.view_commands.as_ref().ok_or(BoundaryError::Invalid(
            "listener metadata requires a bound owner",
        ))?;
        registry.ensure_local()?;
        if registry.owner() != owner {
            return Err(BoundaryError::Invalid("listener metadata owner mismatch"));
        }
        if self.listener_metadata_protocol == ListenerMetadataProtocol::Closed {
            return Err(BoundaryError::Invalid("listener metadata transport closed"));
        }
        if self.listener_metadata_protocol == ListenerMetadataProtocol::Disabled {
            if !self.output.is_empty() {
                return Err(BoundaryError::Invalid(
                    "listener metadata requires drained legacy output",
                ));
            }
            self.listener_metadata_protocol = ListenerMetadataProtocol::Enabled;
        }
        Ok(())
    }
    pub(crate) fn retire_view_observation(&mut self) {
        self.decorator_observer.retire();
        self.listener_metadata_protocol = ListenerMetadataProtocol::Closed;
    }
    pub(crate) fn generation(&self) -> u32 {
        match &self.session {
            Session::Editor(s) => s.surface().state().max_key().generation(),
            Session::Doc(_) => 0,
        }
    }
    pub(crate) fn view_commands(
        &mut self,
    ) -> Result<Arc<crate::view_command_scope::Registry>, BoundaryError> {
        if let Some(registry) = &self.view_commands {
            return Ok(registry.clone());
        }
        let registry = crate::view_command_scope::Registry::new()?;
        self.bind_view_commands(registry.clone())?;
        Ok(registry)
    }
    pub(crate) fn bind_view_commands(
        &mut self,
        registry: Arc<crate::view_command_scope::Registry>,
    ) -> Result<(), BoundaryError> {
        if self.view_commands.is_some() {
            return Err(BoundaryError::Invalid(
                "view command registry already bound",
            ));
        }
        if !matches!(self.session, Session::Editor(_)) {
            return Err(BoundaryError::Invalid("view commands require an editor"));
        }
        self.observe_reported_errors(registry.clone())?;
        self.view_commands = Some(registry);
        Ok(())
    }
    /// Bind the session's code tokenizer once, before any call.
    pub(crate) fn bind_code_tokens(&mut self, token: u64) -> Result<(), BoundaryError> {
        if self.code_tokens.is_some() || self.entry != 0 {
            return Err(BoundaryError::Invalid(
                "code tokenizer bound after construction",
            ));
        }
        let observer = Arc::new(crate::code_tokens::CodeTokenObserver::default());
        self.observe_reported_errors(observer.clone())?;
        self.code_tokens = Some((token, observer));
        Ok(())
    }
    /// The session has one observer slot: install the machine's fan-out once and add each
    /// observer to it, so no bind order replaces another observer.
    pub(crate) fn observe_reported_errors(
        &mut self,
        observer: Arc<dyn document_session::ReportedModelErrorObserver>,
    ) -> Result<(), BoundaryError> {
        let fan_out = match &self.reported_errors {
            Some(fan_out) => fan_out.clone(),
            None => {
                let Session::Editor(session) = &mut self.session else {
                    return Err(BoundaryError::Invalid("reported errors require an editor"));
                };
                let fan_out = Arc::new(ReportedErrors::default());
                session.observe_reported_model_errors(fan_out.clone());
                self.reported_errors = Some(fan_out.clone());
                fan_out
            }
        };
        fan_out
            .0
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(observer);
        Ok(())
    }
    pub(crate) fn take_code_token_failure(
        &mut self,
    ) -> Option<crate::code_tokens::CodeTokenFailure> {
        self.code_token_failure.take()
    }
    /// Remove a reported cause by its exact (entry, cause); any other pair misses.
    pub(crate) fn take_code_token_cause(
        &self,
        entry: u64,
        cause: u32,
    ) -> Option<wasm_bindgen::JsValue> {
        crate::code_tokens::take(self.code_tokens.as_ref()?.0, entry, cause)
    }
    pub(crate) fn code_token_causes_dropped(&self) -> u32 {
        self.code_tokens
            .as_ref()
            .map_or(0, |(token, _)| crate::code_tokens::dropped(*token))
    }
    pub(crate) fn take_view_command_failure(
        &self,
    ) -> Result<Option<crate::ViewCommandFailure>, BoundaryError> {
        self.view_commands
            .as_ref()
            .map(|registry| registry.take_failure())
            .transpose()
            .map(Option::flatten)
            .map_err(Into::into)
    }
    pub(crate) fn call(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
    ) -> Result<u32, BoundaryError> {
        self.invalidate_input_commit();
        self.call_inner_observed(input, mono, wall, None)
    }
    pub(crate) fn invalidate_input_commit(&mut self) {
        #[cfg(not(feature = "compatibility"))]
        self.input_commits.invalidate();
    }
    #[cfg(not(feature = "compatibility"))]
    pub(crate) fn call_with_main_commit(
        &mut self,
        input: Input,
        mono: f64,
        wall: f64,
        main_commit: &mut lexical_model::MainCommitOutcome,
    ) -> Result<u32, BoundaryError> {
        self.call_inner_observed(
            SessionInput::Editor(input),
            mono,
            Some(wall),
            Some(main_commit),
        )
    }
    fn call_inner_observed(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
        main_commit: Option<&mut lexical_model::MainCommitOutcome>,
    ) -> Result<u32, BoundaryError> {
        // Entry ids key recorded tokenizer throws; nesting cannot reach here (&mut self).
        let entry = self
            .entry
            .checked_add(1)
            .ok_or(BoundaryError::Invalid("session entry id space"))?;
        self.entry = entry;
        self.code_token_failure = None;
        if let Some((token, observer)) = &self.code_tokens {
            observer.take();
            crate::code_tokens::begin_entry(*token, entry);
        }
        self.database_commit = None;
        let result = self.call_entry(input, mono, wall, main_commit);
        if let Some((token, observer)) = &self.code_tokens {
            observer.take();
            crate::code_tokens::end_entry(*token);
        }
        result
    }
    fn call_entry(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
        main_commit: Option<&mut lexical_model::MainCommitOutcome>,
    ) -> Result<u32, BoundaryError> {
        if let Some(registry) = self.view_commands.clone() {
            let Session::Editor(session) = &mut self.session else {
                return Err(BoundaryError::Invalid("view commands require an editor"));
            };
            if !matches!(&input, SessionInput::Sync(_) | SessionInput::AddPeerIds(_)) {
                registry.ensure_local()?;
            }
            registry.rebind(session)?;
            let access = session.effective_access();
            if matches!(&input, SessionInput::Sync(_) | SessionInput::AddPeerIds(_)) {
                return registry
                    .invoke_control(access, || self.call_inner(input, mono, wall, main_commit))?;
            }
            return registry.invoke(access, || self.call_inner(input, mono, wall, main_commit))?;
        }
        self.call_inner(input, mono, wall, main_commit)
    }
    fn call_inner(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
        main_commit: Option<&mut lexical_model::MainCommitOutcome>,
    ) -> Result<u32, BoundaryError> {
        let now = codec::now(mono, wall.unwrap_or(self.wall_origin + mono))?;
        if let Some(clock) = &self.constructor_clock {
            clock.store(now.wall.0, Ordering::Relaxed);
        }
        if let Some(wall) = wall {
            self.wall_origin = wall - mono;
        }
        match &input {
            SessionInput::Sync(
                SyncInput::Stop(_) | SyncInput::Host(HostSignal::Hidden | HostSignal::PageHide),
            ) => self.terminal = true,
            SessionInput::Sync(SyncInput::Host(HostSignal::Visible)) => self.terminal = false,
            _ => {}
        }
        let command = matches!(
            &input,
            SessionInput::Editor(
                Input::Command { .. } | Input::KeyDown { .. } | Input::Undo | Input::Redo
            )
        );
        let submitted = match &input {
            SessionInput::Editor(Input::TextFromView { key, text, .. }) => {
                Some((*key, text.clone()))
            }
            _ => None,
        };
        let click = matches!(
            &input,
            SessionInput::Editor(Input::Command {
                command: lexical_model::Command::Click,
                ..
            })
        );
        let selection_baseline = match &input {
            SessionInput::Editor(
                Input::SelectionFromView { selection, .. } | Input::TextFromView { selection, .. },
            ) if *selection != lexical_model::ViewSelection::KeepModel => Some(selection.clone()),
            SessionInput::Editor(Input::Command {
                command: lexical_model::Command::Click,
                ..
            }) => match &self.session {
                Session::Editor(session) => Some(lexical_model::view_selection(
                    session.surface().state().selection(),
                )),
                Session::Doc(_) => None,
            },
            _ => None,
        };
        let previous_typing = if selection_baseline.is_some() {
            match &self.session {
                Session::Editor(session) => session
                    .surface()
                    .state()
                    .selection()
                    .and_then(lexical_model::Selection::as_range)
                    .map(|range| (range.format, range.style.clone())),
                Session::Doc(_) => None,
            }
        } else {
            None
        };
        let capture = crate::telemetry::begin();
        match &mut self.session {
            Session::Editor(s) => match (input, main_commit) {
                (SessionInput::Editor(input), Some(outcome)) => {
                    s.handle_editor_with_database_commit(
                        now,
                        input,
                        outcome,
                        &mut self.database_commit,
                    );
                }
                (input, None) => {
                    s.handle(now, input);
                }
                (_, Some(_)) => return Err(BoundaryError::Invalid("observed editor input")),
            },
            Session::Doc(s) => {
                if main_commit.is_some() {
                    return Err(BoundaryError::Invalid("observed editor required"));
                }
                s.handle(now, input);
            }
        }
        if self
            .view_commands
            .as_ref()
            .is_some_and(|registry| registry.take_view_retirement())
        {
            self.retire_view_observation();
        }
        let mut messages = std::mem::take(&mut self.initial_telemetry);
        messages.extend(capture.finish());
        let (out, surface) = match &self.session {
            Session::Editor(s) => (s.last_output(), Some(s.surface())),
            Session::Doc(s) => (s.last_output(), None),
        };
        let wake_changed = self.wake != out.wake_at;
        let nonzero_output = !out.view.is_empty()
            || !out.io.is_empty()
            || out.need_peer_ids
            || wake_changed
            || !messages.is_empty();
        let text_mismatch =
            submitted
                .as_ref()
                .zip(surface)
                .is_some_and(|((key, submitted), surface)| {
                    surface
                        .state()
                        .view()
                        .text(*key)
                        .is_none_or(|text| text.text.as_str() != submitted)
                });
        // DOM inputs need final model facts on nonzero output. Click also reports
        // actual changes when a read-only core intentionally emits no DOM write;
        // unchanged Clicks never gain unconditional selection feedback.
        let selection_feedback =
            if let (Some(mut submitted), Some(surface)) = (selection_baseline, surface) {
                if let lexical_model::ViewSelection::Range {
                    resolution_dirty, ..
                } = &mut submitted
                {
                    *resolution_dirty = false;
                }
                let selection = surface.state().selection();
                let actual = lexical_model::view_selection(selection);
                let authoritative = out.view.iter().any(|effect| {
                    matches!(
                        effect,
                        ViewEffect::Editor(lexical_model::Effect::SetViewSelection { .. })
                    )
                });
                let nonzero = nonzero_output || text_mismatch;
                let typing = selection
                    .and_then(lexical_model::Selection::as_range)
                    .map(|range| (range.format, range.style.clone()));
                if !authoritative
                    && (submitted != actual || (!click && nonzero) || typing != previous_typing)
                {
                    let (format, style) = selection
                        .and_then(lexical_model::Selection::as_range)
                        .map_or(
                            (lexical_model::TextFormat::empty(), Arc::from("")),
                            |range| (range.format, range.style.clone()),
                        );
                    Some(ViewEffect::Editor(
                        lexical_model::Effect::SetViewSelection {
                            selection: actual,
                            format,
                            style,
                        },
                    ))
                } else {
                    None
                }
            } else {
                None
            };
        // A zero return is an exact acknowledgement of the DOM edit. Every
        // other result carries authoritative text, including rejected edits
        // whose rollback would otherwise produce no model Diff.
        let correction = if let (Some((key, submitted)), Some(surface)) = (submitted, surface) {
            let state = surface.state();
            if let Some(text) = state.view().text(key) {
                let exact = text.text.as_str() == submitted;
                let nonzero = nonzero_output || selection_feedback.is_some();
                if exact && !nonzero {
                    None
                } else {
                    Some(output::TextCorrection {
                        initialize: false,
                        diff: lexical_model::Diff {
                            generation: state.max_key().generation(),
                            full_reconcile: false,
                            view_text_matches: None,
                            decorator_renders: vec![],
                            ops: vec![lexical_model::DiffOp::Text {
                                key,
                                text: text.text.as_str().to_owned(),
                            }],
                        },
                    })
                }
            } else {
                // Invalid, stale or transformed-away text keys require a complete
                // repair. A Remove could destroy a live non-text node, or name a
                // key the mirror already forgot.
                Some(output::TextCorrection {
                    diff: surface.view_diff()?,
                    initialize: true,
                })
            }
        } else {
            None
        };
        // Exercise the real encoder's incompatible-generation failure after the
        // actual model/session call. This field and branch do not exist in artifacts.
        #[cfg(test)]
        let selection_feedback = if std::mem::take(&mut self.fail_next_output_generation) {
            let generation = surface
                .ok_or(BoundaryError::Invalid("editor required"))?
                .state()
                .max_key()
                .generation()
                .wrapping_add(1);
            Some(ViewEffect::Diff(lexical_model::Diff {
                generation,
                full_reconcile: false,
                view_text_matches: None,
                decorator_renders: vec![],
                ops: vec![],
            }))
        } else {
            selection_feedback
        };
        let mut flags = output::encode_observed(
            out,
            self.terminal,
            &mut self.output,
            correction,
            selection_feedback,
            &mut self.decorator_observer,
        )?;
        self.pending_checklist_output = out.checklist_deliveries();
        // encode_observed only replaces/clears buffer on success. Preserve the
        // old tail on every earlier failure, then retire it with the old packet.
        self.listener_metadata = None;
        flags |= crate::telemetry::append(messages, &mut self.output)?;
        // This actual transition may change membership without a model commit.
        // Metadata is last so transfer refresh can replace ONLY its private tail.
        if let (ListenerMetadataProtocol::Enabled, Some(surface)) =
            (self.listener_metadata_protocol, surface)
        {
            self.listener_metadata = Some(output::append_listener_table(
                surface.listener_table(),
                &mut self.output,
            )?);
            flags |= 1; // Existing View flag for a real metadata effect, not a commit.
        }
        if let Some(registry) = &self.view_commands {
            registry.bind_output(&out.view);
        }
        if let Some((token, observer)) = &self.code_tokens {
            self.code_token_failure =
                crate::code_tokens::bind_output(*token, self.entry, &out.view, &observer.take());
        }
        if command
            && flags & 16 == 0
            && surface.is_some_and(|s| s.command_handled() == lexical_model::Handled::Yes)
        {
            flags |= generated::FLAG_HANDLED;
        }
        if wake_changed {
            flags |= 4;
            self.wake = out.wake_at;
        }
        Ok(flags)
    }
    pub(crate) fn sync(
        &mut self,
        input: SyncInput,
        mono: f64,
        wall: Option<f64>,
    ) -> Result<u32, BoundaryError> {
        self.call(SessionInput::Sync(input), mono, wall)
    }
    pub(crate) fn reject_text(&mut self, reason: &'static str) -> Result<u32, BoundaryError> {
        self.invalidate_input_commit();
        if let Some(registry) = &self.view_commands {
            registry.replace_local_output()?;
        }
        let Session::Editor(session) = &self.session else {
            return Err(BoundaryError::Invalid("editor"));
        };
        let output = SessionOutput {
            view: vec![ViewEffect::Error(SessionError::Configuration(reason))],
            ..Default::default()
        };
        let flags = output::encode_observed(
            &output,
            self.terminal,
            &mut self.output,
            Some(output::TextCorrection {
                diff: session.surface().view_diff()?,
                initialize: true,
            }),
            None,
            &mut self.decorator_observer,
        )?;
        self.pending_checklist_output.clear();
        self.listener_metadata = None;
        Ok(flags)
    }
    pub(crate) fn editor(&mut self, input: Input, mono: f64) -> Result<u32, BoundaryError> {
        self.call(SessionInput::Editor(input), mono, None)
    }
    pub(crate) fn input(&mut self, msg: &[u8], mono: f64, wall: f64) -> Result<u32, BoundaryError> {
        self.invalidate_input_commit();
        let msg = wire::SessionInputMsg::deserialize(msg)?;
        let input = match msg.kind {
            0 => SessionInput::Sync(SyncInput::Start),
            1 => SessionInput::Sync(SyncInput::Seed {
                kind: match msg.code {
                    0 => SeedKind::Optimistic,
                    1 => SeedKind::CachedS3,
                    _ => return Err(BoundaryError::Invalid("seed")),
                },
                snapshot: msg.bytes,
            }),
            2 => {
                let text_input = matches!(&msg.editor, wire::EditorInputMsg::EditorText { .. });
                match editor_input::input(msg.editor, self.generation()) {
                    Ok(input) => SessionInput::Editor(input),
                    Err(_) if text_input => return self.reject_text("invalid DOM text input"),
                    Err(error) => return Err(error),
                }
            }
            3 => SessionInput::Doc(
                msg.operations
                    .into_iter()
                    .map(generic::operation)
                    .collect::<Result<_, _>>()?,
            ),
            4 => SessionInput::Sync(SyncInput::Flush(RequestId(msg.request))),
            5 => SessionInput::Sync(SyncInput::Stop(RequestId(msg.request))),
            6 => SessionInput::Sync(SyncInput::Reset),
            7 => SessionInput::AddPeerIds(msg.peers),
            8 => SessionInput::Focus(msg.flag),
            9 => SessionInput::Comment(CommentMarkRequest {
                request: RequestId(msg.request),
                mark_id: msg.mark_id,
                action: if msg.code == 0 {
                    CommentAction::Remove
                } else {
                    CommentAction::Add {
                        anchor: cursor(&msg.anchor)?,
                        focus: cursor(&msg.focus)?,
                        text: msg.expected_text,
                    }
                },
            }),
            10 => SessionInput::Sync(SyncInput::RequestSnapshot(RequestId(msg.request))),
            11 => {
                let msg = wire::RouteMsg::deserialize(&msg.bytes)?;
                SessionInput::Sync(SyncInput::Route(match msg.kind {
                    0 => RouteEvent::Subscribed {
                        conn: ConnId(msg.conn),
                        access: crate::router::access_value(u32::from(msg.access))?,
                    },
                    1 => RouteEvent::Frame {
                        conn: ConnId(msg.conn),
                        frame: msg.frame,
                    },
                    2 => RouteEvent::Closed {
                        conn: ConnId(msg.conn),
                        code: u16::try_from(msg.code)
                            .map_err(|_| BoundaryError::Invalid("close code"))?,
                    },
                    _ => return Err(BoundaryError::Invalid("route event")),
                }))
            }
            _ => return Err(BoundaryError::Invalid("session input")),
        };
        self.call(input, mono, Some(wall))
    }
}

fn cursor(data: &[u8]) -> Result<lexical_loro::NodeCursor, BoundaryError> {
    let msg = wire::NodeCursorMsg::deserialize(data)?;
    Ok(lexical_loro::NodeCursor {
        node_id: msg.node_id,
        cursor: loro::cursor::Cursor::decode(&msg.cursor)
            .map_err(|_| BoundaryError::Invalid("cursor"))?,
    })
}

#[cfg(feature = "compatibility")]
#[path = "compatibility/machine.rs"]
mod compatibility;
#[cfg(test)]
#[path = "machine/listener_metadata_test.rs"]
mod listener_metadata_test;

/// Every metadata observer bound to a session, called in bind order (view-command registry,
/// code tokenizer); each is metadata-only.
#[derive(Default)]
pub(crate) struct ReportedErrors(
    std::sync::RwLock<Vec<Arc<dyn document_session::ReportedModelErrorObserver>>>,
);
impl document_session::ReportedModelErrorObserver for ReportedErrors {
    fn reported(&self, error: &lexical_model::Error, view_index: usize) {
        for observer in self
            .0
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
        {
            observer.reported(error, view_index);
        }
    }
}
