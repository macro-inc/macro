//! Which due folder stream a sync loop's turn claims.

use std::sync::atomic::{AtomicU32, Ordering};

/// Which due folder stream a claim takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamClaim {
    /// The longest-due live pass beside an import round.
    LivePass,
    /// The longest-due mail folder: a finished folder's poll or an import
    /// round, whichever came due first.
    LongestDue,
    /// The longest-due import round, or the longest-due mail folder when no
    /// round is due.
    ImportFirst,
}

impl StreamClaim {
    /// The enumerate span's `outlook.claim`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LivePass => "live_pass",
            Self::LongestDue => "longest_due",
            Self::ImportFirst => "import_first",
        }
    }
}

/// One mail folder claim in this many takes import rounds first. Polls of
/// every finished folder of every mailbox share the sync loops and run
/// minutes late, so a round that waited behind them read a page only every
/// few minutes while its import sat empty. Taking a round first on every
/// other claim keeps an import reading as soon as its mailbox has room,
/// whatever the line's length; on the other claims rounds compete with polls
/// by how long they have been due, so their head start is capped: without
/// the cap, a mailbox with hundreds of rounds due again every 10 s would
/// take every claim. It matches the loop's one folder claim per message read.
const IMPORT_FIRST_EVERY: u32 = 2;

/// One sync loop's mail folder claims, for which rule each one follows.
#[derive(Debug, Default)]
pub struct ClaimTurns(AtomicU32);

impl ClaimTurns {
    /// The rule of the loop's next mail folder claim; the first takes import
    /// rounds first.
    pub fn next(&self) -> StreamClaim {
        let turn = self.0.fetch_add(1, Ordering::Relaxed);
        if turn.is_multiple_of(IMPORT_FIRST_EVERY) {
            StreamClaim::ImportFirst
        } else {
            StreamClaim::LongestDue
        }
    }
}
