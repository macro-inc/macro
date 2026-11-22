//! RFB (VNC) on the harness side: the input gate on a viewer's raw RFB
//! stream, and the injector that types a driver's input into Xvnc over the
//! harness's own RFB connection. RFB is RFC 6143; the extensions noVNC sends
//! are TigerVNC's and QEMU's.

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

use super::tunnel::GuestStream;

#[cfg(test)]
mod test;

/// The longest clipboard a viewer may send, in bytes.
const MAX_CLIPBOARD_BYTES: usize = 1 << 20;
/// The longest text one input event may type, in characters.
const MAX_TEXT_CHARS: usize = 4096;
/// Most scroll clicks one input event sends.
const MAX_SCROLL_CLICKS: u32 = 10;
/// The longest desktop name Xvnc may send in its ServerInit.
const MAX_NAME_BYTES: u32 = 4096;
/// The only pixel size spoken: Xvnc's `-depth 24` ServerInit and noVNC's
/// SetPixelFormat. Fixed, so a viewer can't change how the server side
/// frames pixels under a frame already on its way (and read past it).
const BITS_PER_PIXEL: u8 = 32;

/// What the viewer's RFB stream broke.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GateError {
    /// A protocol version this gate doesn't speak.
    #[error("unsupported RFB version")]
    Version,
    /// A security type other than None.
    #[error("only RFB security type None is allowed")]
    Security,
    /// A message type the gate can't size, so it can't pass the rest.
    #[error("unknown RFB message type {0}")]
    UnknownMessage(u8),
    /// A length beyond what the gate accepts.
    #[error("RFB message too large")]
    TooLarge,
    /// A server message type the server side can't size.
    #[error("unknown RFB server message type {0}")]
    UnknownServerMessage(u8),
    /// A rectangle encoding the server side can't frame.
    #[error("unframeable RFB encoding {0}")]
    UnknownEncoding(i32),
    /// A pixel format other than 32 bits per pixel, true colour.
    #[error("only 32-bit true-colour pixels are allowed")]
    PixelFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GateState {
    Version,
    SecurityChoice,
    ClientInit,
    Messages,
}

/// Filters a viewer's client→server RFB stream: the handshake passes (None
/// security only, shared session forced), and input (KeyEvent,
/// PointerEvent, ClientCutText, QEMU key events, SetDesktopSize) passes
/// only while the viewer drives. xvp (power actions) never passes. The
/// viewer may only ask for encodings [`RfbServerFilter`] can frame.
#[derive(Debug)]
pub struct RfbGate {
    state: GateState,
    pending: Vec<u8>,
}

impl Default for RfbGate {
    fn default() -> Self {
        Self::new()
    }
}

/// What one [`RfbGate::filter`] call lets through.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filtered {
    /// The bytes for Xvnc.
    pub forward: Vec<u8>,
    /// Whether driver input was among them, which keeps the lease alive.
    pub input: bool,
}

/// How the gate treats one complete client message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Pass,
    Input,
    Drop,
    /// A ClientInit, forwarded as a shared one so a viewer never
    /// disconnects the others.
    Shared,
    /// SetEncodings, forwarded with only [`framable`] encodings.
    Encodings,
    /// SetPixelFormat, forwarded only for 32-bit true colour.
    PixelFormat,
}

/// The encodings a viewer may ask for: those whose framing
/// [`RfbServerFilter`] can follow without decoding pixels. Raw, CopyRect,
/// ZRLE; the DesktopSize, LastRect, Cursor, ExtendedDesktopSize and
/// DesktopName pseudo-encodings; QEMU's extended key events; and the JPEG
/// quality and compression levels, which change nothing on the wire here.
/// Everything else is left out of the viewer's SetEncodings: Tight and
/// Hextile (unframeable without decoding), TigerVNC's ExtendedClipboard
/// (`0xC0A1E5CE`: it makes a view-only noVNC desync), fences, continuous
/// updates, xvp and QEMU audio (server messages a viewer has no use for).
fn framable(encoding: i32) -> bool {
    matches!(
        encoding,
        0 | 1 | 16 | -223 | -224 | -239 | -258 | -307 | -308 | -256..=-247 | -32..=-23
    )
}

