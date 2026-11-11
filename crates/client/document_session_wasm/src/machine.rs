use crate::*;
use doc_sync_core::*;
use document_session::*;
use lexical_model::{EditorMode, Input};
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
pub(crate) enum Session {
    Editor(Box<DocumentSession<EditorSurface>>),
    Doc(Box<DocumentSession<GenericSurface>>),
}
pub(crate) struct Machine {
    pub(crate) session: Session,
    pub(crate) output: Vec<u8>,
    pub(crate) decorator_observer: crate::decorator_observer::DecoratorObserver,
    pub(crate) wake: Option<Millis>,
    wall_origin: f64,
    terminal: bool,
    initial_telemetry: Vec<wire::TelemetryMsg>,
    constructor_clock: Option<Arc<AtomicI64>>,
    view_commands: Option<Arc<crate::view_command_scope::Registry>>,
}
impl Machine {
    pub(crate) fn take_output(&mut self) -> Vec<u8> {
        self.decorator_observer.expose();
        std::mem::take(&mut self.output)
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
        let out = SessionOutput {
            view: vec![ViewEffect::Initialize(InitialView::Editor {
                diff: session.surface().view_diff()?,
                state: session.surface().state().to_json()?,
            })],
            ..Default::default()
        };
        let mut bytes = vec![];
        output::encode_observed(
            &out,
            false,
            &mut bytes,
            None,
            None,
            &mut self.decorator_observer,
        )?;
        self.decorator_observer.expose();
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
    ) -> Result<Self, BoundaryError> {
        Self::create_with(abi, config, mono, wall, true, true, Some(namespace))
    }
    fn create_with(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
        editor: bool,
        application: bool,
        namespace: Option<&str>,
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
            if let Some(clock) = &constructor_clock {
                editor_config = crate::macro_editor::config(editor_config, clock.clone());
            }
            if let Some(namespace) = namespace {
                editor_config.namespace = namespace.into();
            }
            config.surface = SurfaceConfig::Editor(editor_config);
            Session::Editor(Box::new(DocumentSession::new(config, now)?))
        } else {
            Session::Doc(Box::new(DocumentSession::new(config, now)?))
        };
        Ok(Self {
            session,
            output: vec![],
            decorator_observer: Default::default(),
            wake: None,
            wall_origin: wall - mono,
            terminal: false,
            initial_telemetry: capture.finish(),
            constructor_clock,
            view_commands: None,
        })
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
        let Session::Editor(session) = &mut self.session else {
            return Err(BoundaryError::Invalid("view commands require an editor"));
        };
        session.observe_reported_model_errors(registry.clone());
        self.view_commands = Some(registry);
        Ok(())
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
                return registry.invoke_control(access, || self.call_inner(input, mono, wall))?;
            }
            return registry.invoke(access, || self.call_inner(input, mono, wall))?;
        }
        self.call_inner(input, mono, wall)
    }
    fn call_inner(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
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
            Session::Editor(s) => {
                s.handle(now, input);
            }
            Session::Doc(s) => {
                s.handle(now, input);
            }
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
        let mut flags = output::encode_observed(
            out,
            self.terminal,
            &mut self.output,
            correction,
            selection_feedback,
            &mut self.decorator_observer,
        )?;
        flags |= crate::telemetry::append(messages, &mut self.output)?;
        if let Some(registry) = &self.view_commands {
            registry.bind_output(&out.view);
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
        let Session::Editor(session) = &self.session else {
            return Err(BoundaryError::Invalid("editor"));
        };
        let output = SessionOutput {
            view: vec![ViewEffect::Error(SessionError::Configuration(reason))],
            ..Default::default()
        };
        output::encode_observed(
            &output,
            self.terminal,
            &mut self.output,
            Some(output::TextCorrection {
                diff: session.surface().view_diff()?,
                initialize: true,
            }),
            None,
            &mut self.decorator_observer,
        )
    }
    pub(crate) fn editor(&mut self, input: Input, mono: f64) -> Result<u32, BoundaryError> {
        self.call(SessionInput::Editor(input), mono, None)
    }
    pub(crate) fn input(&mut self, msg: &[u8], mono: f64, wall: f64) -> Result<u32, BoundaryError> {
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
