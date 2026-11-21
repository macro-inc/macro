//! The activity check (`UserActivity`) and the seen times it reads
//! (`user_last_seen`, written through `SeenLog`).

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::PgActivityRepo;
use crate::domain::ports::{SeenLog, UserActivity};

/// Ids written per statement. Past a few thousand ids the planner can hash
/// every row of "User" for the existence check instead of probing its key.
pub(super) const SEEN_BATCH: usize = 500;

impl UserActivity for PgActivityRepo {
    type Err = sqlx::Error;

    // The seen time is one primary-key read and is asked first: once it
    // answers, the activity read is never run. The activity read takes the
    // person's newest entry in idx_activity_events_own, which holds only the
    // changes a user made without a code-mode run, and compares its time: one
    // entry however much else they or their agents did. Ordered and limited,
    // so no plan can gather the whole window first. It repeats the index's
    // predicate word for word (`LIKE 'macro|%'` is always true of a user id,
    // the actions are NON_TOUCH_ACTION_TAGS) so the planner can prove the
    // index covers it; `non_touch_actions_are_the_ones_the_index_leaves_out`
    // fails when the tags change without them.
    #[tracing::instrument(
        name = "activity.is_active",
        skip_all,
        fields(active = tracing::field::Empty),
        err
    )]
    async fn is_active(
        &self,
        user: &MacroUserIdStr<'_>,
        since: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let active = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM user_last_seen
                WHERE user_id = $1 AND seen_at >= $2
            ) OR COALESCE((
                SELECT occurred_at >= $2 FROM activity_events
                WHERE actor_id = $1
                  AND agent_correlation_id IS NULL
                  AND actor_id LIKE 'macro|%'
                  AND action NOT IN ('opened', 'appearance_changed')
                ORDER BY occurred_at DESC
                LIMIT 1
            ), false) AS "active!"
            "#,
            user.as_ref(),
            since,
        )
        .fetch_one(&self.pool)
        .await?;
        tracing::Span::current().record("active", active);
        Ok(active)
    }
}

impl SeenLog for PgActivityRepo {
    type Err = sqlx::Error;

    // Distinct and sorted, so a batch never updates a row twice and two
    // gateways writing overlapping batches lock rows in the same order.
    #[tracing::instrument(
        name = "activity.record_seen",
        skip_all,
        fields(users = users.len()),
        err
    )]
    async fn record_seen(
        &self,
        users: &[MacroUserIdStr<'static>],
        at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        for batch in users.chunks(SEEN_BATCH) {
            let ids: Vec<String> = batch.iter().map(|user| user.as_ref().to_owned()).collect();
            sqlx::query!(
                r#"
                INSERT INTO user_last_seen (user_id, seen_at)
                SELECT DISTINCT seen.id, $2::timestamptz
                FROM unnest($1::text[]) AS seen(id)
                WHERE EXISTS (SELECT 1 FROM "User" WHERE "User".id = seen.id)
                ORDER BY seen.id
                ON CONFLICT (user_id) DO UPDATE SET seen_at = EXCLUDED.seen_at
                WHERE user_last_seen.seen_at < EXCLUDED.seen_at
                "#,
                &ids,
                at,
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }
}
