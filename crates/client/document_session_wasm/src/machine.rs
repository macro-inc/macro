use crate::*;
use doc_sync_core::*;
use document_session::*;
use lexical_model::{EditorMode, Input};
pub(crate) enum Session {
    Editor(Box<DocumentSession<EditorSurface>>),
    Doc(Box<DocumentSession<GenericSurface>>),
}
pub(crate) struct Machine {
    pub(crate) session: Session,
    pub(crate) output: Vec<u8>,
    pub(crate) wake: Option<Millis>,
    wall_origin: f64,
    terminal: bool,
    initial_telemetry: Vec<wire::TelemetryMsg>,
}
impl Machine {
    pub(crate) fn create(
        abi: u32,
        config: &[u8],
        mono: f64,
        wall: f64,
        editor: bool,
    ) -> Result<Self, BoundaryError> {
        if abi != generated::ABI_MAJOR {
            return Err(BoundaryError::AbiMismatch);
        }
        let (mut config, headless, view_host) =
            codec::config(wire::SessionConfigMsg::deserialize(config)?)?;
        let now = codec::now(mono, wall)?;
        let capture = crate::telemetry::begin();
        let session = if editor {
            config.surface = SurfaceConfig::Editor(EditorConfig {
                view_host,
                mode: if headless {
                    EditorMode::Headless
                } else {
                    EditorMode::ViewAttached
                },
                ..EditorConfig::default()
            });
            Session::Editor(Box::new(DocumentSession::new(config, now)?))
        } else {
            Session::Doc(Box::new(DocumentSession::new(config, now)?))
        };
        Ok(Self {
            session,
            output: vec![],
            wake: None,
            wall_origin: wall - mono,
            terminal: false,
            initial_telemetry: capture.finish(),
        })
    }
    pub(crate) fn generation(&self) -> u32 {
        match &self.session {
            Session::Editor(s) => s.surface().state().max_key().generation(),
            Session::Doc(_) => 0,
        }
    }
    pub(crate) fn call(
        &mut self,
        input: SessionInput,
        mono: f64,
        wall: Option<f64>,
    ) -> Result<u32, BoundaryError> {
        let now = codec::now(mono, wall.unwrap_or(self.wall_origin + mono))?;
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
        let submitted = match &input {
            SessionInput::Editor(Input::TextFromView { key, text, .. }) => {
                Some((*key, text.clone()))
            }
            _ => None,
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
        let (out, state) = match &self.session {
            Session::Editor(s) => (s.last_output(), Some(s.surface().state())),
            Session::Doc(s) => (s.last_output(), None),
        };
        let wake_changed = self.wake != out.wake_at;
        // A zero return is an exact acknowledgement of the DOM edit. Every
        // other result carries authoritative text, including rejected edits
        // whose rollback would otherwise produce no model Diff.
        let correction = submitted.and_then(|(key, submitted)| {
            let state = state?;
            let text = state
                .view()
                .text(key)
                .map(|node| node.text.as_str().to_owned());
            let exact = text.as_deref() == Some(submitted.as_str());
            let nonzero = !out.view.is_empty()
                || !out.io.is_empty()
                || out.need_peer_ids
                || wake_changed
                || !messages.is_empty();
            if exact && !nonzero {
                return None;
            }
            Some(lexical_model::Diff {
                generation: state.max_key().generation(),
                full_reconcile: false,
                view_text_matches: None,
                ops: vec![match text {
                    Some(text) => lexical_model::DiffOp::Text { key, text },
                    None => lexical_model::DiffOp::Remove {
                        key,
                        subtree_root: true,
                    },
                }],
            })
        });
        let mut flags = output::encode(out, self.terminal, &mut self.output, correction)?;
        flags |= crate::telemetry::append(messages, &mut self.output)?;
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
            2 => SessionInput::Editor(editor_input::input(msg.editor, self.generation())?),
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
