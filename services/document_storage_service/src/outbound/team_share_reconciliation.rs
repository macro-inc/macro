//! PostgreSQL evidence and guarded reconciliation. No remote clients or events.

use crate::service::team_share_reconciliation::{
    Action, DirectGrant, ReconciliationRepository, Snapshot, classify,
};
use cowlike::CowLike;
use model_entity::{Entity, EntityType};
use models_permissions::share_permission::access_level::AccessLevel;
use rootcause::prelude::*;
use share_permission_db_utils::team_share::{self, TeamShareError};
use sqlx::{PgPool, Postgres, Transaction};

#[cfg(test)]
#[path = "team_share_reconciliation/test.rs"]
mod test;

pub struct PgReconciliationRepository {
    db: PgPool,
}

impl PgReconciliationRepository {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

async fn inspect_in_transaction(
    tx: &mut Transaction<'_, Postgres>,
    entity: &Entity<'_>,
) -> Result<Snapshot, rootcause::Report> {
    team_share::acquire_guard(tx).await?;
    let facts = match team_share::load_facts(tx, entity).await {
        Ok(facts) => Some(facts),
        Err(error)
            if matches!(
                error.current_context(),
                TeamShareError::NotFound
                    | TeamShareError::InvalidState
                    | TeamShareError::InvalidEntity
            ) =>
        {
            None
        }
        Err(error) => return Err(error.into()),
    };
    // Compare text IDs so even malformed/orphan historical grants are reportable.
    let grants = sqlx::query!(
        r#"SELECT source_id, access_level AS "level: AccessLevel" FROM entity_access
        WHERE entity_id::text = $1 AND entity_type = $2 AND source_type = 'team'
          AND granted_from_project_id IS NULL ORDER BY source_id"#,
        entity.entity_id.as_ref(),
        entity.entity_type.as_ref(),
    )
    .fetch_all(tx.as_mut())
    .await?;
    let calls = sqlx::query!(
        r#"SELECT created_by, share_permission_id, share_with_team FROM calls
        WHERE $2 = 'call' AND id::text = $1
        UNION ALL
        SELECT created_by, share_permission_id, share_with_team FROM call_records
        WHERE $2 = 'call' AND id::text = $1"#,
        entity.entity_id.as_ref(),
        entity.entity_type.as_ref(),
    )
    .fetch_all(tx.as_mut())
    .await?;
    let mut unambiguous_owner_team = false;
    if let Some(facts) = &facts {
        let membership = sqlx::query!(
            r#"SELECT count(*) AS "count!", count(t.id) AS "extant!"
            FROM team_user tu LEFT JOIN team t ON t.id = tu.team_id WHERE tu.user_id = $1"#,
            facts.owner.as_ref(),
        )
        .fetch_one(tx.as_mut())
        .await?;
        let deleted = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                SELECT 1 FROM "Document" WHERE $2 = 'document' AND id = $1 AND "deletedAt" IS NOT NULL
                UNION ALL SELECT 1 FROM "Project" WHERE $2 = 'project' AND id = $1 AND "deletedAt" IS NOT NULL
                UNION ALL SELECT 1 FROM "Chat" WHERE $2 = 'chat' AND id = $1 AND "deletedAt" IS NOT NULL
            ) AS "deleted!""#,
            entity.entity_id.as_ref(), entity.entity_type.as_ref(),
        ).fetch_one(tx.as_mut()).await?;
        let consistent_calls = entity.entity_type != EntityType::Call
            || (!calls.is_empty()
                && calls.iter().all(|call| {
                    call.created_by.as_deref() == Some(facts.owner.as_ref())
                        && call.share_permission_id == calls[0].share_permission_id
                }));
        unambiguous_owner_team =
            membership.count == 1 && membership.extant == 1 && !deleted && consistent_calls;
    }
    let mut call_flags: Vec<bool> = calls
        .into_iter()
        .filter_map(|call| call.share_with_team)
        .collect();
    call_flags.sort();
    Ok(Snapshot {
        entity: entity.clone().into_owned(),
        facts,
        direct_grants: grants
            .into_iter()
            .map(|grant| DirectGrant {
                team_id: grant.source_id,
                level: grant.level,
            })
            .collect(),
        call_flags,
        unambiguous_owner_team,
    })
}

