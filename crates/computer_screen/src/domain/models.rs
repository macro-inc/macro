//! What a screen session is made of: who may watch or drive which computer,
//! over which transport, and the driver lease.

use chrono::{DateTime, Utc};
use computer_id::ComputerId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How the screen reaches the browser.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum Transport {
    /// Raw RFB from the guest's Xvnc, drawn by noVNC.
    Vnc,
}

/// What on the agent's computer is shown.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum Surface {
    /// The agent's whole virtual desktop `:1`.
    Desktop,
}

/// What a ticket lets its holder do.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum Mode {
    /// Watch only; needs `View` on the computer.
    View,
    /// Watch, and take over when nobody else drives; needs `Manage`.
    Drive,
}

/// One authorized viewer of one computer, as a ticket records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenGrant {
    /// The computer's harness.
    pub harness_id: HarnessId,
    /// The computer.
    pub computer_id: ComputerId,
    /// The agent teammate the computer runs, if any; it is held while a
    /// person drives.
    pub agent_user_id: Option<MacroUserIdStr<'static>>,
    /// Who watches.
    pub user_id: MacroUserIdStr<'static>,
    /// How the screen reaches them.
    pub transport: Transport,
    /// What they see first.
    pub surface: Surface,
    /// What they may do.
    pub mode: Mode,
}

/// The secret a browser presents to open the screen socket. Shown once;
/// only its hash is stored.
#[derive(Clone, PartialEq, Eq)]
pub struct TicketSecret(String);

impl TicketSecret {
    /// Wrap a ticket a caller presented.
    pub fn new(secret: String) -> Self {
        Self(secret)
    }

    /// The secret, for the one response that hands it out.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for TicketSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("TicketSecret(<redacted>)")
    }
}

/// A freshly issued ticket.
#[derive(Debug, Clone)]
pub struct IssuedTicket {
    /// The secret for the socket's `ticket` query parameter.
    pub secret: TicketSecret,
    /// When it stops working.
    pub expires_at: DateTime<Utc>,
}

/// A ticket a browser used up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedeemedTicket {
    /// What it allows.
    pub grant: ScreenGrant,
    /// The W3C context of the request that issued it.
    pub traceparent: Option<String>,
}

/// One screen socket, and its audit row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionId(Uuid);

impl SessionId {
    /// A new, time-ordered id.
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }

    /// Wrap a stored id.
    pub const fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id's UUID.
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The person driving a computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Driver {
    /// Their Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// Their name, when their profile has one.
    pub name: Option<String>,
}

/// A computer's driver lease.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    /// The computer.
    pub computer_id: ComputerId,
    /// The socket that drives.
    pub session_id: SessionId,
    /// Who drives.
    pub driver: Driver,
    /// The agent held while it lasts, if the computer runs one.
    pub agent_user_id: Option<MacroUserIdStr<'static>>,
    /// When this driver took over.
    pub started_at: DateTime<Utc>,
    /// When it lapses without input.
    pub expires_at: DateTime<Utc>,
}

impl Lease {
    /// An opaque id for the drive this lease belongs to: a take-over starts
    /// the lease anew, a renewal or a move to another tab of the driver
    /// keeps its start.
    pub fn drive_id(&self) -> String {
        use sha2::Digest as _;
        let mut hash = sha2::Sha256::new();
        hash.update(self.computer_id.as_uuid().as_bytes());
        hash.update(self.started_at.timestamp_micros().to_be_bytes());
        hash.finalize()
            .iter()
            .take(12)
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// Whether it still holds at `now`.
    pub fn is_live(&self, now: DateTime<Utc>) -> bool {
        self.expires_at > now
    }
}

/// A notice not yet delivered: acknowledged by its id once the request that
/// carried it succeeded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingNotice {
    /// Its row.
    pub id: Uuid,
    /// The notice.
    pub notice: AgentNotice,
}

/// What the screen needs to know about a person.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Person {
    /// Their name, when their profile has one.
    pub name: Option<String>,
    /// Whether the account is an agent teammate's.
    pub is_agent: bool,
}

