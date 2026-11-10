use crate::*;
use doc_sync_core::*;
use lexical_model::*;
use wasm_bindgen::prelude::*;
/// One host-owned editor session.
#[wasm_bindgen]
pub struct EditorSession {
    pub(crate) machine: machine::Machine,
    pub(crate) hostname: Option<String>,
    #[cfg(feature = "compatibility")]
    pub(crate) compatibility: Option<crate::compatibility::Host>,
}
impl EditorSession {
    fn reject_compat_view_commands(&self) -> Result<(), BoundaryError> {
        #[cfg(feature = "compatibility")]
        if self.compatibility.is_some() {
            return Err(BoundaryError::Invalid("ordinary view commands do not use compatibility scopes"));
        }
        Ok(())
    }
}
#[wasm_bindgen]
impl EditorSession {
    /// Construct the application's MarkdownSync registry and projection policy.
    #[wasm_bindgen(js_name=createMacro)]
    pub fn create_macro(
        abi_major: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        hostname: Option<String>,
    ) -> Result<Self, JsError> {
        Ok(Self {
            machine: machine::Machine::create_macro(abi_major, config, now, wall).map_err(js)?,
            hostname,
            #[cfg(feature = "compatibility")]
            compatibility: None,
        })
    }
    /// Construct the application editor with the host's actual instance namespace.
    #[wasm_bindgen(js_name=createMacroWithNamespace)]
    pub fn create_macro_with_namespace(
        abi_major: u32,
        config: &[u8],
        now: f64,
        wall: f64,
        namespace: &str,
        hostname: Option<String>,
    ) -> Result<Self, JsError> {
        Ok(Self {
            machine: machine::Machine::create_macro_with_namespace(
                abi_major, config, now, wall, namespace,
            )
            .map_err(js)?,
            hostname,
            #[cfg(feature = "compatibility")]
            compatibility: None,
        })
    }
    /// Construct a session; reject incompatible ABI majors before decoding configuration.
    pub fn create(abi_major: u32, config: &[u8], now: f64, wall: f64) -> Result<Self, JsError> {
        Ok(Self {
            machine: machine::Machine::create(abi_major, config, now, wall, true).map_err(js)?,
            hostname: None,
            #[cfg(feature = "compatibility")]
            compatibility: None,
        })
    }
    /// Observe current authorization using the generated Access enum values.
    /// This neither consumes output nor authorizes a later mutation.
    #[wasm_bindgen(js_name=effectiveAccess)]
    pub fn effective_access(&self) -> u8 {
        u8::from(self.machine.effective_access())
    }
    /// Return this session's checked ordinary view-command owner identity.
    #[wasm_bindgen(js_name=viewCommandOwner)]
    pub fn view_command_owner(&mut self) -> Result<u64, JsError> {
        self.reject_compat_view_commands().map_err(js)?;
        Ok(self.machine.view_commands().map_err(js)?.owner())
    }
    /// Register Enter at the named native priority, after existing equal listeners.
    #[wasm_bindgen(js_name=registerViewEnter)]
    pub fn register_view_enter(&mut self, callback: u64, priority: u8) -> Result<u64, JsError> {
        self.reject_compat_view_commands().map_err(js)?;
        let registry = self.machine.view_commands().map_err(js)?;
        let machine::Session::Editor(session) = &mut self.machine.session else {
            return Err(js(BoundaryError::Invalid("editor required")));
        };
        registry
            .register(session, callback, priority)
            .map_err(|error| js(error.into()))
    }
    /// Remove a stable logical Enter registration; repeated cleanup is harmless.
    #[wasm_bindgen(js_name=unregisterViewEnter)]
    pub fn unregister_view_enter(&mut self, handle: u64) -> Result<(), JsError> {
        self.reject_compat_view_commands().map_err(js)?;
        let registry = self.machine.view_commands().map_err(js)?;
        let machine::Session::Editor(session) = &mut self.machine.session else {
            return Err(js(BoundaryError::Invalid("editor required")));
        };
        registry
            .unregister(session, handle)
            .map_err(|error| js(error.into()))
    }
    /// Take only the actual reported callback-failure scope after consuming output.
    #[wasm_bindgen(js_name=takeViewCommandFailure)]
    pub fn take_view_command_failure(&self) -> Result<Option<crate::ViewCommandFailure>, JsError> {
        self.machine.take_view_command_failure().map_err(js)
    }
    /// Admit a genuine programmatic Enter with an explicit null JS event payload.
    #[wasm_bindgen(js_name=viewCommandEnter)]
    pub fn view_command_enter(&mut self, now: f64, wall: f64) -> Result<u32, JsError> {
        self.reject_compat_view_commands().map_err(js)?;
        self.machine
            .call(
                document_session::SessionInput::Editor(Input::Command {
                    command: Command::Key {
                        command: KeyCommand::Enter,
                        event: None,
                    },
                    selection: ViewSelection::KeepModel,
                }),
                now,
                Some(wall),
            )
            .map_err(js)
    }
    /// Deliver a cold Bebop input.
    pub fn input(&mut self, msg: &[u8], now: f64, wall: f64) -> Result<u32, JsError> {
        self.machine.input(msg, now, wall).map_err(js)
    }
    /// Copy pending output; no borrowed linear-memory view escapes.
    #[wasm_bindgen(js_name=takeOutput)]
    pub fn take_output(&mut self) -> Vec<u8> {
        self.machine.take_output()
    }
    /// Retire the detached synchronous view's component observation baseline.
    /// Queued output and durable session state remain owned by the executor.
    #[wasm_bindgen(js_name=retireViewObservation)]
    pub fn retire_view_observation(&mut self) {
        self.machine.decorator_observer.retire();
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
            Some(msg) => wire::LocalStateMsg::deserialize(&msg)
                .map_err(BoundaryError::from)
                .and_then(storage::loaded)
                .map_err(|_| StorageFailure::Corrupt),
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
    #[expect(
        clippy::too_many_arguments,
        reason = "Primitive ABI avoids allocating encoded hot inputs"
    )]
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
        let text = match utf16(text) {
            Ok(text) => text,
            Err(_) => return self.machine.reject_text("LoneSurrogate").map_err(js),
        };
        let composition_data = match composition_data.map(utf16).transpose() {
            Ok(data) => data,
            Err(_) => return self.machine.reject_text("LoneSurrogate").map_err(js),
        };
        let key = editor_input::key(key, self.machine.generation());
        let selection = match sel_kind {
            0 => ViewSelection::Range {
                anchor: Point::text(key, Utf16Offset(anchor_offset)),
                focus: Point::text(key, Utf16Offset(focus_offset)),
                resolution_dirty: false,
            },
            1 => ViewSelection::KeepModel,
            2 => ViewSelection::None,
            _ => return self.machine.reject_text("selection kind").map_err(js),
        };
        self.machine
            .editor(
                Input::TextFromView {
                    key,
                    text,
                    anchor: Some(Utf16Offset(anchor_offset)),
                    focus: Some(Utf16Offset(focus_offset)),
                    composition_end: flags & 1 != 0,
                    composition_data,
                    selection,
                },
                now,
            )
            .map_err(js)
    }
    /// Install resolved anchor and focus in one crossing.
    #[wasm_bindgen(js_name=selectionFromView)]
    #[expect(
        clippy::too_many_arguments,
        reason = "Primitive ABI avoids allocating encoded hot inputs"
    )]
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
            anchor: point(
                anchor_key,
                anchor_offset,
                u8::try_from(anchor_type).map_err(|_| js(BoundaryError::Invalid("point kind")))?,
            )
            .map_err(js)?,
            focus: point(
                focus_key,
                focus_offset,
                u8::try_from(focus_type).map_err(|_| js(BoundaryError::Invalid("point kind")))?,
            )
            .map_err(js)?,
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
    #[expect(
        clippy::too_many_arguments,
        reason = "Primitive ABI avoids allocating encoded hot inputs"
    )]
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
    #[expect(
        clippy::too_many_arguments,
        reason = "Resolved selection uses primitive hot ABI fields"
    )]
    pub fn key_down(
        &mut self,
        code: u32,
        mods: u32,
        routed: u32,
        key: js_sys::JsString,
        anchor_key: u32,
        anchor_offset: u32,
        anchor_type: u32,
        focus_key: u32,
        focus_offset: u32,
        focus_type: u32,
        selection_kind: u32,
        now: f64,
    ) -> Result<u32, JsError> {
        let point = |key, offset, kind| {
            editor_input::point(
                &wire::PointMsg {
                    key,
                    offset,
                    _type: u8::try_from(kind).map_err(|_| BoundaryError::Invalid("point kind"))?,
                },
                self.machine.generation(),
            )
        };
        let selection = match selection_kind {
            0 => ViewSelection::Range {
                anchor: point(anchor_key, anchor_offset, anchor_type).map_err(js)?,
                focus: point(focus_key, focus_offset, focus_type).map_err(js)?,
                resolution_dirty: false,
            },
            1 => ViewSelection::KeepModel,
            2 => ViewSelection::None,
            _ => return Err(js(BoundaryError::Invalid("selection kind"))),
        };
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
            let command = match event.key.as_ref() {
                "Enter" => Some(KeyCommand::Enter),
                "Backspace" => Some(KeyCommand::Backspace),
                "Delete" => Some(KeyCommand::Delete),
                "Tab" => Some(KeyCommand::Tab),
                "Escape" => Some(KeyCommand::Escape),
                " " => Some(KeyCommand::Space),
                "ArrowUp" => Some(KeyCommand::ArrowUp),
                "ArrowDown" => Some(KeyCommand::ArrowDown),
                "ArrowLeft" => Some(KeyCommand::ArrowLeft),
                "ArrowRight" => Some(KeyCommand::ArrowRight),
                "Home" => Some(KeyCommand::MoveToStart),
                "End" => Some(KeyCommand::MoveToEnd),
                _ => None,
            };
            command.map(|command| Command::Key {
                command,
                event: Some(event.clone()),
            })
        } else {
            Some(editor_input::command(routed, 0, 0, None).map_err(js)?)
        };
        self.machine
            .editor(
                Input::KeyDown {
                    event,
                    routed,
                    routed_prevent_default: prevent,
                    selection,
                },
                now,
            )
            .map_err(js)
    }
    /// Cold recovery patch from an empty view; does not reset sync or history.
    pub fn initialize(&mut self) -> Result<Vec<u8>, JsError> {
        self.machine.initialize_view().map_err(js)
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
            .text(editor_input::key(key, self.machine.generation()))
            .map(|node| node.text.as_str().to_owned())
            .unwrap_or_default()
    }
    /// Registered types and static predicate flags; bit zero marks known flags.
    #[wasm_bindgen(js_name=typeTable)]
    pub fn type_table(&self) -> Result<Vec<u8>, JsError> {
        let rows = self
            .surface()
            .registry()
            .type_table()
            .iter()
            .map(|r| wire::TypeRowMsg {
                flags: r.flags.map_or(0, |f| {
                    1 | (u32::from(f.is_inline) << 1)
                        | (u32::from(f.can_insert_text_before) << 2)
                        | (u32::from(f.can_insert_text_after) << 3)
                        | (u32::from(f.is_keyboard_selectable) << 4)
                        | (u32::from(f.is_isolated) << 5)
                        | (u32::from(f.is_shadow_root) << 6)
                }),
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
    pub(crate) fn surface(&self) -> &document_session::EditorSurface {
        let machine::Session::Editor(session) = &self.machine.session else {
            unreachable!("editor session")
        };
        session.surface()
    }
    #[expect(
        clippy::too_many_arguments,
        reason = "Shares the primitive composition ABI implementation"
    )]
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
            2 => CompositionEvent::Clear,
            _ => return Err(js(BoundaryError::Invalid("composition kind"))),
        };
        self.machine
            .editor(Input::Composition { event, selection }, now)
            .map_err(js)
    }
}
fn utf16(text: js_sys::JsString) -> Result<String, JsError> {
    let decoded = text
        .as_string()
        .ok_or_else(|| js(BoundaryError::Invalid("string")))?;
    // JS replaces lone surrogates during UTF-8 transfer. Only ambiguous replacement
    // characters need the slower code-unit validation; normal typing stays bulk.
    if decoded.contains('\u{fffd}') {
        return String::from_utf16(&text.iter().collect::<Vec<_>>())
            .map_err(|_| js(BoundaryError::Invalid("LoneSurrogate")));
    }
    Ok(decoded)
}

