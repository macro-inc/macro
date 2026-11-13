//! Object keys in the two buckets. Date partitions are UTC and come from the
//! time the server received the batch.

use chrono::{DateTime, Utc};

/// `raw/v=1/dt=<date>/hour=<hh>/<batch>.jsonl.zst` (events bucket): every
/// kept non-transcript event with its server envelope.
pub fn raw_key(received_at: DateTime<Utc>, batch_id: &str) -> String {
    format!(
        "raw/v=1/dt={}/hour={}/{batch_id}.jsonl.zst",
        received_at.format("%Y-%m-%d"),
        received_at.format("%H")
    )
}

/// `notes/<first two hex>/<sha>` (events bucket): the latest note text.
pub fn note_key(sha: &str) -> String {
    let shard = sha.get(..2).unwrap_or(sha);
    format!("notes/{shard}/{sha}")
}

/// `commits/repo=<owner>__<name>/dt=<date>/<batch>.jsonl.zst` (events
/// bucket): one flattened row per commit.
pub fn commits_key(repository: &str, received_at: DateTime<Utc>, batch_id: &str) -> String {
    let owner_and_name: Vec<&str> = repository.split('/').skip(1).collect();
    format!(
        "commits/repo={}/dt={}/{batch_id}.jsonl.zst",
        owner_and_name.join("__"),
        received_at.format("%Y-%m-%d")
    )
}

/// `usage/dt=<date>/<batch>.jsonl.zst` (events bucket): one row per token
/// bucket revision.
pub fn usage_key(received_at: DateTime<Utc>, batch_id: &str) -> String {
    format!(
        "usage/dt={}/{batch_id}.jsonl.zst",
        received_at.format("%Y-%m-%d")
    )
}

/// `sessions/tool=<tool>/sid=<session id>/` (sessions bucket): one session's
/// transcript chunks. Deleting a session is deleting this prefix.
pub fn transcript_prefix(tool: &str, session_id: &str) -> String {
    format!("sessions/tool={tool}/sid={session_id}/")
}

/// `<prefix><first event ts>-<chunk id>.jsonl.zst`: one batch's lines of one
/// session, oldest first. The chunk id is a hash of the lines, so a retried
/// batch overwrites its own chunk.
pub fn transcript_key(tool: &str, session_id: &str, first_ts: u64, chunk_id: &str) -> String {
    format!(
        "{}{first_ts:010}-{chunk_id}.jsonl.zst",
        transcript_prefix(tool, session_id)
    )
}

/// `session-index/dt=<date>/<batch>.jsonl` (sessions bucket): one line per
/// chunk written by the batch.
pub fn session_index_key(received_at: DateTime<Utc>, batch_id: &str) -> String {
    format!(
        "session-index/dt={}/{batch_id}.jsonl",
        received_at.format("%Y-%m-%d")
    )
}
