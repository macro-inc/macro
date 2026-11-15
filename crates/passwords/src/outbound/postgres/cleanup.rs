//! Bounded durable discovery; quarantine and provider erasure remain domain-owned.
use super::*;

impl PgRepository {
    pub(super) async fn pending_item_cleanup(&self) -> Result<Vec<(TeamId, ItemId)>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        // Filter current eligibility after the fenced primary-key lock: putting
        // it inside can make Postgres walk the partial queue index for each id.
        let rows = sqlx::query!(
            r#"WITH immediate AS MATERIALIZED (
            SELECT team_id,id,cleanup_due_at FROM password_item_entities
            WHERE deleting AND deleted_at IS NULL AND cleanup_due_at IS NULL
            ORDER BY cleanup_due_at NULLS FIRST,team_id,id LIMIT 100
        ), due AS MATERIALIZED (
            SELECT team_id,id,cleanup_due_at FROM password_item_entities
            WHERE deleting AND deleted_at IS NULL AND cleanup_due_at<=now()
            ORDER BY cleanup_due_at NULLS FIRST,team_id,id LIMIT 100
        ), batch AS MATERIALIZED (
            SELECT team_id,id FROM (SELECT * FROM immediate UNION ALL SELECT * FROM due) candidates
            ORDER BY cleanup_due_at NULLS FIRST,team_id,id LIMIT 100
        ), locked AS MATERIALIZED (
            SELECT item.team_id,item.id FROM batch CROSS JOIN LATERAL (
                SELECT current_item.team_id,current_item.id,current_item.deleting,
                    current_item.deleted_at,current_item.cleanup_due_at
                FROM password_item_entities current_item
                WHERE current_item.team_id=batch.team_id AND current_item.id=batch.id
                OFFSET 0 FOR UPDATE SKIP LOCKED
            ) item WHERE item.deleting AND item.deleted_at IS NULL
                AND (item.cleanup_due_at IS NULL OR item.cleanup_due_at<=now())
        ) UPDATE password_item_entities item SET cleanup_due_at=now()+interval '2 minutes'
        FROM locked WHERE item.team_id=locked.team_id AND item.id=locked.id
        RETURNING item.team_id AS "team_id!",item.id AS "id!""#
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(rows
            .into_iter()
            .map(|row| (TeamId(row.team_id), ItemId(row.id)))
            .collect())
    }

    async fn discover_active_orphans(&self) -> Result<(), Error> {
        let mut transaction = self.bounded_transaction().await?;
        // This short cursor lock never spans a vault lease or provider request.
        let cursor = sqlx::query!(
            "SELECT team_id,key_id FROM password_totp_cleanup_cursor WHERE singleton FOR UPDATE"
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(database_error)?;
        sqlx::query!(r#"WITH scan AS MATERIALIZED (
            SELECT team_id,item_id,key_id FROM password_totp_enrollments
            WHERE state='active' AND (team_id,key_id)>(COALESCE($1,'00000000-0000-0000-0000-000000000000'::uuid),COALESCE($2,'00000000-0000-0000-0000-000000000000'::uuid))
            ORDER BY team_id,key_id LIMIT 1000
        ), queued AS (
            INSERT INTO password_totp_cleanup_candidates(team_id,key_id)
            SELECT scan.team_id,scan.key_id FROM scan CROSS JOIN LATERAL (
                SELECT totp_key_id,deleting FROM password_item_entities WHERE team_id=scan.team_id AND id=scan.item_id OFFSET 0
            ) item WHERE item.totp_key_id IS DISTINCT FROM scan.key_id OR item.deleting
            ON CONFLICT(team_id,key_id) DO NOTHING RETURNING team_id
        ) UPDATE password_totp_cleanup_cursor SET
            team_id=(SELECT team_id FROM scan ORDER BY team_id DESC,key_id DESC LIMIT 1),
            key_id=(SELECT key_id FROM scan ORDER BY team_id DESC,key_id DESC LIMIT 1)
        WHERE singleton"#,cursor.team_id,cursor.key_id)
            .execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }

    pub(super) async fn discover_totp_cleanup(&self) -> Result<Vec<TotpCleanup>, Error> {
        self.discover_active_orphans().await?;
        let mut transaction = self.bounded_transaction().await?;
        let rows = sqlx::query!(r#"WITH pending AS MATERIALIZED (
            SELECT team_id,key_id,retry_after FROM password_totp_cleanup_candidates WHERE retry_after<=now() ORDER BY retry_after,team_id,key_id LIMIT 100
        ), unstarted AS MATERIALIZED (
            SELECT team_id,item_id,key_id,erased_at,cleanup_retry_after AS schedule FROM password_totp_enrollments
            WHERE state<>'active' AND cleanup_started_at IS NULL AND erased_at IS NULL AND cleanup_retry_after<=now()
            ORDER BY cleanup_retry_after,team_id,key_id LIMIT 100
        ), first_due AS MATERIALIZED (
            SELECT team_id,item_id,key_id,erased_at,GREATEST(cleanup_after,cleanup_retry_after) AS schedule FROM password_totp_enrollments
            WHERE state<>'active' AND cleanup_started_at IS NOT NULL AND erased_at IS NULL AND GREATEST(cleanup_after,cleanup_retry_after)<=now()
            ORDER BY GREATEST(cleanup_after,cleanup_retry_after),team_id,key_id LIMIT 100
        ), repeats AS MATERIALIZED (
            SELECT team_id,item_id,key_id,erased_at,GREATEST(cleanup_after,cleanup_retry_after) AS schedule FROM password_totp_enrollments
            WHERE state<>'active' AND erased_at IS NOT NULL AND GREATEST(cleanup_after,cleanup_retry_after)<=now()
            ORDER BY GREATEST(cleanup_after,cleanup_retry_after),team_id,key_id LIMIT 100
        ), candidate_rows AS MATERIALIZED (
            SELECT enrollment.team_id,enrollment.item_id,enrollment.key_id,enrollment.erased_at,pending.retry_after AS schedule
            FROM pending CROSS JOIN LATERAL (
                SELECT team_id,item_id,key_id,cleanup_after,erased_at FROM password_totp_enrollments
                WHERE team_id=pending.team_id AND key_id=pending.key_id OFFSET 0
            ) enrollment
            UNION ALL SELECT * FROM unstarted UNION ALL SELECT * FROM first_due UNION ALL SELECT * FROM repeats
        ), candidates AS MATERIALIZED (
            SELECT team_id,item_id,key_id,MIN(schedule) AS schedule,BOOL_AND(erased_at IS NOT NULL) AS repeated
            FROM candidate_rows GROUP BY team_id,item_id,key_id
        ), batch AS MATERIALIZED (
        SELECT candidates.team_id,candidates.item_id,candidates.key_id FROM candidates CROSS JOIN LATERAL (
            SELECT totp_key_id,deleting FROM password_item_entities
            WHERE team_id=candidates.team_id AND id=candidates.item_id OFFSET 0
        ) item WHERE item.totp_key_id IS DISTINCT FROM candidates.key_id OR item.deleting
            OR EXISTS(SELECT 1 FROM pending WHERE pending.team_id=candidates.team_id AND pending.key_id=candidates.key_id)
        ORDER BY candidates.repeated,candidates.schedule,candidates.team_id,candidates.key_id LIMIT 100
        ), locked AS MATERIALIZED (
            SELECT enrollment.team_id,enrollment.item_id,enrollment.key_id FROM batch JOIN password_totp_enrollments enrollment
            ON enrollment.team_id=batch.team_id AND enrollment.key_id=batch.key_id
            WHERE enrollment.cleanup_retry_after<=now() FOR UPDATE OF enrollment SKIP LOCKED
        ), claimed AS (
            UPDATE password_totp_enrollments enrollment SET cleanup_retry_after=now()+interval '2 minutes'
            FROM locked WHERE enrollment.team_id=locked.team_id AND enrollment.key_id=locked.key_id
            RETURNING enrollment.team_id,enrollment.item_id,enrollment.key_id
        ), deferred AS (
            UPDATE password_totp_cleanup_candidates pending SET retry_after=now()+interval '2 minutes'
            FROM claimed WHERE pending.team_id=claimed.team_id AND pending.key_id=claimed.key_id
            RETURNING pending.team_id
        ) SELECT team_id AS "team_id!",item_id AS "item_id!",key_id AS "key_id!" FROM claimed"#)
            .fetch_all(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(rows
            .into_iter()
            .map(|row| TotpCleanup {
                team_id: TeamId(row.team_id),
                item_id: ItemId(row.item_id),
                key_id: TotpKeyId(row.key_id),
            })
            .collect())
    }
}

#[cfg(test)]
mod test;