/// `message` (a whole SetEncodings) with only [`framable`] encodings.
fn framable_encodings(message: &[u8]) -> Vec<u8> {
    let encodings: Vec<&[u8]> = message
        .get(4..)
        .unwrap_or_default()
        .chunks_exact(4)
        .filter(|encoding| {
            framable(i32::from_be_bytes([
                encoding[0],
                encoding[1],
                encoding[2],
                encoding[3],
            ]))
        })
        .collect();
    let count = u16::try_from(encodings.len()).unwrap_or(u16::MAX);
    let mut rewritten = vec![2, 0];
    rewritten.extend_from_slice(&count.to_be_bytes());
    for encoding in encodings {
        rewritten.extend_from_slice(encoding);
    }
    rewritten
}

impl RfbGate {
    /// A gate at the start of a connection.
    pub fn new() -> Self {
        Self {
            state: GateState::Version,
            pending: Vec::new(),
        }
    }

    /// The server side of this connection.
    pub fn server_filter(&self) -> RfbServerFilter {
        RfbServerFilter::new()
    }

    /// Take `input` from the viewer and return what goes on to Xvnc. Bytes
    /// of an incomplete message wait for the next call.
    pub fn filter(&mut self, input: &[u8], driving: bool) -> Result<Filtered, GateError> {
        let mut pending = std::mem::take(&mut self.pending);
        pending.extend_from_slice(input);
        let mut forward = Vec::with_capacity(pending.len());
        let mut input_passed = false;
        let mut start = 0;
        while let Some((length, verdict)) = self.next(pending.get(start..).unwrap_or_default())? {
            // `next` only sizes messages that are wholly in `pending`.
            let message = pending.get(start..start + length).unwrap_or_default();
            match verdict {
                Verdict::Pass => forward.extend_from_slice(message),
                Verdict::Input if driving => {
                    forward.extend_from_slice(message);
                    input_passed = true;
                }
                Verdict::Input | Verdict::Drop => {}
                Verdict::Shared => forward.push(1),
                Verdict::Encodings => forward.extend(framable_encodings(message)),
                Verdict::PixelFormat => {
                    // Bits per pixel at 4, true colour at 7.
                    if message.get(4) != Some(&BITS_PER_PIXEL) || message.get(7) == Some(&0) {
                        return Err(GateError::PixelFormat);
                    }
                    forward.extend_from_slice(message);
                }
            }
            start += length;
        }
        pending.drain(..start);
        self.pending = pending;
        Ok(Filtered {
            forward,
            input: input_passed,
        })
    }

    /// The size and verdict of the next complete message in `bytes`, moving
    /// the handshake along; `None` until it is complete.
    fn next(&mut self, bytes: &[u8]) -> Result<Option<(usize, Verdict)>, GateError> {
        match self.state {
            GateState::Version => {
                let Some(version) = bytes.get(..12) else {
                    return Ok(None);
                };
                // 3.8 only: the server side's framing (see [`RfbServerFilter`])
                // assumes its handshake.
                if version != b"RFB 003.008\n" {
                    return Err(GateError::Version);
                }
                self.state = GateState::SecurityChoice;
                Ok(Some((12, Verdict::Pass)))
            }
            GateState::SecurityChoice => match bytes.first() {
                None => Ok(None),
                Some(1) => {
                    self.state = GateState::ClientInit;
                    Ok(Some((1, Verdict::Pass)))
                }
                Some(_) => Err(GateError::Security),
            },
            GateState::ClientInit => {
                if bytes.is_empty() {
                    return Ok(None);
                }
                self.state = GateState::Messages;
                Ok(Some((1, Verdict::Shared)))
            }
            GateState::Messages => message(bytes),
        }
    }
}

fn u16_at(bytes: &[u8], at: usize) -> Option<usize> {
    let pair = bytes.get(at..at + 2)?;
    Some(usize::from(u16::from_be_bytes([pair[0], pair[1]])))
}

