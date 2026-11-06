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
}
struct PgItemLock {
    _admission: OwnedSemaphorePermit,
    _transaction: Transaction<'static, Postgres>,
}
impl ItemLock for PgItemLock {}

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
    async fn stage_totp(&self, team: TeamId, item: ItemId, key: TotpKeyId) -> Result<(), Error> {
        sqlx::query!("INSERT INTO password_totp_enrollments(team_id,item_id,key_id,state,cleanup_after) VALUES($1,$2,$3,'pending',now()+interval '180 seconds') ON CONFLICT(team_id,key_id) DO NOTHING",team.0,item.0,key.0).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(())
    }
    async fn activate_totp(&self, team: TeamId, item: ItemId, key: TotpKeyId) -> Result<(), Error> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        let item_row=sqlx::query!("SELECT id FROM password_item_entities WHERE team_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",team.0,item.0).fetch_optional(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        if item_row.is_none() {
            return Err(Error::NotFound);
        }

        let enrolled=sqlx::query!("UPDATE password_totp_enrollments SET state='active' WHERE team_id=$1 AND item_id=$2 AND key_id=$3 AND state='pending'",team.0,item.0,key.0).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        if enrolled.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        sqlx::query!("UPDATE password_totp_enrollments SET state='retired',cleanup_after=GREATEST(cleanup_after,now()+interval '180 seconds') WHERE team_id=$1 AND item_id=$2 AND key_id<>$3 AND state='active'",team.0,item.0,key.0).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        let item=sqlx::query!(r#"UPDATE password_item_entities SET totp_key_id=$3,metadata=jsonb_set(metadata,'{hasTotp}','true'::jsonb),revision=revision+1 WHERE team_id=$1 AND id=$2 AND NOT deleting AND deleted_at IS NULL"#,team.0,item.0,key.0).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        if item.rows_affected() != 1 {
            return Err(Error::NotFound);
        }
        transaction.commit().await.map_err(|_| Error::Unavailable)
    }
    async fn retire_totp(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        let item_row = sqlx::query!(
            "SELECT id FROM password_item_entities WHERE team_id=$1 AND id=$2 FOR UPDATE",
            team.0,
            item.0
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        if item_row.is_none() {
            return Err(Error::NotFound);
        }

        sqlx::query!("UPDATE password_totp_enrollments SET state='retired',cleanup_after=GREATEST(cleanup_after,now()+interval '180 seconds') WHERE team_id=$1 AND item_id=$2 AND state<>'retired'",team.0,item.0).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        sqlx::query!(r#"UPDATE password_item_entities SET totp_key_id=NULL,metadata=jsonb_set(metadata,'{hasTotp}','false'::jsonb),revision=revision+1 WHERE team_id=$1 AND id=$2"#,team.0,item.0).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        transaction.commit().await.map_err(|_| Error::Unavailable)
    }
    async fn totp_keys(&self, team: TeamId, item: ItemId) -> Result<Vec<TotpKeyId>, Error> {
        let keys = sqlx::query!(
            "SELECT key_id FROM password_totp_enrollments WHERE team_id=$1 AND item_id=$2",
            team.0,
            item.0
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(keys.into_iter().map(|key| TotpKeyId(key.key_id)).collect())
    }
    async fn totp_cleanup_due(&self) -> Result<Vec<TotpCleanup>, Error> {
        let rows=sqlx::query!("SELECT enrollment.team_id,enrollment.item_id,enrollment.key_id FROM password_totp_enrollments enrollment JOIN password_item_entities item ON item.team_id=enrollment.team_id AND item.id=enrollment.item_id WHERE (item.totp_key_id IS DISTINCT FROM enrollment.key_id OR item.deleting) AND (enrollment.cleanup_started_at IS NULL OR enrollment.cleanup_after<=now()) ORDER BY enrollment.cleanup_after LIMIT 100").fetch_all(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(rows
            .into_iter()
            .map(|row| TotpCleanup {
                team_id: TeamId(row.team_id),
                item_id: ItemId(row.item_id),
                key_id: TotpKeyId(row.key_id),
            })
            .collect())
    }
    async fn totp_cleanup_ready(&self, cleanup: TotpCleanup) -> Result<bool, Error> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
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
        transaction.commit().await.map_err(|_| Error::Unavailable)?;
        Ok(row.is_some_and(|row| row.ready))
    }
    async fn finish_totp_cleanup(&self, cleanup: TotpCleanup) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_totp_enrollments SET state='retired',cleanup_after=now()+interval '1 hour' WHERE team_id=$1 AND item_id=$2 AND key_id=$3",
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
            .map_err(|_| Error::Conflict)?;
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
            return Err(Error::Conflict);
        }
        Ok(Box::new(PgItemLock {
            _admission: admission,
            _transaction: transaction,
        }))
    }
    async fn stage(&self, operation: Uuid, record: &Record) -> Result<(), Error> {
        let value = serde_json::to_value(record).map_err(|_| Error::Invalid)?;
        let result=sqlx::query!("INSERT INTO password_write_intents(operation_id,team_id,item_id,record) VALUES($1,$2,$3,$4) ON CONFLICT(operation_id) DO NOTHING",operation,record.metadata.team_id.0,record.metadata.id.0,value).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        if result.rows_affected() == 0 {
            let previous = self
                .staged(record.metadata.team_id, record.metadata.id, operation)
                .await?;
            if previous.user_id != record.user_id
                || previous.metadata.version != record.metadata.version
            {
                return Err(Error::Conflict);
            }
        }
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
        Ok(teams.into_iter().map(|team| TeamId(team.id)).collect())
    }
    async fn list(&self, actor: &Actor, team: TeamId, search: &str) -> Result<Vec<Record>, Error> {
        let rows=sqlx::query!("SELECT metadata,user_id,grants,deleting,revision,totp_key_id FROM password_item_entities WHERE team_id=$1 AND deleted_at IS NULL AND NOT deleting AND (user_id=$3 OR EXISTS (SELECT 1 FROM jsonb_array_elements(grants) grant_entry WHERE (grant_entry->>'kind'='user' AND grant_entry->>'id'=$3) OR (grant_entry->>'kind'='team' AND grant_entry->>'id'=$1::text))) AND position(lower($2) in lower(metadata->>'name') || ' ' || lower(COALESCE(metadata->>'url',''))) > 0 ORDER BY id DESC LIMIT 500",team.0,search,actor.user_id.as_ref()).fetch_all(&self.pool).await.map_err(|_|Error::Unavailable)?;
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
        let metadata = serde_json::to_value(&record.metadata).map_err(|_| Error::Invalid)?;
        let grants = serde_json::to_value(&record.grants).map_err(|_| Error::Invalid)?;
        let totp_key_id = record.totp_key_id.map(|key| key.0);
        let changed=if let Some(expected_version)=expected_version {
            sqlx::query!("UPDATE password_item_entities SET metadata=$3,version=$4,grants=$5,deleting=$7,revision=revision+1,totp_key_id=$8,cleanup_due_at=CASE WHEN $7 THEN COALESCE(cleanup_due_at,now()+interval '180 seconds') ELSE cleanup_due_at END WHERE team_id=$1 AND id=$2 AND version=$6 AND revision=$9 AND deleted_at IS NULL",record.metadata.team_id.0,record.metadata.id.0,metadata,record.metadata.version,grants,expected_version,record.deleting,totp_key_id,record.revision).execute(&self.pool).await
        }else{
            sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,grants,deleting,totp_key_id,cleanup_due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7 THEN now()+interval '180 seconds' ELSE NULL END) ON CONFLICT(team_id,id) DO NOTHING",record.metadata.team_id.0,record.metadata.id.0,record.user_id.as_ref(),metadata,record.metadata.version,grants,record.deleting,totp_key_id).execute(&self.pool).await
        }.map_err(|_|Error::Unavailable)?;
        if changed.rows_affected() != 1 {
            return Err(Error::Conflict);
        }
        Ok(())
    }
    async fn delete(&self, team: TeamId, item: ItemId) -> Result<(), Error> {
        sqlx::query!(
            "UPDATE password_item_entities SET deleted_at=COALESCE(deleted_at,now()) WHERE team_id=$1 AND id=$2",
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
        let rows = sqlx::query!(
            "SELECT id,name FROM password_folders WHERE team_id=$1 ORDER BY name LIMIT 500",
            team.0
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|_| Error::Unavailable)?;
        Ok(rows
            .into_iter()
            .map(|row| Folder {
                id: row.id,
                team_id: team,
                name: row.name,
            })
            .collect())
    }
    async fn save_folder(&self, folder: &Folder) -> Result<(), Error> {
        sqlx::query!("INSERT INTO password_folders(team_id,id,name) VALUES($1,$2,$3) ON CONFLICT(team_id,id) DO UPDATE SET name=EXCLUDED.name",folder.team_id.0,folder.id,folder.name).execute(&self.pool).await.map_err(|_|Error::Unavailable)?;
        Ok(())
    }
    async fn delete_folder(&self, team: TeamId, id: Uuid) -> Result<(), Error> {
        let mut transaction = self.pool.begin().await.map_err(|_| Error::Unavailable)?;
        let id_text = id.to_string();
        sqlx::query!(r#"UPDATE password_item_entities SET metadata=jsonb_set(metadata,'{folderId}','null'::jsonb),revision=revision+1 WHERE team_id=$1 AND metadata->>'folderId'=$2"#,team.0,id_text).execute(&mut *transaction).await.map_err(|_|Error::Unavailable)?;
        sqlx::query!(
            "DELETE FROM password_folders WHERE team_id=$1 AND id=$2",
            team.0,
            id
        )
        .execute(&mut *transaction)
        .await
        .map_err(|_| Error::Unavailable)?;
        transaction.commit().await.map_err(|_| Error::Unavailable)?;
        Ok(())
    }
}

#[cfg(test)]
mod test;
