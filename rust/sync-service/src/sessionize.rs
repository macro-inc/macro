//! Group document edit changes into per-user editing "sessions".
//!
//! [`sessionize`] takes `(user_id, timestamp_ms)` edit events (in any order),
//! groups each user's edits whose gaps are within [`SESSION_GAP_MS`] into a single
//! session, and returns every session over the whole history, most-recent first.
//!
//! This always operates on the entire history (the caller walks the full oplog and
//! hands every change in). Volume / activity rendering is derived from these
//! sessions on the client, so nothing extra is computed here.
//!
//! This is the temporary pre-SQLite-table implementation: eventually sessions will
//! be materialized in DO SQLite rather than recomputed by walking history per call.

use std::collections::HashMap;

/// Largest gap (ms) between consecutive edits that still counts as one session.
pub const SESSION_GAP_MS: i64 = 5 * 60 * 1000;

/// A detected editing session for one user over a contiguous (within-gap) run of
/// edits. `start_ms`/`end_ms` are the oldest/newest edit timestamps (ms).
#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub user_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub count: u32,
}

/// Group `(user_id, timestamp_ms)` events into per-user sessions. Within a user,
/// consecutive edits more than `gap_ms` apart start a new session. Returns all
/// sessions sorted most-recent first (`end_ms` desc, deterministic tie-breaks).
pub fn sessionize(events: Vec<(String, i64)>, gap_ms: i64) -> Vec<Session> {
    let mut by_user: HashMap<String, Vec<i64>> = HashMap::new();
    for (user, ts) in events {
        by_user.entry(user).or_default().push(ts);
    }

    let mut sessions: Vec<Session> = Vec::new();
    for (user, mut times) in by_user {
        times.sort_unstable();
        let mut iter = times.into_iter();
        let Some(first) = iter.next() else {
            continue;
        };
        let mut start = first;
        let mut end = first;
        let mut count: u32 = 1;
        for t in iter {
            if t - end > gap_ms {
                sessions.push(Session {
                    user_id: user.clone(),
                    start_ms: start,
                    end_ms: end,
                    count,
                });
                start = t;
                count = 0;
            }
            end = t;
            count += 1;
        }
        sessions.push(Session {
            user_id: user.clone(),
            start_ms: start,
            end_ms: end,
            count,
        });
    }

    // Most recent first; deterministic tie-breaks.
    sessions.sort_by(|a, b| {
        b.end_ms
            .cmp(&a.end_ms)
            .then_with(|| b.start_ms.cmp(&a.start_ms))
            .then_with(|| a.user_id.cmp(&b.user_id))
    });
    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAP: i64 = 100;

    fn ev(user: &str, ts: i64) -> (String, i64) {
        (user.to_string(), ts)
    }

    #[test]
    fn test_empty() {
        assert!(sessionize(vec![], GAP).is_empty());
    }

    #[test]
    fn test_single_event() {
        let sessions = sessionize(vec![ev("a", 1000)], GAP);
        assert_eq!(
            sessions,
            vec![Session {
                user_id: "a".to_string(),
                start_ms: 1000,
                end_ms: 1000,
                count: 1,
            }]
        );
    }

    #[test]
    fn test_two_within_gap() {
        // gap 50 <= GAP -> one session (order of input shouldn't matter)
        let sessions = sessionize(vec![ev("a", 1000), ev("a", 1050)], GAP);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].start_ms, 1000);
        assert_eq!(sessions[0].end_ms, 1050);
        assert_eq!(sessions[0].count, 2);
    }

    #[test]
    fn test_two_beyond_gap() {
        // gap 200 > GAP -> two sessions, most recent first
        let sessions = sessionize(vec![ev("a", 1000), ev("a", 1200)], GAP);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].start_ms, 1200);
        assert_eq!(sessions[0].count, 1);
        assert_eq!(sessions[1].start_ms, 1000);
        assert_eq!(sessions[1].count, 1);
    }

    #[test]
    fn test_unsorted_input_grouped_correctly() {
        // Same session fed out of order still merges; count is right.
        let sessions = sessionize(vec![ev("a", 1050), ev("a", 1000), ev("a", 1025)], GAP);
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].start_ms, 1000);
        assert_eq!(sessions[0].end_ms, 1050);
        assert_eq!(sessions[0].count, 3);
    }

    #[test]
    fn test_multiple_users() {
        let sessions = sessionize(
            vec![
                ev("a", 9000),
                ev("b", 5000),
                ev("a", 1050),
                ev("b", 1010),
                ev("a", 1000),
            ],
            GAP,
        );
        // a: [9000]; b: [5000]; a: [1000,1050]; b: [1010]
        assert_eq!(sessions.len(), 4);
        // Most recent first.
        assert_eq!(sessions[0].end_ms, 9000);
        assert_eq!(sessions[0].user_id, "a");
        assert_eq!(sessions[1].end_ms, 5000);
        assert_eq!(sessions[1].user_id, "b");
        // a's older session spans both edits.
        let a_old = sessions
            .iter()
            .find(|s| s.user_id == "a" && s.start_ms == 1000)
            .unwrap();
        assert_eq!(a_old.end_ms, 1050);
        assert_eq!(a_old.count, 2);
    }

    #[test]
    fn test_recency_ordering() {
        let sessions = sessionize(vec![ev("a", 1000), ev("a", 1050), ev("a", 5000)], GAP);
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].end_ms, 5000);
        assert_eq!(sessions[1].end_ms, 1050);
        assert_eq!(sessions[1].start_ms, 1000);
    }
}