impl ReconciliationRepository for PgReconciliationRepository {
    async fn scan(
        &self,
        after: &str,
        limit: i64,
    ) -> Result<Vec<Entity<'static>>, rootcause::Report> {
        let rows = sqlx::query!(
            r#"WITH roots AS (
                SELECT 'document' AS kind, id FROM "Document"
                UNION SELECT 'project', id FROM "Project"
                UNION SELECT 'chat', id FROM "Chat"
                UNION SELECT 'email_thread', id::text FROM email_threads
                UNION SELECT 'call', id::text FROM calls
                UNION SELECT 'call', id::text FROM call_records
                UNION SELECT entity_type, entity_id::text FROM entity_access
                    WHERE source_type = 'team' AND granted_from_project_id IS NULL
                      AND entity_type IN ('document', 'project', 'chat', 'email_thread', 'call')
            ) SELECT kind AS "kind!", id AS "id!" FROM roots
            WHERE (kind || '/' || id) COLLATE "C" > $1 COLLATE "C"
            ORDER BY (kind || '/' || id) COLLATE "C" LIMIT $2"#,
            after,
            limit,
        )
        .fetch_all(&self.db)
        .await?;
        rows.into_iter()
            .map(|row| {
                let kind = match row.kind.as_str() {
                    "document" => EntityType::Document,
                    "project" => EntityType::Project,
                    "chat" => EntityType::Chat,
                    "email_thread" => EntityType::EmailThread,
                    "call" => EntityType::Call,
                    _ => return Err(report!("unsupported reconciliation entity type")),
                };
                Ok(kind.with_entity_string(row.id))
            })
            .collect()
    }

    async fn inspect(&self, entity: &Entity<'_>) -> Result<Snapshot, rootcause::Report> {
        let mut tx = self.db.begin().await?;
        let snapshot = inspect_in_transaction(&mut tx, entity).await?;
        // Explicit rollback also ensures dry-run inspection cannot persist lazy rows.
        tx.rollback().await?;
        Ok(snapshot)
    }

    async fn apply(&self, expected: &Snapshot, action: Action) -> Result<bool, rootcause::Report> {
        let mut tx = self.db.begin().await?;
        let fresh = inspect_in_transaction(&mut tx, &expected.entity).await?;
        if fresh != *expected {
            tx.rollback().await?;
            return Ok(false);
        }
        // Revalidate the maintenance intent, including revision zero and all evidence.
        // A document Adopt intent carries the service's operator-review decision.
        if classify(&fresh, true).action != Some(action) {
            return Err(report!("ineligible reconciliation action"));
        }
        let facts = fresh
            .facts
            .as_ref()
            .ok_or_else(|| report!("missing reconciliation facts"))?;
        let grant = action.grant();
        let uuid = uuid::Uuid::parse_str(&fresh.entity.entity_id)?;
        match action {
            Action::Adopt(_) => team_share::adopt(&mut tx, facts, grant).await?,
            Action::RepairLegacyCall(_) => {
                // Approved historical automatic-call maintenance, NOT initialize():
                // create the missing View grant then adopt it in this same transaction.
                entity_access_db_utils::team_share::upsert_direct(
                    tx.as_mut(),
                    &uuid,
                    fresh.entity.entity_type,
                    grant.team_id,
                    grant.level.into(),
                )
                .await?;
                team_share::adopt(&mut tx, facts, grant).await?;
            }
            Action::RepairCanonical(_) => {
                // Restore only the grant from unchanged canonical consent; do not
                // synthesize an owner command or advance its user-operation revision.
                entity_access_db_utils::team_share::upsert_direct(
                    tx.as_mut(),
                    &uuid,
                    fresh.entity.entity_type,
                    grant.team_id,
                    grant.level.into(),
                )
                .await?;
                if fresh.entity.entity_type == EntityType::Project {
                    entity_access_db_utils::project_inheritance::synchronize_project_team_share(
                        &mut tx,
                        &uuid,
                        grant.team_id,
                        Some(grant.level.into()),
                    )
                    .await?;
                }
            }
        }
        let verified = inspect_in_transaction(&mut tx, &fresh.entity).await?;
        // Verify both directions before commit, not merely rows_affected.
        if verified.facts.as_ref().and_then(|facts| facts.current) != Some(grant)
            || !verified.direct_grants.iter().any(|direct| {
                direct.team_id == grant.team_id.to_string()
                    && direct.level == AccessLevel::from(grant.level)
            })
        {
            return Err(report!(
                "reconciliation verification failed; transaction rolled back"
            ));
        }
        tx.commit().await?;
        Ok(true)
    }
}