/// The size and verdict of the client message at the start of `bytes`.
fn message(bytes: &[u8]) -> Result<Option<(usize, Verdict)>, GateError> {
    let Some(&kind) = bytes.first() else {
        return Ok(None);
    };
    let sized = |length: Option<usize>, verdict: Verdict| {
        Ok(length
            .filter(|length| bytes.len() >= *length)
            .map(|length| (length, verdict)))
    };
    match kind {
        // SetPixelFormat
        0 => sized(Some(20), Verdict::PixelFormat),
        // SetEncodings
        2 => sized(
            u16_at(bytes, 2).map(|count| 4 + 4 * count),
            Verdict::Encodings,
        ),
        // FramebufferUpdateRequest
        3 => sized(Some(10), Verdict::Pass),
        // KeyEvent
        4 => sized(Some(8), Verdict::Input),
        // PointerEvent
        5 => sized(Some(6), Verdict::Input),
        // ClientCutText; a negative length is the extended clipboard's.
        6 => {
            let Some(header) = bytes.get(4..8) else {
                return Ok(None);
            };
            let length = i32::from_be_bytes([header[0], header[1], header[2], header[3]]);
            let length = usize::try_from(length.unsigned_abs()).map_err(|_| GateError::TooLarge)?;
            if length > MAX_CLIPBOARD_BYTES {
                return Err(GateError::TooLarge);
            }
            sized(Some(8 + length), Verdict::Input)
        }
        // EnableContinuousUpdates
        150 => sized(Some(10), Verdict::Pass),
        // ClientFence
        248 => {
            let Some(&length) = bytes.get(8) else {
                return Ok(None);
            };
            sized(Some(9 + usize::from(length)), Verdict::Pass)
        }
        // xvp: shutdown, reboot, reset.
        250 => sized(Some(4), Verdict::Drop),
        // SetDesktopSize resizes the agent's display.
        251 => {
            let Some(&screens) = bytes.get(6) else {
                return Ok(None);
            };
            sized(Some(8 + 16 * usize::from(screens)), Verdict::Input)
        }
        // QEMU: extended key event, or audio (format change is longer).
        255 => match bytes.get(1) {
            None => Ok(None),
            Some(0) => sized(Some(12), Verdict::Input),
            Some(1) => match u16_at(bytes, 2) {
                None => Ok(None),
                Some(2) => sized(Some(10), Verdict::Pass),
                Some(_) => sized(Some(4), Verdict::Pass),
            },
            Some(_) => Err(GateError::UnknownMessage(kind)),
        },
        other => Err(GateError::UnknownMessage(other)),
    }
}

/// Where the server side is in Xvnc's stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServerState {
    Version,
    SecurityTypes,
    SecurityResult,
    ServerInit,
    Message,
    /// Inside a FramebufferUpdate, with this many rectangles to go.
    Rectangles(u16),
    /// The body of a message or rectangle: passed on, or dropped.
    Body {
        remaining: u64,
        keep: bool,
        then: AfterBody,
    },
}

/// What follows a body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AfterBody {
    Message,
    Rectangles(u16),
}

impl From<AfterBody> for ServerState {
    fn from(after: AfterBody) -> Self {
        match after {
            AfterBody::Message => Self::Message,
            AfterBody::Rectangles(0) => Self::Message,
            AfterBody::Rectangles(left) => Self::Rectangles(left),
        }
    }
}

/// What a complete header decides.
enum Header {
    /// `needed` bytes are needed to decide.
    Needs(usize),
    /// Pass (or drop) the header, then a body of `body` bytes, then go on.
    Decided {
        keep: bool,
        body: u64,
        then: ServerState,
    },
}

/// Frames Xvnc's server→client stream for one viewer and drops its
/// clipboard (ServerCutText) while the viewer doesn't drive: a person who
/// only watches never reads what the driver pastes or the agent copies.
/// Pixel data passes without being decoded or held: only headers are
/// buffered. The viewer's [`RfbGate`] keeps the encodings to those it can
/// frame; anything else ends the connection.
#[derive(Debug)]
pub struct RfbServerFilter {
    state: ServerState,
    header: Vec<u8>,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u64> {
    let quad = bytes.get(at..at + 4)?;
    Some(u64::from(u32::from_be_bytes([
        quad[0], quad[1], quad[2], quad[3],
    ])))
}

impl RfbServerFilter {
    fn new() -> Self {
        Self {
            state: ServerState::Version,
            header: Vec::new(),
        }
    }

