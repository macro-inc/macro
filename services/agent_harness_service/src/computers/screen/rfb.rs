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
/// only while the viewer drives. xvp (power actions) never passes.
/// Server→client bytes are not parsed.
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
}

impl RfbGate {
    /// A gate at the start of a connection.
    pub fn new() -> Self {
        Self {
            state: GateState::Version,
            pending: Vec::new(),
        }
    }

    /// Take `input` from the viewer and return what goes on to Xvnc. Bytes
    /// of an incomplete message wait for the next call.
    pub fn filter(&mut self, input: &[u8], driving: bool) -> Result<Filtered, GateError> {
        let mut pending = std::mem::take(&mut self.pending);
        pending.extend_from_slice(input);
        let mut forward = Vec::with_capacity(pending.len());
        let mut input_passed = false;
        let mut start = 0;
        while let Some((length, verdict)) = self.next(&pending[start..])? {
            let message = &pending[start..start + length];
            match verdict {
                Verdict::Pass => forward.extend_from_slice(message),
                Verdict::Input if driving => {
                    forward.extend_from_slice(message);
                    input_passed = true;
                }
                Verdict::Input | Verdict::Drop => {}
                Verdict::Shared => forward.push(1),
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
                self.state = match version {
                    b"RFB 003.003\n" => GateState::ClientInit,
                    b"RFB 003.007\n" | b"RFB 003.008\n" => GateState::SecurityChoice,
                    _ => return Err(GateError::Version),
                };
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
        0 => sized(Some(20), Verdict::Pass),
        // SetEncodings
        2 => sized(u16_at(bytes, 2).map(|count| 4 + 4 * count), Verdict::Pass),
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
            drain: drain,
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
