use crate::*;
use doc_sync_core::*;
/// Shared physical transport with native per-document subscription policy.
#[wasm_bindgen]
pub struct SyncRouter {
    core: RouterCore,
    out: RouterOutput,
    output: Vec<u8>,
    wake: Option<Millis>,
}
#[wasm_bindgen]
impl SyncRouter {
    /// Construct the shared router; configuration uses the same policy envelope.
    pub fn create(abi: u32, config: &[u8], now: f64, wall: f64) -> Result<SyncRouter, JsError> {
        if abi != generated::ABI_MAJOR {
            return Err(js(BoundaryError::AbiMismatch));
        }
        let config = wire::SessionConfigMsg::deserialize(config)
            .map_err(BoundaryError::from)
            .map_err(js)?;
        Ok(Self {
            core: RouterCore::new(
                RouterConfig {
                    traceparent: (!config.traceparent.is_empty()).then_some(config.traceparent),
                    ..RouterConfig::default()
                },
                codec::now(now, wall).map_err(js)?,
            ),
            out: RouterOutput::default(),
            output: vec![],
            wake: None,
        })
    }
    /// Attach one session owner to a document route.
    pub fn attach(&mut self, doc: String, token: Option<String>) -> Result<u32, JsError> {
        self.core.attach(
            parse(&doc).map_err(js)?,
            token.map(SyncToken::new),
            &mut self.out,
        );
        self.finish().map_err(js)
    }
    /// Detach one owner without closing other routes.
    pub fn detach(&mut self, doc: String) -> Result<u32, JsError> {
        self.core.detach(&parse(&doc).map_err(js)?, &mut self.out);
        self.finish().map_err(js)
    }
    /// Forward an already framed document message.
    pub fn send(
        &mut self,
        doc: String,
        frame: Vec<u8>,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        self.handle(
            RouterInput::Send {
                doc: parse(&doc).map_err(js)?,
                frame,
            },
            now,
            wall,
        )
    }
    /// Refresh a route independently of the physical socket.
    pub fn reconnect(&mut self, doc: String, now: f64, wall: f64) -> Result<u32, JsError> {
        self.handle(RouterInput::Reconnect(parse(&doc).map_err(js)?), now, wall)
    }
    /// Per-document token fetch completion.
    #[wasm_bindgen(js_name=tokenFetched)]
    pub fn token_fetched(
        &mut self,
        doc: String,
        attempt: u32,
        token: Option<String>,
        access: u32,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        let event = match token {
            Some(token) => TokenEvent::Fetched {
                attempt,
                token: SyncToken::new(token),
                access: access_value(access).map_err(js)?,
            },
            None => TokenEvent::Failed { attempt },
        };
        self.handle(
            RouterInput::Token {
                doc: parse(&doc).map_err(js)?,
                event,
            },
            now,
            wall,
        )
    }
    /// Physical connection opened.
    #[wasm_bindgen(js_name=socketOpened)]
    pub fn socket_opened(&mut self, conn: u32, now: f64, wall: f64) -> Result<u32, JsError> {
        self.handle(
            RouterInput::Socket {
                conn: ConnId(conn),
                event: SocketEvent::Opened,
            },
            now,
            wall,
        )
    }
    /// One outer router frame, decoded entirely by Rust.
    #[wasm_bindgen(js_name=socketFrame)]
    pub fn socket_frame(
        &mut self,
        conn: u32,
        frame: Vec<u8>,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        self.handle(
            RouterInput::Socket {
                conn: ConnId(conn),
                event: SocketEvent::Frame(frame),
            },
            now,
            wall,
        )
    }
    /// Physical protocol text.
    #[wasm_bindgen(js_name=socketText)]
    pub fn socket_text(
        &mut self,
        conn: u32,
        text: String,
        now: f64,
        wall: f64,
    ) -> Result<u32, JsError> {
        self.handle(
            RouterInput::Socket {
                conn: ConnId(conn),
                event: SocketEvent::Text(text),
            },
            now,
            wall,
        )
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
        self.handle(
            RouterInput::Socket {
                conn: ConnId(conn),
                event: SocketEvent::Closed { code, clean },
            },
            now,
            wall,
        )
    }
    /// Lifecycle and network signal.
    pub fn host(&mut self, signal: u32, now: f64, wall: f64) -> Result<u32, JsError> {
        self.handle(
            RouterInput::Host(codec::host(signal).map_err(js)?),
            now,
            wall,
        )
    }
    /// Shared timer callback.
    pub fn tick(&mut self, now: f64, wall: f64) -> Result<u32, JsError> {
        self.handle(RouterInput::Tick, now, wall)
    }
    /// Copy pending router I/O and per-document events.
    #[wasm_bindgen(js_name=takeOutput)]
    pub fn take_output(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.output)
    }
    /// Earliest shared deadline or -1.
    #[wasm_bindgen(js_name=wakeAt)]
    pub fn wake_at(&self) -> f64 {
        self.wake.map_or(-1.0, |v| v.0 as f64)
    }
}
impl SyncRouter {
    fn handle(&mut self, input: RouterInput, now: f64, wall: f64) -> Result<u32, JsError> {
        self.core
            .handle(codec::now(now, wall).map_err(js)?, input, &mut self.out);
        self.finish().map_err(js)
    }
    fn finish(&mut self) -> Result<u32, BoundaryError> {
        let output = document_session::SessionOutput {
            io: std::mem::take(&mut self.out.io),
            ..Default::default()
        };
        let mut flags = output::encode(&output, false, &mut self.output)?;
        if !self.out.to_sessions.is_empty() {
            if self.output.is_empty() {
                for word in [
                    0x4d534553,
                    generated::ABI_MAJOR,
                    generated::DIFF_FORMAT_VERSION,
                    0,
                    0,
                    0,
                ] {
                    self.output.extend(word.to_le_bytes());
                }
            }
            let count = u32::from_le_bytes(
                self.output[20..24]
                    .try_into()
                    .map_err(|_| BoundaryError::Invalid("router output"))?,
            );
            let added = self.out.to_sessions.len() as u32;
            for (doc, event) in self.out.to_sessions.drain(..) {
                let route = route(doc.to_string(), event);
                output::entry(&mut self.output, 12, 0, 0, &bytes(&route)?);
            }
            self.output[20..24].copy_from_slice(&(count + added).to_le_bytes());
            flags |= 2;
        }
        if self.wake != self.out.wake_at {
            self.wake = self.out.wake_at;
            flags |= 4;
        }
        Ok(flags)
    }
}
fn parse(doc: &str) -> Result<SyncDocId, BoundaryError> {
    doc.parse().map_err(|_| BoundaryError::Invalid("document"))
}
pub(crate) fn access_value(value: u32) -> Result<WriteAccess, BoundaryError> {
    Ok(match value {
        0 => WriteAccess::None,
        1 => WriteAccess::CommentMarks,
        2 => WriteAccess::Full,
        _ => return Err(BoundaryError::Invalid("access")),
    })
}
fn route(doc: String, event: RouteEvent) -> wire::RouteMsg {
    let mut m = wire::RouteMsg {
        doc,
        kind: 0,
        conn: 0,
        access: 0,
        code: 0,
        frame: vec![],
    };
    match event {
        RouteEvent::Subscribed { access, conn } => {
            m.conn = conn.0;
            m.access = match access {
                WriteAccess::None => 0,
                WriteAccess::CommentMarks => 1,
                WriteAccess::Full => 2,
            };
        }
        RouteEvent::Frame { conn, frame } => {
            m.kind = 1;
            m.conn = conn.0;
            m.frame = frame;
        }
        RouteEvent::Closed { conn, code } => {
            m.kind = 2;
            m.conn = conn.0;
            m.code = u32::from(code);
        }
    }
    m
}
