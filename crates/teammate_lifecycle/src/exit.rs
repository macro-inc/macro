//! The agent's exit codes: the only interpretation of them
//! (docs/design/teammate-runtime.md, *The runtime contract*).

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// The runtime stopped.
pub const STOPPED: u8 = 0;

/// Start again after a land (the restart marker).
pub const RESTART: u8 = 75;

/// The last run was a 78 on last-good: the settings are wrong, not the code.
pub const BAD_CONFIGURATION: u8 = 77;

/// A setting or credential is missing or invalid.
pub const INVALID_SETTING: u8 = 78;

/// The code needs a newer runtime (a newer muppet, or packages the image
/// doesn't have) and nothing older would run.
pub const INCOMPATIBLE_RUNTIME: u8 = 79;

/// What an exit code means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    /// 0.
    Stopped,
    /// 75.
    Restart,
    /// 77: terminal until the service redelivers.
    BadConfiguration,
    /// 78: restarted with backoff, counted as a failed boot.
    InvalidSetting,
    /// 79: terminal until a newer image arrives.
    IncompatibleRuntime,
    /// Anything else, a signal's 128 + n included.
    Crash(u8),
}

impl Exit {
    /// The meaning of `code`.
    pub fn of(code: u8) -> Self {
        match code {
            STOPPED => Self::Stopped,
            RESTART => Self::Restart,
            BAD_CONFIGURATION => Self::BadConfiguration,
            INVALID_SETTING => Self::InvalidSetting,
            INCOMPATIBLE_RUNTIME => Self::IncompatibleRuntime,
            other => Self::Crash(other),
        }
    }

    /// Whether a boot that ended this way counts toward rolling the code
    /// back: a crash or a bad setting does; a stop, a restart after a land
    /// and the two terminal codes (not the code's failure, or nothing to
    /// roll back to) don't.
    pub fn counts_as_failed_boot(self) -> bool {
        match self {
            Self::InvalidSetting | Self::Crash(_) => true,
            Self::Stopped | Self::Restart | Self::BadConfiguration | Self::IncompatibleRuntime => {
                false
            }
        }
    }
}

/// The previous run's exit as its supervisor saw it, passed to the next
/// boot as `TEAMMATE_PREVIOUS_EXIT`: `unknown`, or the code in decimal.
/// Any exit of a stop the supervisor asked for is passed as 0, as systemd
/// counts a stop's `SIGTERM` as success.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PreviousExit {
    /// The supervisor didn't see it: nothing ran before, or the run ended
    /// while macrod was down. Never counted, so nothing is counted twice.
    Unknown,
    /// It exited with this code.
    Exited {
        /// The exit code.
        code: u8,
    },
}

/// The environment variable [`PreviousExit`] travels in.
pub const PREVIOUS_EXIT_VARIABLE: &str = "TEAMMATE_PREVIOUS_EXIT";

const UNKNOWN: &str = "unknown";

impl fmt::Display for PreviousExit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown => formatter.write_str(UNKNOWN),
            Self::Exited { code } => write!(formatter, "{code}"),
        }
    }
}

/// A `TEAMMATE_PREVIOUS_EXIT` that is neither `unknown` nor a code.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{PREVIOUS_EXIT_VARIABLE} must be `unknown` or an exit code from 0 to 255")]
pub struct InvalidPreviousExit;

impl FromStr for PreviousExit {
    type Err = InvalidPreviousExit;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value == UNKNOWN {
            return Ok(Self::Unknown);
        }
        let all_digits = !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
        if !all_digits {
            return Err(InvalidPreviousExit);
        }
        let code = value.parse::<u8>().map_err(|_| InvalidPreviousExit)?;
        Ok(Self::Exited { code })
    }
}
