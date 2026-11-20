//! Replace an imported ledger generation without cascading through its children.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::PgImportRepo;
use crate::domain::ports::Result;

impl PgImportRepo {
    #[tracing::instrument(skip(self, user), err)]
    pub(super) async fn defer_linked_object(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        reason: &str,
    ) -> Result<bool> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *transaction)
            .await?;
        let changed = sqlx::query_scalar!(
            r#"
            UPDATE import_entity
            SET metadata = jsonb_set(
                    jsonb_set(metadata #- '{plan,alreadyImported}', '{plan,decision}', '"hand"'::jsonb),
                    '{plan,reason}', to_jsonb($3::text)
                ), status = 'staged', team_id = NULL, waiting_on = NULL,
                last_error = $3, updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
              AND metadata->'plan' IS NOT NULL
            RETURNING id
            "#,
            user.as_ref(), import_id, reason,
        ).fetch_optional(&mut *transaction).await?;
        if changed.is_some() {
            super::release_waiters(&mut transaction, &[import_id]).await?;
        }
        transaction.commit().await?;
        Ok(changed.is_some())
    }

    #[tracing::instrument(skip(self, user), err)]
    pub(super) async fn clear_stale_team_link(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
    ) -> Result<bool> {
        let changed = sqlx::query!(
            r#"
            UPDATE import_entity
            SET metadata = metadata #- '{plan,alreadyImported}' #- '{plan,reason}' #- '{plan,sharedReason}', updated_at = NOW()
            WHERE id = $2 AND (SELECT import_entity.user_id OFFSET 0) = $1 AND status = 'importing'
              AND metadata->'plan' IS NOT NULL
            "#,
            user.as_ref(),
            import_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(changed.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user, still_deleted), err)]
    pub(super) async fn renew_deleted_target<F, Fut>(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        entity_id: &str,
        reason: Option<&str>,
        still_deleted: F,
    ) -> Result<bool>
    where
        F: FnOnce() -> Fut + Send,
        Fut: Future<Output = Result<bool>> + Send,
    {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *transaction)
            .await?;
        let row = sqlx::query_scalar!(
            r#"
            SELECT id FROM import_entity
            WHERE id = $2 AND status = 'imported' AND entity_id = $3 AND source = $4
              AND (user_id = $1 OR team_id = (SELECT team_id FROM team_user WHERE user_id = $1))
            FOR UPDATE
            "#,
            user.as_ref(),
            import_id,
            entity_id,
            self.workspace_source.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if row.is_none() {
            return Ok(false);
        }
        // A restore can finish while this transaction waits for the ledger.
        // The owning domain rechecks physical state after FOR UPDATE.
        if !still_deleted().await? {
            return Ok(false);
        }

        // The parent/waiter FKs do not cascade updates. Detach them while
        // replacing the primary key, then reattach children to the new
        // generation. Written markers belong solely to the old generation.
        let children = sqlx::query_scalar!(
            "UPDATE import_entity SET parent_id = NULL WHERE parent_id = $1 RETURNING id",
            import_id,
        )
        .fetch_all(&mut *transaction)
        .await?;
        sqlx::query!(
            "UPDATE import_entity SET waiting_on = NULL WHERE waiting_on = $1",
            import_id,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            "DELETE FROM import_entity_written WHERE import_id = $1",
            import_id
        )
        .execute(&mut *transaction)
        .await?;
        let generation = Uuid::now_v7();
        sqlx::query!(
            r#"
            UPDATE import_entity
            SET id = $2, status = 'staged', entity_id = NULL, entity_type = NULL,
                team_id = NULL, waiting_on = NULL, review_id = NULL, last_error = $3,
                metadata = CASE WHEN jsonb_typeof(metadata->'plan') = 'object'
                    THEN metadata #- '{plan,alreadyImported}' #- '{plan,reason}' #- '{plan,sharedReason}'
                    ELSE metadata END - 'personalFolderId' - 'separateFolder',
                updated_at = NOW()
            WHERE id = $1
            "#,
            import_id,
            generation,
            reason,
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            "UPDATE import_entity SET parent_id = $2 WHERE id = ANY($1::uuid[])",
            &children,
            generation,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(true)
    }
}
