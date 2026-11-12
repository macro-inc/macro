//! Metadata-only PostgreSQL adapter. The secret payload type never crosses this boundary.
use crate::domain::{
    models::*,
    ports::{ItemLock, Repository},
};
use async_trait::async_trait;
use opentelemetry::trace::TraceContextExt;
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

/// Postgres metadata repository and distributed item-lock adapter.
pub struct PgRepository {
    /// Metadata database pool; private payloads never cross this adapter.
    pool: PgPool,
    lock_admission: Arc<Semaphore>,
}
impl PgRepository {
    /// Construct one shared adapter per pool, reserving half its connections for repository queries.
    /// Pools with fewer than two connections cannot host an independent lease transaction.
    pub fn new(pool: PgPool) -> Result<Self, Error> {
        let capacity = pool.options().get_max_connections() / 2;
        if capacity == 0 {
            return Err(Error::Invalid);
        }
        Ok(Self {
            pool,
            lock_admission: Arc::new(Semaphore::new(
                usize::try_from(capacity).map_err(|_| Error::Invalid)?,
            )),
        })
    }
    /// Whether this namespace has any retained metadata or closure fence.
    // Order the one-row audit lookup so absent teams cannot scan the growing activity table.
    pub async fn has_team_data(&self, team: TeamId) -> Result<bool, Error> {
        sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM password_item_entities WHERE team_id=$1) OR EXISTS(SELECT 1 FROM password_write_intents WHERE team_id=$1) OR EXISTS(SELECT 1 FROM password_folders WHERE team_id=$1) OR EXISTS(SELECT 1 FROM password_totp_enrollments WHERE team_id=$1) OR EXISTS(SELECT 1 FROM password_team_lifecycle WHERE team_id=$1) OR (SELECT id FROM password_import_activity WHERE team_id=$1 ORDER BY id LIMIT 1) IS NOT NULL AS "present!""#,team.0)
            .fetch_one(&self.pool).await.map_err(database_error)
    }

    async fn bounded_transaction(&self) -> Result<Transaction<'static, Postgres>, Error> {
        let mut transaction = self.pool.begin().await.map_err(database_error)?;
        sqlx::query!("SET LOCAL statement_timeout = '5s'")
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        sqlx::query!("SET LOCAL lock_timeout = '2s'")
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        Ok(transaction)
    }
}

fn database_error(error: sqlx::Error) -> Error {
    match error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
    {
        Some("55P03") => Error::Busy,
        Some("23505") => Error::Conflict,
        _ => Error::Unavailable,
    }
}

struct PgItemLock {
    _admission: OwnedSemaphorePermit,
    _transaction: Transaction<'static, Postgres>,
}
#[async_trait]
impl ItemLock for PgItemLock {
    async fn release(self: Box<Self>) -> Result<(), Error> {
        self._transaction.rollback().await.map_err(database_error)
    }
}

