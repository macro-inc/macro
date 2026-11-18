//! Replace an imported ledger generation without cascading through its children.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::PgImportRepo;
use crate::domain::ports::Result;

impl PgImportRepo {
    #[tracing::instrument(skip(self, user), err)]
    pub(super) async fn clear_stale_team_link(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        shared: bool,
    ) -> Result<bool> {
        let changed = sqlx::query!(
            r#"
            UPDATE import_entity
            SET metadata = jsonb_set(
                    metadata #- '{plan,alreadyImported}' #- '{plan,reason}',
                    '{plan,shared}', to_jsonb($3::bool)
                ), updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
              AND metadata->'plan' IS NOT NULL
            "#,
            user.as_ref(),
            import_id,
            shared,
        )
        .execute(&self.pool)
        .await?;
        Ok(changed.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, user), err)]
    pub(super) async fn renew_deleted_target(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        entity_id: &str,
    ) -> Result<bool> {
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
                team_id = NULL, waiting_on = NULL, review_id = NULL, last_error = NULL,
                updated_at = NOW()
            WHERE id = $1
            "#,
            import_id,
            generation,
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
