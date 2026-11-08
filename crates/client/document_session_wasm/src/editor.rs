use crate::*;
use doc_sync_core::*;
use lexical_model::*;
use wasm_bindgen::prelude::*;
/// One host-owned editor session.
#[wasm_bindgen]
pub struct EditorSession {
    pub(crate) machine: machine::Machine,
}
#[wasm_bindgen]
impl EditorSession {
    /// Construct a session; reject incompatible ABI majors before decoding configuration.
    pub fn create(abi_major: u32, config: &[u8], now: f64, wall: f64) -> Result<Self, JsError> {
        Ok(Self {
            machine: machine::Machine::create(abi_major, config, now, wall, true).map_err(js)?,
        })
    }
    /// Deliver a cold Bebop input.
    pub fn input(&mut self, msg: &[u8], now: f64, wall: f64) -> Result<u32, JsError> {
        self.machine.input(msg, now, wall).map_err(js)
    }
    /// Copy pending output; no borrowed linear-memory view escapes.
    #[wasm_bindgen(js_name=takeOutput)]
    pub fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.machine.output)
    }
    /// Earliest monotonic deadline, or -1.
    #[wasm_bindgen(js_name=wakeAt)]
    pub fn wake_at(&self) -> f64 {
        self.machine.wake.map_or(-1.0, |v| v.0 as f64)
    }
    /// Physical socket opened.
    #[wasm_bindgen(js_name=socketOpened)]
    pub fn socket_opened(&mut self, conn: u32, now: f64, wall: f64) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Socket {
                    conn: ConnId(conn),
                    event: SocketEvent::Opened,
                },
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// One raw framed binary message.
    #[wasm_bindgen(js_name=socketFrame)]
    pub fn socket_frame(&mut self, conn: u32, frame: Vec<u8>, now: f64) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Socket {
                    conn: ConnId(conn),
                    event: SocketEvent::Frame(frame),
                },
                now,
                None,
            )
            .map_err(js)
    }
    /// Physical text message.
    #[wasm_bindgen(js_name=socketText)]
    pub fn socket_text(&mut self, conn: u32, text: String, now: f64) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Socket {
                    conn: ConnId(conn),
                    event: SocketEvent::Text(text),
                },
                now,
                None,
            )
            .map_err(js)
    }
    /// Physical close completion.
    #[wasm_bindgen(js_name=socketClosed)]
    pub fn socket_closed(
        &mut self,
        conn: u32,
        code: u16,
        clean: bool,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Socket {
                    conn: ConnId(conn),
                    event: SocketEvent::Closed { code, clean },
                },
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Authorization fetch completion; token contents never enter telemetry.
    #[wasm_bindgen(js_name=tokenFetched)]
    pub fn token_fetched(
        &mut self,
        attempt: u32,
        token: Option<String>,
        access: u32,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let event = if let Some(token) = token {
            TokenEvent::Fetched {
                attempt,
                token: SyncToken::new(token),
                access: match access {
                    0 => WriteAccess::None,
                    1 => WriteAccess::CommentMarks,
                    2 => WriteAccess::Full,
                    _ => return Err(js(BoundaryError::Invalid("access"))),
                },
            }
        } else {
            TokenEvent::Failed { attempt }
        };
        self.machine
            .sync(SyncInput::Token(event), now, Some(wall))
            .map_err(js)
    }
    /// Durable write completion.
    #[wasm_bindgen(js_name=storageDone)]
    pub fn storage_done(
        &mut self,
        op: u32,
        ok: bool,
        failure: u32,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let result = if ok {
            Ok(())
        } else {
            Err(codec::failure(failure).map_err(js)?)
        };
        self.machine
            .sync(
                SyncInput::Storage(StorageEvent::Done {
                    id: StorageOpId(op),
                    result,
                }),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Durable load completion.
    #[wasm_bindgen(js_name=storageLoaded)]
    pub fn storage_loaded(
        &mut self,
        op: u32,
        msg: Option<Vec<u8>>,
        failure: u32,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let result = match msg {
            Some(msg) => Ok(storage::loaded(
                wire::LocalStateMsg::deserialize(&msg)
                    .map_err(BoundaryError::from)
                    .map_err(js)?,
            )
            .map_err(js)?),
            None => Err(codec::failure(failure).map_err(js)?),
        };
        self.machine
            .sync(
                SyncInput::Storage(StorageEvent::Loaded {
                    id: StorageOpId(op),
                    result,
                }),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Atomic orphan adoption completion; negative count denotes failure.
    #[wasm_bindgen(js_name=storageAdopted)]
    pub fn storage_adopted(
        &mut self,
        op: u32,
        adopted: i32,
        failure: u32,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let result = if adopted >= 0 {
            Ok(adopted as u32)
        } else {
            Err(codec::failure(failure).map_err(js)?)
        };
        self.machine
            .sync(
                SyncInput::Storage(StorageEvent::Adopted {
                    id: StorageOpId(op),
                    result,
                }),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Cross-tab update, awareness or closing notification.
    pub fn chatter(
        &mut self,
        kind: u32,
        data: Vec<u8>,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let message = match kind {
            0 => ChatterMessage::Update(data),
            1 => ChatterMessage::Awareness(data),
            2 => ChatterMessage::Closing(
                codec::session(
                    std::str::from_utf8(&data)
                        .map_err(|_| js(BoundaryError::Invalid("closing session")))?,
                )
                .map_err(js)?,
            ),
            _ => return Err(js(BoundaryError::Invalid("chatter"))),
        };
        self.machine
            .sync(SyncInput::Chatter(message), now, Some(wall))
            .map_err(js)
    }
    /// Lifecycle notification with fresh wall-clock origin.
    pub fn host(&mut self, signal: u32, now: f64, wall: f64) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Host(codec::host(signal).map_err(js)?),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Account/capability notification.
    pub fn authorization(
        &mut self,
        current: bool,
        can_write: bool,
        can_comment: bool,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        self.machine
            .sync(
                SyncInput::Authorization(AuthorizationState {
                    current,
                    can_write,
                    can_comment,
                }),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// The executor's single timer fired.
    pub fn tick(&mut self, now: f64, wall: f64) -> Result<u32, JsError> {
        self.machine
            .sync(SyncInput::Tick, now, Some(wall))
            .map_err(js)
    }
}

#[wasm_bindgen]
impl EditorSession {
    /// DOM-first text input. UTF-16 decoding rejects unpaired surrogates.
    #[wasm_bindgen(js_name=textFromView)]
    pub fn text_from_view(
        &mut self,
        key: u32,
        text: js_sys::JsString,
        anchor_offset: u32,
        focus_offset: u32,
        sel_kind: u32,
        flags: u32,
        composition_data: Option<js_sys::JsString>,
        now: f64,
    ) -> Result<u32, JsError> {
        let key = editor_input::key(key, self.machine.generation());
        let selection = match sel_kind {
            0 => ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(anchor_offset)),
                focus: Point::text(key, Utf16Offset(focus_offset)),
                resolution_dirty: false,
            },
            1 => ViewSelection::KeepModel,
            2 => ViewSelection::None,
            _ => return Err(js(BoundaryError::Invalid("selection kind"))),
        };
        self.machine
            .editor(
                Input::TextFromView {
                    key,
                    text: utf16(text)?,
                    anchor: Some(Utf16Offset(anchor_offset)),
                    focus: Some(Utf16Offset(focus_offset)),
                    composition_end: flags & 1 != 0,
                    composition_data: composition_data.map(utf16).transpose()?,
                    selection,
                },
                now,
            )
            .map_err(js)
    }
    /// Install resolved anchor and focus in one crossing.
    #[wasm_bindgen(js_name=selectionFromView)]
    pub fn selection_from_view(
        &mut self,
        anchor_key: u32,
        anchor_offset: u32,
        anchor_type: u32,
        focus_key: u32,
        focus_offset: u32,
        focus_type: u32,
        now: f64,
    ) -> Result<u32, JsError> {
        let point = |key, offset, kind| {
            editor_input::point(
                &wire::PointMsg {
                    key,
                    offset,
                    _type: kind,
                },
                self.machine.generation(),
            )
        };
        let selection = ViewSelection::Range {
            anchor: point(anchor_key, anchor_offset, anchor_type as u8).map_err(js)?,
            focus: point(focus_key, focus_offset, focus_type as u8).map_err(js)?,
            resolution_dirty: false,
        };
        self.machine
            .editor(
                Input::SelectionFromView {
                    selection,
                    change: None,
                },
                now,
            )
            .map_err(js)
    }
    /// Dispatch an allocation-light standard command.
    pub fn command(
        &mut self,
        code: u32,
        a: u32,
        b: u32,
        text: Option<js_sys::JsString>,
        now: f64,
    ) -> Result<u32, JsError> {
        let command =
            editor_input::command(code, a, b, text.map(utf16).transpose()?).map_err(js)?;
        self.machine
            .editor(
                Input::Command {
                    command,
                    selection: ViewSelection::KeepModel,
                },
                now,
            )
            .map_err(js)
    }
    /// Start IME composition in a text node.
    #[wasm_bindgen(js_name=compositionStart)]
    pub fn composition_start(&mut self, key: u32, offset: u32, now: f64) -> Result<u32, JsError> {
        self.composition_inner(0, key, String::new(), offset, offset, String::new(), now)
    }
    /// End IME composition with the displayed text.
    #[wasm_bindgen(js_name=compositionEnd)]
    pub fn composition_end(
        &mut self,
        key: u32,
        text: js_sys::JsString,
        data: Option<js_sys::JsString>,
        now: f64,
    ) -> Result<u32, JsError> {
        self.composition_inner(
            1,
            key,
            utf16(text)?,
            u32::MAX,
            u32::MAX,
            data.map(utf16).transpose()?.unwrap_or_default(),
            now,
        )
    }
    /// Full IME primitive input, preserving UTF-16 offsets and composition data.
    pub fn composition(
        &mut self,
        kind: u32,
        key: u32,
        text: Option<js_sys::JsString>,
        anchor_offset: u32,
        focus_offset: u32,
        data: Option<js_sys::JsString>,
        now: f64,
    ) -> Result<u32, JsError> {
        self.composition_inner(
            kind,
            key,
            text.map(utf16).transpose()?.unwrap_or_default(),
            anchor_offset,
            focus_offset,
            data.map(utf16).transpose()?.unwrap_or_default(),
            now,
        )
    }
    /// Key routing computed by the host view.
    #[wasm_bindgen(js_name=keyDown)]
    pub fn key_down(
        &mut self,
        code: u32,
        mods: u32,
        routed: u32,
        key: js_sys::JsString,
        now: f64,
    ) -> Result<u32, JsError> {
        let event = KeyEvent {
            key: utf16(key)?.into(),
            code: code.to_string().into(),
            shift: mods & 1 != 0,
            alt: mods & 2 != 0,
            ctrl: mods & 4 != 0,
            meta: mods & 8 != 0,
            repeat: mods & 16 != 0,
            is_composing: mods & 32 != 0,
        };
        let prevent = routed != 0;
        let routed = if routed == 0 {
            None
        } else {
            Some(editor_input::command(routed, 0, 0, None).map_err(js)?)
        };
        self.machine
            .editor(
                Input::KeyDown {
                    event,
                    routed,
                    routed_prevent_default: prevent,
                    selection: ViewSelection::KeepModel,
                },
                now,
            )
            .map_err(js)
    }
    /// Current complete document text in one crossing.
    #[wasm_bindgen(js_name=textContent)]
    pub fn text_content(&self) -> String {
        self.surface().state().root_text_content().to_string()
    }
    /// Text for a node already addressed by the view.
    #[wasm_bindgen(js_name=nodeText)]
    pub fn node_text(&self, key: u32) -> String {
        self.surface()
            .state()
            .view()
            .text_content(editor_input::key(key, self.machine.generation()))
            .into_owned()
    }
    /// Registered types, without instance-specific view flags.
    #[wasm_bindgen(js_name=typeTable)]
    pub fn type_table(&self) -> Result<Vec<u8>, JsError> {
        let rows = self
            .surface()
            .registry()
            .type_table()
            .iter()
            .map(|r| wire::TypeRowMsg {
                index: u32::from(r.index.get()),
                name: r.type_name.into(),
                kind: match r.kind {
                    NodeKind::Element => 1,
                    NodeKind::Text => 2,
                    NodeKind::Decorator => 3,
                    NodeKind::LineBreak => 4,
                },
            })
            .collect();
        bytes(&wire::TypeTableMsg { rows }).map_err(js)
    }
    /// Command listener priorities read once at open.
    #[wasm_bindgen(js_name=listenerTable)]
    pub fn listener_table(&self) -> Result<Vec<u8>, JsError> {
        let rows = self
            .surface()
            .listener_table()
            .iter()
            .map(|(command, priority)| wire::ListenerRowMsg {
                command: format!("{command:?}"),
                priority: u32::from(priority.bits()),
            })
            .collect();
        bytes(&wire::ListenerTableMsg { rows }).map_err(js)
    }
}
impl EditorSession {
    fn surface(&self) -> &document_session::EditorSurface {
        let machine::Session::Editor(session) = &self.machine.session else {
            unreachable!("editor session")
        };
        session.surface()
    }
    fn composition_inner(
        &mut self,
        kind: u32,
        index: u32,
        text: String,
        anchor: u32,
        focus: u32,
        data: String,
        now: f64,
    ) -> Result<u32, JsError> {
        let key = editor_input::key(index, self.machine.generation());
        let selection = if anchor == u32::MAX {
            ViewSelection::KeepModel
        } else {
            ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(anchor)),
                focus: Point::text(key, Utf16Offset(focus)),
                resolution_dirty: false,
            }
        };
        let event = match kind {
            0 => CompositionEvent::Start { data },
            1 => CompositionEvent::End {
                key,
                text,
                anchor: (anchor != u32::MAX).then_some(Utf16Offset(anchor)),
                focus: (focus != u32::MAX).then_some(Utf16Offset(focus)),
                data,
            },
            _ => return Err(js(BoundaryError::Invalid("composition kind"))),
        };
        self.machine
            .editor(Input::Composition { event, selection }, now)
            .map_err(js)
    }
}
fn utf16(text: js_sys::JsString) -> Result<String, JsError> {
    String::from_utf16(&text.iter().collect::<Vec<_>>())
        .map_err(|_| js(BoundaryError::Invalid("LoneSurrogate")))
}