fn decode(
    metadata: serde_json::Value,
    user_id: String,
    grants: serde_json::Value,
    deleting: bool,
    revision: i64,
    totp_key_id: Option<Uuid>,
) -> Result<Record, Error> {
    Ok(Record {
        metadata: serde_json::from_value(metadata).map_err(|_| Error::Unavailable)?,
        user_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&user_id)
            .map(macro_user_id::cowlike::CowLike::into_owned)
            .map_err(|_| Error::Unavailable)?,
        grants: serde_json::from_value(grants).map_err(|_| Error::Unavailable)?,
        deleting,
        revision,
        totp_key_id: totp_key_id.map(TotpKeyId),
    })
}
#[async_trait]
impl Repository for PgRepository {
    async fn is_human(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<bool, Error> {
        sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM "User" WHERE id=$1 AND NOT "isAgent") AS "human!""#,
            user.as_ref()
        )
        .fetch_one(&self.pool)
        .await
        .map_err(database_error)
    }
    async fn is_team_admin(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'_>,
        team: TeamId,
    ) -> Result<bool, Error> {
        sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$2 AND team_role IN ('owner','admin')) AS "admin!""#,team.0,user.as_ref())
            .fetch_one(&self.pool).await.map_err(database_error)
    }
    async fn has_team_data(&self, team: TeamId) -> Result<bool, Error> {
        PgRepository::has_team_data(self, team).await
    }

    async fn close_team(&self, team: TeamId) -> Result<(), Error> {
        sqlx::query!("INSERT INTO password_team_lifecycle(team_id) VALUES($1) ON CONFLICT(team_id) DO NOTHING", team.0).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(())
    }
    async fn purge_team_metadata(&self, team: TeamId) -> Result<(), Error> {
        let mut transaction = self.bounded_transaction().await?;
        sqlx::query!(
            "DELETE FROM password_item_entities WHERE team_id=$1",
            team.0
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        sqlx::query!(
            "DELETE FROM password_write_intents WHERE team_id=$1",
            team.0
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        sqlx::query!("DELETE FROM password_folders WHERE team_id=$1", team.0)
            .execute(&mut *transaction)
            .await
            .map_err(database_error)?;
        sqlx::query!(
            "DELETE FROM password_import_activity WHERE team_id=$1",
            team.0
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }
    async fn item_cleanup_due(&self) -> Result<Vec<(TeamId, ItemId)>, Error> {
        self.pending_item_cleanup().await
    }

    async fn stage_totp(&self, team: TeamId, item: ItemId, key: TotpKeyId) -> Result<(), Error> {
        sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after) VALUES($1,$2,$3,'pending',now()+interval '180 seconds') ON CONFLICT(team_id,key_id) DO NOTHING",team.0,item.0,key.0).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(())
    }
    async fn activate_totp(
        &self,
        team: TeamId,
        item: ItemId,
        key: TotpKeyId,
        expected_revision: i64,
    ) -> Result<(), Error> {
        let mut transaction = self.bounded_transaction().await?;
        let item_row=sqlx::query!("SELECT revision,deleting FROM password_item_entities WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",team.0,item.0).fetch_optional(&mut *transaction).await.map_err(database_error)?.ok_or(Error::NotFound)?;
        if item_row.deleting {
            return Err(Error::NotFound);
        }
        if item_row.revision != expected_revision {
            return Err(Error::Conflict);
        }

        let enrolled=sqlx::query!("UPDATE password_totp_enrollments SET state='active' WHERE team_id=$1 AND item_id=$2 AND key_id=$3 AND state='pending'",team.0,item.0,key.0).execute(&mut *transaction).await.map_err(database_error)?;
        if enrolled.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        sqlx::query!("UPDATE password_totp_enrollments SET state='retired',cleanup_after=GREATEST(cleanup_after,now()+interval '180 seconds') WHERE team_id=$1 AND item_id=$2 AND key_id<>$3 AND state<>'retired' AND state='active'",team.0,item.0,key.0).execute(&mut *transaction).await.map_err(database_error)?;
        let item=sqlx::query!(r#"UPDATE password_item_entities SET totp_key_id=$3,metadata=jsonb_set(metadata,'{hasTotp}','true'::jsonb),revision=revision+1 WHERE team_id=$1 AND id=$2 AND NOT deleting AND deleted_at IS NULL"#,team.0,item.0,key.0).execute(&mut *transaction).await.map_err(database_error)?;
        if item.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(database_error)
    }
    async fn retire_totp(
        &self,
        team: TeamId,
        item: ItemId,
        expected_revision: Option<i64>,
    ) -> Result<(), Error> {
        let mut transaction = self.bounded_transaction().await?;
        let item_row = sqlx::query!(
            "SELECT revision,deleting FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR UPDATE",
            team.0,
            item.0
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(database_error)?.ok_or(Error::NotFound)?;
        if match expected_revision {
            Some(revision) => item_row.deleting || item_row.revision != revision,
            None => !item_row.deleting,
        } {
            return Err(Error::Conflict);
        }

        sqlx::query!("UPDATE password_totp_enrollments SET state='retired',cleanup_after=GREATEST(cleanup_after,now()+interval '180 seconds') WHERE team_id=$1 AND item_id=$2 AND state<>'retired'",team.0,item.0).execute(&mut *transaction).await.map_err(database_error)?;
        sqlx::query!(r#"UPDATE password_item_entities SET totp_key_id=NULL,metadata=jsonb_set(metadata,'{hasTotp}','false'::jsonb),revision=revision+1 WHERE team_id=$1 AND id=$2"#,team.0,item.0).execute(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)
    }
    async fn totp_keys(&self, team: TeamId, item: ItemId) -> Result<Vec<TotpKeyId>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let keys = sqlx::query!(
            "SELECT key_id FROM password_totp_enrollments WHERE team_id=$1 AND item_id=$2",
            team.0,
            item.0
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        Ok(keys.into_iter().map(|key| TotpKeyId(key.key_id)).collect())
    }
    async fn totp_cleanup_due(&self) -> Result<Vec<TotpCleanup>, Error> {
        self.discover_totp_cleanup().await
    }
    async fn totp_cleanup_ready(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        let mut transaction = self.bounded_transaction().await?;
        sqlx::query!(
            "SELECT id FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR UPDATE",
            cleanup.team_id.0,
            cleanup.item_id.0
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        // Establish quarantine only after the owning service scope released its vault lease.
        let row=sqlx::query!(r#"UPDATE password_totp_enrollments enrollment SET state='retired',cleanup_after=CASE WHEN enrollment.cleanup_started_at IS NULL THEN now()+interval '180 seconds' ELSE enrollment.cleanup_after END,cleanup_started_at=COALESCE(enrollment.cleanup_started_at,now()) FROM password_item_entities item WHERE item.team_id=enrollment.team_id AND item.id=enrollment.item_id AND enrollment.team_id=$1 AND enrollment.item_id=$2 AND enrollment.key_id=$3 AND (item.totp_key_id IS DISTINCT FROM enrollment.key_id OR item.deleting) RETURNING enrollment.cleanup_after<=now() AS "ready!""#,cleanup.team_id.0,cleanup.item_id.0,cleanup.key_id.0).fetch_optional(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        sqlx::query!(
            "DELETE FROM password_totp_cleanup_candidates WHERE team_id=$1 AND key_id=$2",
            cleanup.team_id.0,
            cleanup.key_id.0
        )
        .execute(&mut *transaction)
        .await
        .map_err(database_error)?;
        transaction.commit().await.map_err(|_| Error::Unavailable)?;
        Ok(row.is_some_and(|row| row.ready))
    }
    async fn finish_totp_cleanup(&self, cleanup: TotpCleanup) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_totp_enrollments SET state='retired',erased_at=now(),cleanup_after=now()+interval '1 hour' WHERE team_id=$1 AND item_id=$2 AND key_id=$3",
            cleanup.team_id.0,
            cleanup.item_id.0,
            cleanup.key_id.0
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(())
    }

    async fn lock(&self, team: TeamId, _item: ItemId) -> Result<Box<dyn ItemLock>, Error> {
        let admission = self
            .lock_admission
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Busy)?;
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        let key = format!("passwords/{}", team.0);
        let lock = sqlx::query!(
            "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
            key
        )
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        if lock.locked != Some(true) {
            return Err(Error::Busy);
        }
        Ok(Box::new(PgItemLock {
            _admission: admission,
            _transaction: transaction,
        }))
    }
    #[tracing::instrument(skip_all,err,name="passwords.intent.publish",fields(team_id=%record.metadata.team_id.0,item_id=%record.metadata.id.0,outcome=tracing::field::Empty))]
    async fn stage(
        &self,
        operation: Uuid,
        record: &Record,
        publisher: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<(), Error> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        // Match revocation's team -> member lock order. A publisher must commit
        // before the revocation scan, or observe revoked admission after it.
        let team = sqlx::query_scalar!(
            "SELECT id FROM team WHERE id=$1 FOR KEY SHARE",
            record.metadata.team_id.0
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        let member=sqlx::query_scalar!(r#"SELECT membership.user_id FROM team_user membership JOIN "User" profile ON profile.id=membership.user_id WHERE membership.team_id=$1 AND membership.user_id=$2 AND NOT EXISTS(SELECT 1 FROM password_team_lifecycle closed WHERE closed.team_id=membership.team_id) AND NOT profile."isAgent" FOR KEY SHARE OF membership"#,record.metadata.team_id.0,publisher.as_ref()).fetch_optional(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        if team.is_none() || member.is_none() {
            tracing::Span::current().record("outcome", "admission_revoked");
            return Err(Error::NotFound);
        }
        let value = serde_json::to_value(record).map_err(|_| Error::Invalid)?;
        let result=sqlx::query!("INSERT INTO password_write_intents(operation_id,team_id,item_id,record) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id) DO NOTHING",operation,record.metadata.team_id.0,record.metadata.id.0,value).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        if result.rows_affected() == 0 {
            let row=sqlx::query!("SELECT record FROM password_write_intents WHERE operation_id=$1 AND team_id=$2 AND item_id=$3",operation,record.metadata.team_id.0,record.metadata.id.0).fetch_optional(&mut *transaction).await.map_err(|_|Error::Unavailable)?.ok_or(Error::Conflict)?;
            let previous: Record =
                serde_json::from_value(row.record).map_err(|_| Error::Unavailable)?;
            if previous.user_id != record.user_id
                || previous.metadata.version != record.metadata.version
            {
                return Err(Error::Conflict);
            }
        }
        transaction.commit().await.map_err(|_| Error::Unavailable)?;
        tracing::Span::current().record("outcome", "published");
        Ok(())
    }
    async fn staged(&self, team: TeamId, item: ItemId, operation: Uuid) -> Result<Record, Error> {
        let row=sqlx::query!("SELECT record FROM password_write_intents WHERE operation_id=$1 AND team_id=$2 AND item_id=$3",operation,team.0,item.0).fetch_optional(&self.pool).await.map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
        serde_json::from_value(row.record).map_err(|_| Error::Unavailable)
    }
    async fn finish(&self, operation: Uuid) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_write_intents SET completed_at=COALESCE(completed_at,now()) WHERE operation_id=$1",
            operation
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(())
    }
    async fn teams(&self, actor: &Actor) -> Result<Vec<TeamId>, Error> {
        let teams = macro_db_client::team::get::get_user_teams(&self.pool, actor.user_id.as_ref())
            .await
            .map_err(|_| Error::Unavailable)?;
        let ids: Vec<_> = teams.iter().map(|team| team.id).collect();
        let closed = sqlx::query!(
            "SELECT team_id FROM password_team_lifecycle WHERE team_id=ANY($1)",
            &ids
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        let closed: std::collections::HashSet<_> =
            closed.into_iter().map(|row| row.team_id).collect();
        Ok(teams
            .into_iter()
            .filter(|team| !closed.contains(&team.id))
            .map(|team| TeamId(team.id))
            .collect())
    }
    async fn list(&self, actor: &Actor, team: TeamId, search: &str) -> Result<Vec<Record>, Error> {
        let mut transaction = self.bounded_transaction().await?;
        let user_grant = serde_json::json!([{"kind":"user","id":actor.user_id.as_ref()}]);
        let team_grant = serde_json::json!([{"kind":"team","id":team.0.to_string()}]);
        let pattern = format!(
            "%{}%",
            search
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let rows=sqlx::query!(r#"SELECT metadata,user_id,grants,deleting,revision,totp_key_id FROM password_item_entities WHERE team_id=$1 AND deleted_at IS NULL AND NOT deleting AND EXISTS(SELECT 1 FROM team_user membership JOIN "User" profile ON profile.id=membership.user_id WHERE membership.team_id=$1 AND membership.user_id=$3 AND NOT profile."isAgent") AND (user_id=$3 OR grants @> $4 OR grants @> $5 OR EXISTS(SELECT 1 FROM team_user WHERE team_id=$1 AND user_id=$3 AND team_role IN ('owner','admin'))) AND (lower(metadata->>'name') || ' ' || lower(COALESCE(metadata->>'url',''))) LIKE lower($2) ESCAPE '\' ORDER BY id DESC LIMIT 500"#,team.0,pattern,actor.user_id.as_ref(),user_grant,team_grant).fetch_all(&mut *transaction).await.map_err(database_error)?;
        transaction.commit().await.map_err(database_error)?;
        rows.into_iter()
            .map(|row| {
                decode(
                    row.metadata,
                    row.user_id,
                    row.grants,
                    row.deleting,
                    row.revision,
                    row.totp_key_id,
                )
            })
            .collect()
    }
    async fn get(&self, team: TeamId, item: ItemId) -> Result<Record, Error> {
        let row=sqlx::query!(r#"SELECT metadata,user_id,grants,(deleting OR deleted_at IS NOT NULL) AS "deleting!",revision,totp_key_id FROM password_item_entities WHERE team_id=$1 AND id=$2"#,team.0,item.0).fetch_optional(&self.pool).await.map_err(|_|Error::Unavailable)?.ok_or(Error::NotFound)?;
        decode(
            row.metadata,
            row.user_id,
            row.grants,
            row.deleting,
            row.revision,
            row.totp_key_id,
        )
    }
    async fn save(&self, record: &Record, expected_version: Option<i32>) -> Result<(), Error> {
        let mut transaction = self.bounded_transaction().await?;
        if !record.deleting
            && let Some(folder) = record.metadata.folder_id
        {
            let live = sqlx::query_scalar!(
                "SELECT id FROM password_folders WHERE team_id=$1 AND id=$2 FOR KEY SHARE",
                record.metadata.team_id.0,
                folder
            )
            .fetch_optional(&mut *transaction)
            .await
            .map_err(database_error)?;
            if live.is_none() {
                return Err(Error::FolderMissing);
            }
        }
        let metadata = serde_json::to_value(&record.metadata).map_err(|_| Error::Invalid)?;
        let grants = serde_json::to_value(&record.grants).map_err(|_| Error::Invalid)?;
        let totp_key_id = record.totp_key_id.map(|key| key.0);
        let changed=if let Some(expected_version)=expected_version {
            sqlx::query!("UPDATE password_item_entities SET metadata=$3,version=$4,grants=$5,deleting=$7,revision=revision+1,totp_key_id=$8,cleanup_due_at=CASE WHEN $7 THEN COALESCE(cleanup_due_at,now()+interval '180 seconds') ELSE cleanup_due_at END WHERE team_id=$1 AND id=$2 AND version=$6 AND revision=$9 AND deleted_at IS NULL",record.metadata.team_id.0,record.metadata.id.0,metadata,record.metadata.version,grants,expected_version,record.deleting,totp_key_id,record.revision).execute(&mut *transaction).await
        }else{
            sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,grants,deleting,totp_key_id,cleanup_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7 THEN now()+interval '180 seconds' ELSE NULL END) ON CONFLICT(team_id,id) DO NOTHING",record.metadata.team_id.0,record.metadata.id.0,record.user_id.as_ref(),metadata,record.metadata.version,grants,record.deleting,totp_key_id).execute(&mut *transaction).await
        }.map_err(|_|Error::Unavailable)?;
        if changed.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        transaction.commit().await.map_err(database_error)
    }
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_item_entities SET deleted_at=COALESCE(deleted_at,now()),cleanup_due_at=now()+interval '1 hour' WHERE team_id=$1 AND id=$2",
            team.0,
            item.0
        )
        .execute(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(())
    }
    #[tracing::instrument(skip_all,err,name="passwords.audit",fields(team_id=%team.0,item_id=%item.0,event_id=%id))]
    async fn audit(
        &self,
        team: TeamId,
        item: ItemId,
        actor: &Actor,
        action: Action,
        id: Uuid,
    ) -> Result<(), Error> {
        let trace_id = tracing::Span::current()
            .context()
            .span()
            .span_context()
            .trace_id()
            .to_string();
        let action = serde_json::to_value(action).map_err(|_| Error::Invalid)?;
        let action = action.as_str().ok_or(Error::Invalid)?;
        sqlx::query!("INSERT INTO password_activity(team_id,item_id,id,user_id,action,trace_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(team_id,item_id,id) DO NOTHING",team.0,item.0,id,actor.user_id.as_ref(),action,trace_id).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(())
    }
    async fn activity(&self, team: TeamId, item: ItemId) -> Result<Vec<Activity>, Error> {
        let rows=sqlx::query!("SELECT id,user_id,action,occurred_at FROM password_activity WHERE team_id=$1 AND item_id=$2 ORDER BY id DESC LIMIT 200",team.0,item.0).fetch_all(&self.pool).await.map_err(|_|Error::Unavailable)?;
        rows.into_iter()
            .map(|row| {
                Ok(Activity {
                    id: row.id,
                    item_id: item,
                    user_id: row.user_id,
                    action: serde_json::from_value(serde_json::Value::String(row.action))
                        .map_err(|_| Error::Unavailable)?,
                    occurred_at: row.occurred_at,
                })
            })
            .collect()
    }
    async fn folders(&self, team: TeamId) -> Result<Vec<Folder>, Error> {
        self.list_folders(team).await
    }
    async fn ensure_folder(
        &self,
        team: TeamId,
        id: Uuid,
        name: &str,
        parent_id: Option<Uuid>,
    ) -> Result<Folder, Error> {
        self.ensure_stored_folder(team, id, name, parent_id).await
    }
    async fn audit_import(
        &self,
        team: TeamId,
        import_id: Uuid,
        actor: &Actor,
        format: ImportFormat,
        counts: ImportCounts,
    ) -> Result<(), Error> {
        self.record_import(team, import_id, actor, format, counts)
            .await
    }
    async fn save_folder(&self, folder: &Folder) -> Result<(), Error> {
        self.create_folder(folder).await
    }
    async fn rename_folder(&self, team: TeamId, id: Uuid, name: &str) -> Result<Folder, Error> {
        self.rename_stored_folder(team, id, name).await
    }
    async fn move_folder(
        &self,
        team: TeamId,
        id: Uuid,
        parent: Option<Uuid>,
    ) -> Result<Folder, Error> {
        self.move_stored_folder(team, id, parent).await
    }
    async fn delete_folder(&self, team: TeamId, id: Uuid) -> Result<(), Error> {
        self.delete_folder_tree(team, id).await
    }
}

#[cfg(test)]
mod test;

mod cleanup;
mod folders;

mod import;
