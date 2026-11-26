//! New mail during a folder's import round.
//!
//! A folder's first delta round is a snapshot: mail that arrives after it
//! started comes back only once the round reaches its checkpoint, and a large
//! folder's round lasts as long as its import. While the switch is on, the
//! round reads newest first, and a live pass beside it lists only mail
//! received since shortly before the round started, through the live reader,
//! so new mail is stored as it arrives. The pass is deleted when the round
//! ends.

use chrono::{DateTime, Utc};
use email_api_client::domain::models::RoundStart;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::StreamLease;

/// How long before its round's start a live pass lists mail from. Graph dates
/// mail when Exchange received it, by Exchange's clock, and mail can reach its
/// folder after that date, so mail dated just before the round can be missing
/// from both. What the round lists as well merges into its reconciliation row.
const LOOK_BACK_SECONDS: i64 = 300;

/// Turns the live pass and newest-first import rounds on. The host sets it
/// from its feature flag; off, folder streams read as they always have.
#[derive(Debug, Clone, Default)]
pub struct LiveImportPass(Arc<AtomicBool>);

impl LiveImportPass {
    pub fn enabled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Returns whether it was on before.
    pub fn set(&self, enabled: bool) -> bool {
        self.0.swap(enabled, Ordering::Relaxed)
    }
}

/// The folder stream kinds of `email_sync_streams.kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// A folder's delta stream: its import round, then its live rounds.
    MailFolder,
    /// The live pass beside a folder's import round.
    LivePass,
}

impl StreamKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MailFolder => "mail_folder",
            Self::LivePass => "mail_folder_live",
        }
    }
}

/// Which of a folder's streams a lease holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FolderPass {
    /// The folder's delta stream.
    Folder,
    /// The live pass. Its first request lists only mail received from a few
    /// minutes before `received_since`, when the import round it runs beside
    /// started.
    Live { received_since: DateTime<Utc> },
}

impl FolderPass {
    pub fn kind(self) -> StreamKind {
        match self {
            Self::Folder => StreamKind::MailFolder,
            Self::Live { .. } => StreamKind::LivePass,
        }
    }
}

/// What a stream's next round lists, read only for a round's first page.
pub(super) fn round_start(lease: &StreamLease, switch: &LiveImportPass) -> RoundStart {
    match lease.pass {
        FolderPass::Live { received_since } => {
            RoundStart::ReceivedSince(received_since - chrono::Duration::seconds(LOOK_BACK_SECONDS))
        }
        // A large folder's recent mail imports before its oldest.
        FolderPass::Folder if !lease.initial_complete && switch.enabled() => {
            RoundStart::NewestFirst
        }
        FolderPass::Folder => RoundStart::Unordered,
    }
}

/// Whether a committed page of this lease's round leaves the folder in its
/// import round, so new mail needs the live pass.
pub(super) fn opens(lease: &StreamLease, checkpoint: bool, switch: &LiveImportPass) -> bool {
    lease.pass == FolderPass::Folder && !lease.initial_complete && !checkpoint && switch.enabled()
}