    /// Take `input` from Xvnc and return what goes on to the viewer.
    pub fn filter(&mut self, mut input: &[u8], driving: bool) -> Result<Vec<u8>, GateError> {
        let mut forward = Vec::with_capacity(input.len());
        loop {
            if let ServerState::Body {
                remaining,
                keep,
                then,
            } = self.state
            {
                let available = u64::try_from(input.len()).unwrap_or(u64::MAX);
                let taken = remaining.min(available);
                let split = usize::try_from(taken).unwrap_or(input.len());
                let (body, rest) = input.split_at(split);
                if keep {
                    forward.extend_from_slice(body);
                }
                input = rest;
                if taken < remaining {
                    self.state = ServerState::Body {
                        remaining: remaining - taken,
                        keep,
                        then,
                    };
                    return Ok(forward);
                }
                self.state = then.into();
                continue;
            }
            match self.header(driving)? {
                Header::Needs(needed) => {
                    let missing = needed.saturating_sub(self.header.len());
                    if missing == 0 {
                        continue;
                    }
                    if input.is_empty() {
                        return Ok(forward);
                    }
                    let (taken, rest) = input.split_at(missing.min(input.len()));
                    self.header.extend_from_slice(taken);
                    input = rest;
                    if self.header.len() < needed {
                        return Ok(forward);
                    }
                }
                Header::Decided { keep, body, then } => {
                    if keep {
                        forward.extend_from_slice(&self.header);
                    }
                    self.header.clear();
                    self.state = if body == 0 {
                        then
                    } else {
                        let after = match then {
                            ServerState::Rectangles(left) => AfterBody::Rectangles(left),
                            _ => AfterBody::Message,
                        };
                        ServerState::Body {
                            remaining: body,
                            keep,
                            then: after,
                        }
                    };
                }
            }
        }
    }

    /// What the header so far decides, in the current state.
    fn header(&mut self, driving: bool) -> Result<Header, GateError> {
        let header = self.header.as_slice();
        let pass = |body: u64, then: ServerState| Header::Decided {
            keep: true,
            body,
            then,
        };
        Ok(match self.state {
            ServerState::Body { .. } => unreachable!("bodies are passed before headers"),
            ServerState::Version => match header.get(..12) {
                None => Header::Needs(12),
                Some(b"RFB 003.008\n") => pass(0, ServerState::SecurityTypes),
                Some(_) => return Err(GateError::Version),
            },
            ServerState::SecurityTypes => match header.first() {
                None => Header::Needs(1),
                Some(0) => return Err(GateError::Security),
                Some(&count) => {
                    let needed = 1 + usize::from(count);
                    match header.get(1..needed) {
                        None => Header::Needs(needed),
                        Some(types) if types.contains(&1) => pass(0, ServerState::SecurityResult),
                        Some(_) => return Err(GateError::Security),
                    }
                }
            },
            ServerState::SecurityResult => match u32_at(header, 0) {
                None => Header::Needs(4),
                Some(0) => pass(0, ServerState::ServerInit),
                Some(_) => return Err(GateError::Security),
            },
            ServerState::ServerInit => match (header.get(4), u32_at(header, 20)) {
                (Some(&bits), Some(name)) => {
                    if name > u64::from(MAX_NAME_BYTES) {
                        return Err(GateError::TooLarge);
                    }
                    if bits != BITS_PER_PIXEL {
                        return Err(GateError::PixelFormat);
                    }
                    pass(name, ServerState::Message)
                }
                _ => Header::Needs(24),
            },
            ServerState::Message => match header.first() {
                None => Header::Needs(1),
                // FramebufferUpdate
                Some(0) => match header.get(2..4) {
                    None => Header::Needs(4),
                    Some(count) => pass(
                        0,
                        AfterBody::Rectangles(u16::from_be_bytes([count[0], count[1]])).into(),
                    ),
                },
                // SetColourMapEntries
                Some(1) => match header.get(4..6) {
                    None => Header::Needs(6),
                    Some(count) => pass(
                        6 * u64::from(u16::from_be_bytes([count[0], count[1]])),
                        ServerState::Message,
                    ),
                },
                // Bell
                Some(2) => pass(0, ServerState::Message),
                // ServerCutText; a negative length is the extended clipboard's.
                Some(3) => match header.get(4..8) {
                    None => Header::Needs(8),
                    Some(length) => Header::Decided {
                        keep: driving,
                        body: u64::from(
                            i32::from_be_bytes([length[0], length[1], length[2], length[3]])
                                .unsigned_abs(),
                        ),
                        then: ServerState::Message,
                    },
                },
                // EndOfContinuousUpdates
                Some(150) => pass(0, ServerState::Message),
                // ServerFence
                Some(248) => match header.get(8) {
                    None => Header::Needs(9),
                    Some(&length) => pass(u64::from(length), ServerState::Message),
                },
                Some(&other) => return Err(GateError::UnknownServerMessage(other)),
            },
            ServerState::Rectangles(left) => {
                let Some(rectangle) = header.get(..12) else {
                    return Ok(Header::Needs(12));
                };
                let width = u64::from(u16::from_be_bytes([rectangle[4], rectangle[5]]));
                let height = u64::from(u16::from_be_bytes([rectangle[6], rectangle[7]]));
                let encoding =
                    i32::from_be_bytes([rectangle[8], rectangle[9], rectangle[10], rectangle[11]]);
                let bytes_per_pixel = u64::from(BITS_PER_PIXEL / 8);
                let next: ServerState = AfterBody::Rectangles(left.saturating_sub(1)).into();
                match encoding {
                    // Raw
                    0 => pass(width * height * bytes_per_pixel, next),
                    // CopyRect
                    1 => pass(4, next),
                    // ZRLE, and DesktopName: a length, then that many bytes.
                    16 | -307 => match u32_at(header, 12) {
                        None => Header::Needs(16),
                        Some(length) => pass(length, next),
                    },
                    // Cursor: its pixels, then a bitmask.
                    -239 => pass(
                        width * height * bytes_per_pixel + width.div_ceil(8) * height,
                        next,
                    ),
                    // ExtendedDesktopSize: a screen count, padding, the screens.
                    -308 => match header.get(12) {
                        None => Header::Needs(16),
                        Some(&screens) => {
                            if header.len() < 16 {
                                Header::Needs(16)
                            } else {
                                pass(16 * u64::from(screens), next)
                            }
                        }
                    },
                    // DesktopSize, QEMU extended key events: no body.
                    -223 | -258 => pass(0, next),
                    // LastRect ends the update.
                    -224 => pass(0, ServerState::Message),
                    other => return Err(GateError::UnknownEncoding(other)),
                }
            }
        })
    }
}

/// A driver's input, in guest pixels. The socket's `input` message.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    /// Move the pointer with these buttons held (RFB button mask).
    Pointer {
        /// Guest x.
        x: i32,
        /// Guest y.
        y: i32,
        /// RFB button mask: bit 0 left, 1 middle, 2 right.
        buttons: u8,
    },
    /// Press or release one X keysym.
    Key {
        /// The keysym.
        keysym: u32,
        /// Pressed, or released.
        down: bool,
    },
    /// Type text, one keysym per character.
    Text {
        /// The text.
        text: String,
    },
    /// Scroll at a point: negative `dy` up, negative `dx` left, one click
    /// per unit.
    Scroll {
        /// Guest x.
        x: i32,
        /// Guest y.
        y: i32,
        /// Horizontal clicks.
        dx: i32,
        /// Vertical clicks.
        dy: i32,
    },
    /// Set the guest's clipboard.
    Clipboard {
        /// The text.
        text: String,
    },
}

