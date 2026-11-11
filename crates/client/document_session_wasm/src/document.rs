use crate::*;
use doc_sync_core::*;
use wasm_bindgen::prelude::*;
/// One host-owned generic document session.
#[wasm_bindgen]
pub struct DocSession {
    pub(crate) machine: machine::Machine,
}
#[wasm_bindgen]
impl DocSession {
    /// Construct a session; reject incompatible ABI majors before decoding configuration.
    pub fn create(abi_major: u32, config: &[u8], now: f64, wall: f64) -> Result<Self, JsError> {
        Ok(Self {
            machine: machine::Machine::create(abi_major, config, now, wall, false).map_err(js)?,
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
impl DocSession {
    /// Read a complete generic value through a typed path, encoded in preorder.
    pub fn read(&self, path: &[u8]) -> Result<Vec<u8>, JsError> {
        let path = generic::path(
            wire::ContainerPathMsg::deserialize(path)
                .map_err(BoundaryError::from)
                .map_err(js)?,
        )
        .map_err(js)?;
        let machine::Session::Doc(session) = &self.machine.session else {
            unreachable!("generic session")
        };
        let value = session
            .read(&path)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        let mut nodes = vec![];
        generic::flatten(&value, String::new(), &mut nodes);
        bytes(&wire::ViewEffectMsg {
            values: nodes,
            ..output::view(1)
        })
        .map_err(js)
    }
}
