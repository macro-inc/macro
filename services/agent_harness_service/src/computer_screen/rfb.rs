//! The viewer-to-computer half of RFB (VNC), filtered for view-only viewers.
//!
//! A view-only viewer may finish the handshake and ask for framebuffer
//! updates, but its keyboard, pointer, clipboard, desktop-resize and power
//! (xvp) messages never reach the computer. RFB client messages carry no
//! length prefix, so every message type a viewer might send has to be
//! measured; an unknown one ends the stream rather than guessing (fail
//! closed). Only RFB 3.7/3.8 with no or VNC-password security is readable,
//! which is what the computer's Xvnc offers.

/// Clipboard and other variable-length messages longer than this end the
/// stream rather than being buffered.
const MAX_MESSAGE_BYTES: usize = 1 << 20;
const VERSION_BYTES: usize = 12;
const VNC_AUTH_RESPONSE_BYTES: usize = 16;

/// Why a viewer's bytes cannot be filtered.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum RfbViolation {
    /// The protocol version is not one this filter reads.
    #[error("unsupported RFB version")]
    Version,
    /// The security type would hide the messages that follow.
    #[error("unsupported RFB security type {0}")]
    Security(u8),
    /// A client message type this filter cannot measure.
    #[error("unknown RFB client message type {0}")]
    UnknownMessage(u8),
    /// A message too long to buffer.
    #[error("RFB client message too long")]
    TooLong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Version,
    Security,
    VncAuth,
    ClientInit,
    Messages,
}

/// Filters one viewer's byte stream toward the computer.
#[derive(Debug)]
pub struct ClientFilter {
    /// `None` passes everything through unread.
    view_only: Option<ViewOnly>,
}

#[derive(Debug)]
struct ViewOnly {
    phase: Phase,
    buffer: Vec<u8>,
}

impl ClientFilter {
    /// Everything reaches the computer.
    pub fn control() -> Self {
        Self { view_only: None }
    }

    /// Input never reaches the computer.
    pub fn view_only() -> Self {
        Self {
            view_only: Some(ViewOnly {
                phase: Phase::Version,
                buffer: Vec::new(),
            }),
        }
    }

    /// Take the viewer's next bytes; return the ones the computer may see.
    /// A message split across calls is held until it is complete.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<u8>, RfbViolation> {
        let Some(view_only) = &mut self.view_only else {
            return Ok(bytes.to_vec());
        };
        view_only.buffer.extend_from_slice(bytes);
        let mut allowed = Vec::new();
        let mut consumed = 0;
        loop {
            let Some(unit) = view_only.next_unit(consumed)? else {
                break;
            };
            let end = consumed + unit.length;
            if unit.forward {
                let message = view_only
                    .buffer
                    .get(consumed..end)
                    .ok_or(RfbViolation::TooLong)?;
                allowed.extend_from_slice(message);
            }
            consumed = end;
        }
        view_only.buffer.drain(..consumed);
        if view_only.buffer.len() > MAX_MESSAGE_BYTES {
            return Err(RfbViolation::TooLong);
        }
        Ok(allowed)
    }
}

/// One complete unit at the front of the buffer.
struct Unit {
    length: usize,
    forward: bool,
}

impl ViewOnly {
    /// Measure the next unit, advancing the phase; `None` until enough bytes
    /// have arrived to know.
    fn next_unit(&mut self, offset: usize) -> Result<Option<Unit>, RfbViolation> {
        let buffer = self.buffer.get(offset..).ok_or(RfbViolation::TooLong)?;
        let forward = |length| {
            Some(Unit {
                length,
                forward: true,
            })
        };
        let (unit, next) = match self.phase {
            Phase::Version => {
                if buffer.len() < VERSION_BYTES {
                    return Ok(None);
                }
                match &buffer[..VERSION_BYTES] {
                    b"RFB 003.007\n" | b"RFB 003.008\n" => {
                        (forward(VERSION_BYTES), Phase::Security)
                    }
                    _ => return Err(RfbViolation::Version),
                }
            }
            Phase::Security => match buffer.first() {
                None => return Ok(None),
                Some(1) => (forward(1), Phase::ClientInit),
                Some(2) => (forward(1), Phase::VncAuth),
                Some(&other) => return Err(RfbViolation::Security(other)),
            },
            Phase::VncAuth => {
                if buffer.len() < VNC_AUTH_RESPONSE_BYTES {
                    return Ok(None);
                }
                (forward(VNC_AUTH_RESPONSE_BYTES), Phase::ClientInit)
            }
            Phase::ClientInit => {
                if buffer.is_empty() {
                    return Ok(None);
                }
                (forward(1), Phase::Messages)
            }
            Phase::Messages => match message_length(buffer)? {
                None => return Ok(None),
                Some((length, input)) => (
                    Some(Unit {
                        length,
                        forward: !input,
                    }),
                    Phase::Messages,
                ),
            },
        };
        if let Some(unit) = &unit
            && buffer.len() < unit.length
        {
            return Ok(None);
        }
        self.phase = next;
        Ok(unit)
    }
}

/// A client message's full length and whether it is input, once its header
/// is in; `None` before that.
fn message_length(buffer: &[u8]) -> Result<Option<(usize, bool)>, RfbViolation> {
    let Some(&message_type) = buffer.first() else {
        return Ok(None);
    };
    let u16_at = |at: usize| {
        buffer
            .get(at..at + 2)
            .map(|bytes| usize::from(u16::from_be_bytes([bytes[0], bytes[1]])))
    };
    let u8_at = |at: usize| buffer.get(at).map(|&byte| usize::from(byte));
    let measured = match message_type {
        // SetPixelFormat
        0 => Some((20, false)),
        // SetEncodings: count at 2..4, four bytes each.
        2 => u16_at(2).map(|count| (4 + 4 * count, false)),
        // FramebufferUpdateRequest
        3 => Some((10, false)),
        // KeyEvent
        4 => Some((8, true)),
        // PointerEvent
        5 => Some((6, true)),
        // ClientCutText: signed length at 4..8; negative is the extended
        // clipboard, whose payload is the absolute value.
        6 => match buffer.get(4..8) {
            None => None,
            Some(bytes) => {
                let length = i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                let length =
                    usize::try_from(length.unsigned_abs()).map_err(|_| RfbViolation::TooLong)?;
                if length > MAX_MESSAGE_BYTES {
                    return Err(RfbViolation::TooLong);
                }
                Some((8 + length, true))
            }
        },
        // EnableContinuousUpdates
        150 => Some((10, false)),
        // ClientFence: payload length at 8.
        248 => u8_at(8).map(|length| (9 + length, false)),
        // xvp: shutdown, reboot, reset.
        250 => Some((4, true)),
        // SetDesktopSize: screen count at 6, sixteen bytes each.
        251 => u8_at(6).map(|screens| (8 + 16 * screens, true)),
        // QEMU: extended key event, or audio control.
        255 => match u8_at(1) {
            None => None,
            Some(0) => Some((12, true)),
            Some(1) => match u16_at(2) {
                None => None,
                Some(0 | 1) => Some((4, false)),
                Some(2) => Some((10, false)),
                Some(_) => return Err(RfbViolation::UnknownMessage(message_type)),
            },
            Some(_) => return Err(RfbViolation::UnknownMessage(message_type)),
        },
        other => return Err(RfbViolation::UnknownMessage(other)),
    };
    Ok(measured)
}
