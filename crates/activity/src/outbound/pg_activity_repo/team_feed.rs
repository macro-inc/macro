//! The team feed read: teammates' activity on entities shared with the viewer.
//!
//! Visibility is decided in SQL so every page holds visible rows only and
//! costs one round trip. Each teammate's scan of the subject index stops
//! after enough visible rows or a raw-row cap that keeps a page's total read
//! near [`TEAM_SCAN`]'s budget however large the team is. When some teammate's
//! scan hits its cap, its last raw row is a frontier below which that
//! teammate was not read: the page returns only rows at or above the newest
//! frontier, and that frontier becomes the cursor when the page comes up
//! short. A page may therefore hold fewer than `limit` rows, or none, while
//! `next` is set; no visible row is ever skipped.

use std::num::NonZeroU32;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use super::StoredRow;
use crate::domain::ports::ActivityFeedPage;

/// How many raw rows one team page reads.
#[derive(Debug, Clone, Copy)]
pub(super) struct TeamScan {
    /// Raw rows one page may read across all teammates' scans.
    pub(super) page_budget: i64,
    /// Fewest raw rows one teammate's scan reads, however large the team.
    pub(super) min_per_teammate: i64,
}

/// The scan every team page uses: enough rows that a page is rarely short
/// even when most of the team's activity is hidden, few enough that a page
/// stays a cheap read whatever the team size.
pub(super) const TEAM_SCAN: TeamScan = TeamScan {
    page_budget: 8_000,
    min_per_teammate: 8,
};

/// One row of the team feed query: a visible row, or the frontier.
struct TeamFeedRow {
    id: Uuid,
    actor_id: String,
    action: String,
    action_payload: Option<serde_json::Value>,
    subject_id: String,
    entity_type: String,
    entity_id: String,
    occurred_at: DateTime<Utc>,
    is_boundary: bool,
}

impl TeamFeedRow {
    fn position(&self) -> (DateTime<Utc>, Uuid) {
        (self.occurred_at, self.id)
    }

    fn into_stored(self) -> StoredRow {
        StoredRow {
            id: self.id,
            actor_id: self.actor_id,
            action: self.action,
            action_payload: self.action_payload,
            subject_id: self.subject_id,
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            occurred_at: self.occurred_at,
        }
    }
}

#[tracing::instrument(
    name = "activity.team_feed",
    skip_all,
    fields(limit = limit.get(), row_count, short_page),
    err
)]
pub(super) async fn teammate_feed(
    pool: &PgPool,
    viewer_id: &str,
    cursor: Option<(DateTime<Utc>, Uuid)>,
    limit: NonZeroU32,
    scan: TeamScan,
) -> Result<ActivityFeedPage, sqlx::Error> {
    // One extra visible row as the has-more probe.
    let fetch = i64::from(limit.get()) + 1;
    let limit = limit.get() as usize;
    let rows = sqlx::query_file_as!(
        TeamFeedRow,
        "src/outbound/pg_activity_repo/team_feed.sql",
        viewer_id,
        cursor.map(|(occurred_at, _)| occurred_at),
        cursor.map(|(_, id)| id),
        fetch,
        scan.min_per_teammate,
        scan.page_budget,
    )
    .fetch_all(pool)
    .await?;

    let (boundary, mut visible): (Vec<_>, Vec<_>) =
        rows.into_iter().partition(|row| row.is_boundary);
    visible.sort_unstable_by_key(|row| std::cmp::Reverse(row.position()));
    let has_more = visible.len() > limit;
    visible.truncate(limit);
    // A full page continues below its last row. A short one has every
    // visible row above the frontier, so it continues below the frontier.
    let next = if has_more {
        visible.last().map(TeamFeedRow::position)
    } else {
        boundary.first().map(TeamFeedRow::position)
    };

    let span = tracing::Span::current();
    span.record("row_count", visible.len());
    span.record("short_page", !has_more && next.is_some());
    Ok(ActivityFeedPage {
        records: visible
            .into_iter()
            .filter_map(|row| row.into_stored().decode())
            .collect(),
        next,
    })
}
