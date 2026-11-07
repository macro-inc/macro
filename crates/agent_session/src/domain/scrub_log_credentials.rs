//! Keyset batches for cleaning existing stored protocol frames.

use std::num::NonZeroUsize;

use agent_fold::domain::log::redact_stored_frame;
use macro_uuid::Uuid;
use serde_json::Value;

use super::error::Result;

/// A stored frame eligible for cleanup.
pub struct StoredFrame {
    /// Log row identity.
    pub id: Uuid,
    /// Original JSON, retained for a conditional update.
    pub content: Value,
}

/// A changed frame and the original value used to guard its update.
pub struct FrameChange {
    /// Log row identity.
    pub id: Uuid,
    /// Content as read.
    pub original: Value,
    /// Redacted replacement.
    pub updated: Value,
}

/// Persistence needed for one bounded cleanup batch.
pub trait StoredFrameScrubRepo {
    /// Read eligible rows after the cursor in stable id order.
    fn frames_after(
        &self,
        after_id: Option<Uuid>,
        limit: NonZeroUsize,
    ) -> impl Future<Output = Result<Vec<StoredFrame>>> + Send;

    /// Update changed rows in one statement, only while their content matches.
    fn update_frames(&self, changes: Vec<FrameChange>) -> impl Future<Output = Result<u64>> + Send;
}

/// Counts and cursor for a single batch.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ScrubBatch {
    /// Rows read, including malformed rows.
    pub examined: usize,
    /// Changed rows (or proposed changes during a dry run).
    pub changed: u64,
    /// Malformed rows skipped.
    pub skipped: usize,
    /// Last row read, suitable for resuming.
    pub last_id: Option<Uuid>,
}

/// Scrub one batch. A malformed JSON shape is skipped without blocking later rows.
pub async fn scrub_log_credentials<R: StoredFrameScrubRepo>(
    repo: &R,
    after_id: Option<Uuid>,
    limit: NonZeroUsize,
    apply: bool,
) -> Result<ScrubBatch> {
    let rows = repo.frames_after(after_id, limit).await?;
    let mut result = ScrubBatch {
        examined: rows.len(),
        last_id: rows.last().map(|row| row.id),
        ..ScrubBatch::default()
    };
    let mut changes = Vec::new();

    for row in rows {
        if !row.content.is_object() {
            result.skipped += 1;
            continue;
        }
        let mut updated = row.content.clone();
        redact_stored_frame(&mut updated);
        if updated != row.content {
            changes.push(FrameChange {
                id: row.id,
                original: row.content,
                updated,
            });
        }
    }

    result.changed = if apply {
        if changes.is_empty() {
            0
        } else {
            repo.update_frames(changes).await?
        }
    } else {
        changes.len() as u64
    };
    Ok(result)
}
