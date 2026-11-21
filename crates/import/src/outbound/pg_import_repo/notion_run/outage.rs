//! Owned, current-review compare-and-swap for bounded outage control state.

use super::*;
use crate::domain::models::NOTION_OUTAGE_PREFIX;

impl PgImportRepo {
    #[tracing::instrument(skip_all, fields(import_id = %import_id, review_id = %review_id, facts = facts.len()), err)]
    pub(super) async fn replace_outage_snapshot(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        review_id: Uuid,
        expected: Option<&str>,
        facts: &[WrittenObject],
    ) -> Result<()> {
        let invalid = || {
            ImportError::NotReady("The database retry state changed; reload this import review.")
        };
        let snapshots: Vec<_> = facts
            .iter()
            .filter(|fact| fact.object.starts_with(NOTION_OUTAGE_PREFIX))
            .collect();
        if !(1..=2).contains(&facts.len())
            || snapshots.len() != 1
            || facts.iter().any(|fact| {
                fact.import_id != import_id
                    || fact.kind != WrittenKind::DatabaseReservationFailure
                    || fact.object.len() > 1024
                    || if fact.object.starts_with(NOTION_OUTAGE_PREFIX) {
                        fact.macro_id != review_id
                    } else {
                        fact.macro_id != import_id
                            || !fact.object.starts_with("{\"state\":\"degraded\",")
                    }
            })
        {
            return Err(invalid());
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await?;
        // Keep every non-key scope check behind the exact parent PK lookup.
        let owned = sqlx::query_scalar!(
            r#"SELECT entity.id
               FROM import_entity AS entity
               WHERE entity.id = $2
                 AND (SELECT entity.user_id = $1 AND entity.review_id = $3
                      AND entity.source = 'notion' AND entity.kind = 'data_source'
                      AND entity.status = 'importing' OFFSET 0)
               FOR UPDATE OF entity"#,
            user.as_ref(),
            import_id,
            review_id,
        )
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(invalid)?;
        let current = sqlx::query_scalar!(
            r#"SELECT object FROM import_entity_written
               WHERE import_id = $1 AND kind = 'database_reservation_failure' AND starts_with(object, $2)"#,
            owned, NOTION_OUTAGE_PREFIX,
        ).fetch_all(&mut *tx).await?;
        if current.len() == 1 && current[0] == snapshots[0].object {
            tx.commit().await?;
            return Ok(());
        }
        let matches = match expected {
            Some(expected) => current.len() == 1 && current[0] == expected,
            None => current.is_empty(),
        };
        if !matches {
            return Err(invalid());
        }
        sqlx::query!(
            r#"DELETE FROM import_entity_written
               WHERE import_id = $1 AND kind = 'database_reservation_failure' AND starts_with(object, $2)"#,
            owned, NOTION_OUTAGE_PREFIX,
        ).execute(&mut *tx).await?;
        let objects: Vec<_> = facts.iter().map(|fact| fact.object.clone()).collect();
        let ids: Vec<_> = facts.iter().map(|fact| fact.macro_id).collect();
        sqlx::query!(
            r#"INSERT INTO import_entity_written (import_id, kind, object, macro_id)
               SELECT $1, 'database_reservation_failure', fact.object, fact.macro_id
               FROM UNNEST($2::text[], $3::uuid[]) AS fact(object, macro_id)
               ON CONFLICT (import_id, kind, object) DO NOTHING"#,
            owned,
            &objects,
            &ids,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