#[wasm_bindgen]
impl EditorSession {
    /// Bulk Markdown export: Macro sessions use internal/external lists for flavors 0/1.
    /// Built-in sessions retain upstream conversion and flavor-specific indentation.
    pub fn markdown(&self, flavor: u32) -> Result<String, JsError> {
        query::markdown_for_session(self, flavor, false).map_err(js)
    }
    /// Bulk typed read queries; no per-node JavaScript callbacks.
    pub fn query(&self, msg: &[u8]) -> Result<Vec<u8>, JsError> {
        query::query(
            self,
            wire::QueryMsg::deserialize(msg)
                .map_err(BoundaryError::from)
                .map_err(js)?,
        )
        .and_then(|reply| bytes(&reply))
        .map_err(js)
    }
    /// Clipboard formats: kind 0 copy, 1 cut, 2 complete block-drag subtrees.
    pub fn clipboard(&self, kind: u32) -> Result<Vec<u8>, JsError> {
        if kind > 2 {
            return Err(js(BoundaryError::Invalid("clipboard kind")));
        }
        query::clipboard(
            self.surface().state(),
            self.surface().namespace(),
            kind == 2,
            query::export_flavor(self),
        )
        .and_then(|reply| bytes(&reply))
        .map_err(js)
    }
    /// Development checksum of the complete rendered tree.
    #[wasm_bindgen(js_name=debugViewChecksum)]
    pub fn debug_view_checksum(&self) -> Result<u32, JsError> {
        let json = self
            .surface()
            .state()
            .to_json()
            .map_err(BoundaryError::from)
            .map_err(js)?;
        let serialized = serde_json::to_vec(&json)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        Ok(serialized.iter().fold(2166136261u32, |hash, byte| {
            (hash ^ u32::from(*byte)).wrapping_mul(16777619)
        }))
    }
    /// Full development insertion predicate using the host's resolved selection.
    #[wasm_bindgen(js_name=debugInsertion)]
    pub fn debug_insertion(
        &self,
        selection: &[u8],
        format: u32,
        style: String,
        text: js_sys::JsString,
        facts: u32,
    ) -> Result<bool, JsError> {
        let selection = wire::SelectionMsg::deserialize(selection)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        let ViewSelection::Range { anchor, focus, .. } =
            editor_input::selection(&selection, self.machine.generation()).map_err(js)?
        else {
            return Ok(true);
        };
        let mut range = RangeSelection::new(anchor, focus);
        range.format = TextFormat::from_bits(format)
            .ok_or_else(|| js(BoundaryError::Invalid("text format")))?;
        range.style = style.into();
        self.surface()
            .state()
            .view()
            .should_prevent_default_and_insert_text(
                &range,
                &utf16(text)?,
                InsertTextFacts {
                    dangling_input: facts & 1 != 0,
                    dom_anchor_not_backing_text: facts & 2 != 0,
                    target_range_mismatch: facts & 4 != 0,
                },
            )
            .map_err(BoundaryError::from)
            .map_err(js)
    }
    /// Development cross-check for the host insertion predicate.
    #[wasm_bindgen(js_name=debugShouldPreventDefault)]
    pub fn debug_should_prevent_default(
        &self,
        index: u32,
        offset: u32,
        text: js_sys::JsString,
    ) -> Result<bool, JsError> {
        let key = editor_input::key(index, self.machine.generation());
        let range = RangeSelection::new(
            Point::text(key, Utf16Offset(offset)),
            Point::text(key, Utf16Offset(offset)),
        );
        self.surface()
            .state()
            .view()
            .should_prevent_default_and_insert_text(
                &range,
                &utf16(text)?,
                InsertTextFacts::default(),
            )
            .map_err(BoundaryError::from)
            .map_err(js)
    }
}
