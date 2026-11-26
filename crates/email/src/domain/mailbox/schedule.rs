//! When folder streams are polled.

/// How long a stream waits after a checkpoint before it is polled again.
#[derive(Debug, Clone, Copy)]
pub struct PollIntervals {
    /// Its mailbox has a working subscription: one of the mailbox's current
    /// generation that Graph registered, not expired, whose last renewal did
    /// not fail. Graph then notifies every message change, and the webhook
    /// makes the mailbox's folders due at once, so the poll is only a safety
    /// net for a notification Graph dropped.
    pub subscribed: u32,
    /// Its mailbox has none, so polling is how its changes arrive.
    pub unsubscribed: u32,
}

/// Every folder of every mailbox shares the sync loops, so polling every 2
/// minutes the folders of mailboxes Graph already notifies put the polls, and
/// the notified folders waiting behind them, far past their schedule.
pub(crate) const POLL_INTERVALS: PollIntervals = PollIntervals {
    subscribed: 10 * 60,
    unsubscribed: 2 * 60,
};