/// Why injecting input failed.
#[derive(Debug, thiserror::Error)]
pub enum InjectError {
    /// The guest's RFB connection failed.
    #[error("the computer's display connection failed")]
    Io(#[from] std::io::Error),
    /// Xvnc answered something this client doesn't speak.
    #[error("the computer's display refused the connection: {0}")]
    Handshake(&'static str),
}

/// The RFB bytes for `event`, given the buttons held before it. Returns the
/// bytes and the buttons held after.
pub fn encode(event: &InputEvent, held: u8) -> (Vec<u8>, u8) {
    match event {
        InputEvent::Pointer { x, y, buttons } => (pointer(*x, *y, *buttons), *buttons),
        InputEvent::Key { keysym, down } => (key(*keysym, *down), held),
        InputEvent::Text { text } => {
            let mut bytes = Vec::new();
            for character in text.chars().take(MAX_TEXT_CHARS) {
                let keysym = keysym_of(character);
                bytes.extend(key(keysym, true));
                bytes.extend(key(keysym, false));
            }
            (bytes, held)
        }
        InputEvent::Scroll { x, y, dx, dy } => {
            // Buttons 4/5 scroll up/down, 6/7 left/right: press and release
            // each click on top of whatever is held.
            let mut bytes = Vec::new();
            let axes = [(*dy, 1u8 << 3, 1u8 << 4), (*dx, 1u8 << 5, 1u8 << 6)];
            for (delta, negative, positive) in axes {
                let button = if delta < 0 { negative } else { positive };
                for _ in 0..delta.unsigned_abs().min(MAX_SCROLL_CLICKS) {
                    bytes.extend(pointer(*x, *y, held | button));
                    bytes.extend(pointer(*x, *y, held));
                }
            }
            (bytes, held)
        }
        InputEvent::Clipboard { text } => {
            // ClientCutText is Latin-1.
            let latin1: Vec<u8> = text
                .chars()
                .map(|character| u8::try_from(u32::from(character)).unwrap_or(b'?'))
                .take(MAX_CLIPBOARD_BYTES)
                .collect();
            let mut bytes = vec![6, 0, 0, 0];
            let length = u32::try_from(latin1.len()).unwrap_or(u32::MAX);
            bytes.extend(length.to_be_bytes());
            bytes.extend(latin1);
            (bytes, held)
        }
    }
}

fn clamp_coordinate(value: i32) -> [u8; 2] {
    u16::try_from(value.max(0))
        .unwrap_or(u16::MAX)
        .to_be_bytes()
}

fn pointer(x: i32, y: i32, buttons: u8) -> Vec<u8> {
    let [x_high, x_low] = clamp_coordinate(x);
    let [y_high, y_low] = clamp_coordinate(y);
    vec![5, buttons, x_high, x_low, y_high, y_low]
}

fn key(keysym: u32, down: bool) -> Vec<u8> {
    let mut bytes = vec![4, u8::from(down), 0, 0];
    bytes.extend(keysym.to_be_bytes());
    bytes
}

/// The X keysym that types `character`: Latin-1 keysyms are their code
/// points, everything else is a Unicode keysym.
fn keysym_of(character: char) -> u32 {
    let code = u32::from(character);
    match character {
        '\n' | '\r' => 0xff0d,
        '\t' => 0xff09,
        '\u{8}' => 0xff08,
        _ if (0x20..=0x7e).contains(&code) || (0xa0..=0xff).contains(&code) => code,
        _ => 0x0100_0000 + code,
    }
}

/// The harness's own RFB connection to a computer's Xvnc, through which a
/// driver's typed `input` messages reach the guest. It never
/// asks for frames.
pub struct RfbInjector {
    writer: tokio::io::WriteHalf<GuestStream>,
    held: u8,
    drain: tokio::task::JoinHandle<()>,
}

impl RfbInjector {
    /// Shake hands with Xvnc over `stream`.
    pub async fn connect(stream: GuestStream) -> Result<Self, InjectError> {
        let (mut reader, mut writer) = tokio::io::split(stream);

        let mut version = [0u8; 12];
        reader.read_exact(&mut version).await?;
        if !version.starts_with(b"RFB 003.") {
            return Err(InjectError::Handshake("not RFB"));
        }
        writer.write_all(b"RFB 003.008\n").await?;

        let count = reader.read_u8().await?;
        if count == 0 {
            return Err(InjectError::Handshake("no security types"));
        }
        let mut types = vec![0u8; usize::from(count)];
        reader.read_exact(&mut types).await?;
        if !types.contains(&1) {
            return Err(InjectError::Handshake("security type None is off"));
        }
        writer.write_all(&[1]).await?;
        if reader.read_u32().await? != 0 {
            return Err(InjectError::Handshake("security failed"));
        }

        // Shared, so viewers stay connected.
        writer.write_all(&[1]).await?;
        let mut server_init = [0u8; 20];
        reader.read_exact(&mut server_init).await?;
        let name_length = reader.read_u32().await?;
        if name_length > MAX_NAME_BYTES {
            return Err(InjectError::Handshake("desktop name too long"));
        }
        let mut name = vec![0u8; usize::try_from(name_length).unwrap_or(0)];
        reader.read_exact(&mut name).await?;

        // Xvnc may still send bells and clipboard changes; nobody reads them.
        let drain = tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            let _ = tokio::io::copy(&mut reader, &mut sink).await;
        });
        Ok(Self {
            writer,
            held: 0,
            drain,
        })
    }

    /// Type one event into the guest.
    pub async fn send(&mut self, event: &InputEvent) -> Result<(), InjectError> {
        let (bytes, held) = encode(event, self.held);
        self.writer.write_all(&bytes).await?;
        self.writer.flush().await?;
        self.held = held;
        Ok(())
    }
}

impl Drop for RfbInjector {
    fn drop(&mut self) {
        self.drain.abort();
    }
}
