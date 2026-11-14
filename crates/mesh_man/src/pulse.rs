//! Pulses travelling along nerves, and flashes at their ends.

/// What happened, which decides how a nerve fires.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PulseKind {
    /// A tool call started: a pulse runs from the brain outward.
    ToolStart,
    /// A tool call returned: a pulse runs back toward the brain.
    ToolResult,
    /// A tool call failed: a red pulse runs back, and the far end flashes red.
    Error,
    /// A turn ended: the far end of the nerve flashes.
    TurnEnd,
}

/// Pulse speed along a nerve, in figure units per second (the figure is 2.0
/// tall, so a hand is about 1.3 s from the brain).
pub(crate) const PULSE_SPEED: f32 = 1.1;

/// How long an end flash lasts, in seconds.
pub(crate) const FLASH_SECONDS: f32 = 0.8;

/// A pulse in flight.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Pulse {
    pub nerve: usize,
    pub kind: PulseKind,
    /// Distance along the nerve from the brain.
    pub position: f32,
}

impl Pulse {
    pub fn new(nerve: usize, kind: PulseKind, length: f32) -> Self {
        let position = if kind.is_inward() { length } else { 0.0 };
        Self {
            nerve,
            kind,
            position,
        }
    }

    /// Moves the pulse on by `seconds`; returns whether it is still on the
    /// nerve of length `length`.
    pub fn advance(&mut self, seconds: f32, length: f32) -> bool {
        let step = PULSE_SPEED * seconds;

        if self.kind.is_inward() {
            self.position -= step;
            self.position >= 0.0
        } else {
            self.position += step;
            self.position <= length
        }
    }
}

impl PulseKind {
    /// Whether a pulse of this kind travels toward the brain.
    pub(crate) fn is_inward(self) -> bool {
        matches!(self, Self::ToolResult | Self::Error)
    }

    /// Whether this kind flashes the nerve's far end.
    pub(crate) fn flashes(self) -> bool {
        matches!(self, Self::Error | Self::TurnEnd)
    }

    /// Whether this kind sends a pulse along the nerve.
    pub(crate) fn travels(self) -> bool {
        !matches!(self, Self::TurnEnd)
    }
}

/// A burst at a nerve's far end.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Flash {
    pub nerve: usize,
    pub kind: PulseKind,
    /// Seconds since it started.
    pub age: f32,
}

impl Flash {
    /// Ages the flash by `seconds`; returns whether it is still showing.
    pub fn advance(&mut self, seconds: f32) -> bool {
        self.age += seconds;
        self.age < FLASH_SECONDS
    }
}
