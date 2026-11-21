//! Folder SELECT failure tracking and bounded probes of a stale selected mailbox.
//! Derived from EmailEngine v2.89.0 mailbox.js and imap/stale-view.js.
use serde::{Deserialize, Serialize};

/// STATUS values are always scoped to the same wire mailbox.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderStatus {
    /// Folder incarnation. UIDs in a different epoch are incomparable.
    pub uid_validity: Option<u32>,
    /// Value of UIDNEXT reported by this session or the store.
    pub uid_next: Option<u32>,
    /// Current MESSAGES count.
    pub messages: u32,
}

/// Durable per-folder marker for a listed mailbox that rejects SELECT.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhantomFolder {
    failures: u8,
    failed_at_ms: i64,
    status: FolderStatus,
}
impl PhantomFolder {
    /// Record only a tagged SELECT refusal. Socket failures keep their account-level handling.
    pub fn failed(previous: Option<&Self>, status: FolderStatus, now_ms: i64) -> Self {
        Self {
            failures: previous.map_or(1, |p| p.failures.saturating_add(1)),
            failed_at_ms: now_ms,
            status,
        }
    }

    /// Reprobe immediately on a changed STATUS, or after six hours without a change.
    pub fn skip(&self, status: FolderStatus, now_ms: i64) -> bool {
        self.failures >= 3
            && self.status == status
            && (0..6 * 3_600_000).contains(&now_ms.saturating_sub(self.failed_at_ms))
    }
}

/// Greatest known valid UIDNEXT from persistent state and the selected session.
pub fn known_uid_next(stored: Option<u32>, observed: Option<u32>) -> Option<u32> {
    stored.into_iter().chain(observed).filter(|n| *n != 0).max()
}

/// Connection-local stale view evidence. Start fresh for each selected connection.
#[derive(Debug, Default, Clone)]
pub struct StaleView {
    checked_at_ms: i64,
    uid_next: Option<u32>,
    confirmations: u8,
}
impl StaleView {
    /// Decide whether this quiet connection warrants STATUS from an independent socket.
    pub fn should_probe(
        &mut self,
        known_uid_next: Option<u32>,
        now_ms: i64,
        interval_ms: i64,
    ) -> bool {
        let uid = known_uid_next.filter(|n| *n != 0);
        if interval_ms <= 0 || uid.is_none() {
            *self = Self::default();
            return false;
        }
        if self.uid_next != uid || now_ms < self.checked_at_ms {
            self.reset(uid, now_ms);
            return false;
        }
        if now_ms.saturating_sub(self.checked_at_ms) < interval_ms {
            return false;
        }
        self.checked_at_ms = now_ms;
        true
    }

    /// Confirm two consecutive ahead observations for this UID epoch. A primary arrival resets the count.
    pub fn stale_after_probe(
        &mut self,
        known: FolderStatus,
        server: Option<FolderStatus>,
        now_ms: i64,
    ) -> bool {
        let uid = known.uid_next.filter(|n| *n != 0);
        if uid.is_none() || self.uid_next != uid {
            self.reset(uid, now_ms);
            return false;
        }
        self.checked_at_ms = now_ms;
        let ahead = server.is_some_and(|s| {
            s.uid_next > uid
                && s.uid_validity == known.uid_validity
                && known.uid_validity.is_some_and(|n| n != 0)
        });
        self.confirmations = if ahead {
            self.confirmations.saturating_add(1)
        } else {
            0
        };
        if self.confirmations < 2 {
            return false;
        }
        self.confirmations = 0;
        true
    }

    fn reset(&mut self, uid_next: Option<u32>, now_ms: i64) {
        self.uid_next = uid_next;
        self.checked_at_ms = now_ms;
        self.confirmations = 0;
    }
}

#[cfg(test)]
mod test;