/// Whether a caller may use a harness's screen, as the harness decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// They may; the harness runs on this computer.
    Granted(ComputerId),
    /// They may not.
    Denied,
    /// There is no such harness.
    NotFound,
    /// The harness is not a Macro computer's.
    NotAComputer,
}

/// A request for a ticket, as the caller made it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TicketRequest {
    /// The harness whose computer to show.
    pub harness_id: HarnessId,
    /// Who asks.
    pub user_id: MacroUserIdStr<'static>,
    /// A person, or a program run with their credentials (an agent's or a
    /// routine's run).
    pub caller: Caller,
    /// How the screen reaches the browser.
    pub transport: Transport,
    /// What to show.
    pub surface: Surface,
    /// Watch or drive.
    pub mode: Mode,
}

/// What a take-over came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TakeOver {
    /// The caller drives now.
    Taken(Lease),
    /// Someone else drives.
    Busy(Driver),
}

/// Why a screen socket ended; the socket's `ended` message says it too.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum EndReason {
    /// The viewer stopped it.
    Stopped,
    /// The computer is asleep, off, moving or unreachable.
    ComputerOff,
    /// The viewer lost access to the computer.
    AccessRevoked,
    /// The harness is shutting down; a new ticket reconnects.
    Shutdown,
    /// Anything else.
    Error,
    /// The viewer's tab was hidden, or said nothing, for too long; shown
    /// again, it reconnects.
    Idle,
    /// Only in the audit: the process serving the socket went away without
    /// closing its row (a crash or a redeploy). Never sent to a viewer.
    Lost,
}

/// The two notices an agent gets about its screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NoticeName {
    /// A person took over the agent's computer; the agent is held.
    #[serde(rename = "computer.screen.takeOver")]
    TakeOver,
    /// The person handed the computer back; the agent resumes.
    #[serde(rename = "computer.screen.handBack")]
    HandBack,
}

/// A runtime notice for the agent, delivered with its next brain request
/// that succeeds. It names the driver by name only: their user id is an
/// email, which the prompt never carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentNotice {
    /// Which notice.
    pub name: NoticeName,
    /// The driver's name, when their profile has one.
    pub driver_name: Option<String>,
    /// When they took over.
    pub started_at: DateTime<Utc>,
    /// When they handed back; absent on a take-over.
    pub ended_at: Option<DateTime<Utc>>,
    /// What the driver wrote for the agent on hand-back.
    pub note: Option<String>,
}

/// Who asks for a screen ticket.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Caller {
    /// A person, in their browser.
    Person,
    /// A program run with the person's credentials (a script, code mode).
    Program,
}

/// How a lease was let go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Release {
    /// The driver handed back, optionally with a note, from any of their
    /// sockets (the lease may have moved to another tab of theirs).
    HandBack {
        /// The user who drives.
        user_id: MacroUserIdStr<'static>,
        /// The note for the agent.
        note: Option<String>,
    },
    /// Nobody touched it for the idle limit, or its socket closed and the
    /// grace ran out.
    Lapsed,
    /// The take-over by `session` couldn't pause the agent, so it never
    /// started: no hand-back is recorded and its take-over notice goes.
    Refused {
        /// The socket that took over.
        session_id: SessionId,
    },
}

/// How a drive ended, as its audit row says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "camelCase")]
pub enum DriveEnd {
    /// The driver handed back.
    HandBack,
    /// The lease lapsed.
    Lapsed,
    /// The agent couldn't be paused, so the take-over was refused.
    Refused,
}

impl From<&Release> for DriveEnd {
    fn from(release: &Release) -> Self {
        match release {
            Release::HandBack { .. } => Self::HandBack,
            Release::Lapsed => Self::Lapsed,
            Release::Refused { .. } => Self::Refused,
        }
    }
}

/// The agent on a computer couldn't be frozen for a take-over.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the agent on this computer couldn't be paused")]
pub struct AgentNotPaused;
