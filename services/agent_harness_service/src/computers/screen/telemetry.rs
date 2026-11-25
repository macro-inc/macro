//! Content-free progress on the existing viewer relay span.

use std::sync::Mutex;

use computer_screen::domain::models::EndReason;
use tracing::Span;

use super::media::{MediaEnd, MediaError};
use super::tunnel::{TunnelError, TunnelExited};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum RelayStage {
    TicketRedeemed,
    SocketUpgraded,
    Wake,
    FleetExec,
    ShellMarker,
    FirstGuestByte,
    RfbGate,
    FirstSocketWrite,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum CloseReason {
    Canceled,
    ComputerOff,
    AccessRevoked,
    Shutdown,
    Idle,
    SocketError,
    ExecFailed,
    HelperMissing,
    ConnectRefused,
    Timeout,
    ExitNonzero,
    ExitUnknown,
    Eof,
    ParserError,
    SessionError,
}

impl From<EndReason> for CloseReason {
    fn from(reason: EndReason) -> Self {
        match reason {
            EndReason::Stopped => Self::Canceled,
            EndReason::ComputerOff => Self::ComputerOff,
            EndReason::AccessRevoked => Self::AccessRevoked,
            EndReason::Shutdown => Self::Shutdown,
            EndReason::Idle => Self::Idle,
            EndReason::Error | EndReason::Lost => Self::SessionError,
        }
    }
}

impl From<&Result<MediaEnd, MediaError>> for CloseReason {
    fn from(result: &Result<MediaEnd, MediaError>) -> Self {
        match result {
            Ok(MediaEnd::ViewerClosed) => Self::Canceled,
            Ok(MediaEnd::GuestClosed) => Self::Eof,
            Err(MediaError::Gate(_)) => Self::ParserError,
            Err(MediaError::Tunnel(error)) => match error {
                TunnelError::ComputerOff
                | TunnelError::Unreachable(_)
                | TunnelError::MissingMarker => Self::ExecFailed,
                TunnelError::Timeout => Self::Timeout,
            },
            Err(MediaError::Io(error)) => match TunnelExited::from_io(error) {
                Some(TunnelExited::ConnectRefused) => Self::ConnectRefused,
                Some(TunnelExited::Code(127)) => Self::HelperMissing,
                Some(TunnelExited::Code(_)) => Self::ExitNonzero,
                Some(TunnelExited::Failed) | None => Self::ExitUnknown,
            },
        }
    }
}

/// The media reader and socket writer report milestones on the session span.
pub(super) struct RelayProgress {
    stage: Mutex<Option<RelayStage>>,
    span: Span,
}

impl RelayProgress {
    pub(super) fn new(span: Span) -> Self {
        Self {
            stage: Mutex::new(Some(RelayStage::TicketRedeemed)),
            span,
        }
    }

    pub(super) fn advance(&self, stage: RelayStage) {
        let mut current = self
            .stage
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if current.is_some_and(|previous| stage > previous) {
            *current = Some(stage);
            tracing::info!(parent: &self.span, stage = stage.as_ref(), "computer.screen.relay_milestone");
        }
    }

    fn finish(&self, reason: CloseReason) {
        let stage = self
            .stage
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let Some(stage) = stage else { return };
        self.span.record("screen.relay.stage", stage.as_ref());
        self.span
            .record("screen.relay.close_reason", reason.as_ref());
    }
}

/// Owns the sole relay outcome, including when the session future is dropped.
pub(super) struct RelayOutcome<'a> {
    pub(super) progress: &'a RelayProgress,
    pub(super) reason: CloseReason,
}

impl Drop for RelayOutcome<'_> {
    fn drop(&mut self) {
        self.progress.finish(self.reason);
    }
}
