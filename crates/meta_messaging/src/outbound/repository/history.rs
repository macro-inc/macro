//! Durable explicit consent and fenced history checkpoints. No automatic backfill.
use super::*;

impl PgMessagingRepository {
    pub(super) async fn history_import_impl(
        &self,
        c: &Connection,
    ) -> PortResult<Option<HistoryImport>> {
        sqlx::query!(r#"SELECT jsonb_build_object('requested_at',requested_at,'status',status,'progress',progress,'error_code',error_code,'unavailable_media',unavailable_media) AS "data!"
            FROM meta_messaging_history_import WHERE connection_id=$1 AND connected_at=$2"#, c.id, c.connected_at)
            .fetch_optional(&self.pool).await.map_err(failure)?.map(|r|decode(r.data)).transpose()
    }
    pub(super) async fn request_history_import_impl(
        &self,
        c: &Connection,
        user: &str,
    ) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let active = sqlx::query_scalar!("SELECT id FROM meta_messaging_connection WHERE id=$1 AND team_id=$2 AND connected_at=$3 AND status='connected' FOR UPDATE",c.id,c.team_id,c.connected_at)
            .fetch_optional(&mut *tx).await.map_err(failure)?;
        if active.is_none() {
            return Err(MessagingError::Disconnected.into());
        }
        sqlx::query!(r#"INSERT INTO meta_messaging_history_import(connection_id,connected_at,user_id,status,step)
            VALUES($1,$2,$3,'pending',$4)
            ON CONFLICT(connection_id) DO UPDATE SET connected_at=EXCLUDED.connected_at,user_id=EXCLUDED.user_id,
            requested_at=CASE WHEN meta_messaging_history_import.connected_at<>EXCLUDED.connected_at THEN now() ELSE meta_messaging_history_import.requested_at END,
            status='pending',step=EXCLUDED.step,
            cursor=CASE WHEN meta_messaging_history_import.connected_at=EXCLUDED.connected_at THEN meta_messaging_history_import.cursor ELSE NULL END,
            contacts_request_id=NULL,history_request_id=NULL,progress=NULL,error_code=NULL,attempts=0,available_at=now(),lease_id=NULL,lease_until=NULL,updated_at=now()
            WHERE meta_messaging_history_import.connected_at<>EXCLUDED.connected_at OR
                ($4='instagram' AND meta_messaging_history_import.status='failed')"#,
            c.id,c.connected_at,user,if c.provider==Provider::Whatsapp {"contacts"}else{"instagram"})
            .execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
    pub(super) async fn claim_history_import_impl(&self) -> PortResult<Option<HistoryWork>> {
        // A vanished worker or missing final provider webhook cannot leave a spinner forever.
        sqlx::query!(r#"UPDATE meta_messaging_history_import SET status='failed',error_code='history_interrupted',lease_id=NULL,lease_until=NULL,updated_at=now()
            WHERE status IN ('pending','syncing') AND
            ((attempts>=10 AND (lease_until IS NULL OR lease_until<=now())) OR
             (step='waiting' AND updated_at<now()-interval '24 hours'))"#).execute(&self.pool).await.map_err(failure)?;
        let token = Uuid::now_v7();
        let row=sqlx::query!(r#"WITH candidate AS (
            SELECT h.connection_id FROM meta_messaging_history_import h
            JOIN meta_messaging_connection c ON c.id=h.connection_id AND c.connected_at=h.connected_at
            WHERE h.status IN ('pending','syncing') AND h.step<>'waiting' AND h.available_at<=now()
                AND h.attempts<10 AND (h.lease_until IS NULL OR h.lease_until<=now()) AND c.status='connected'
            ORDER BY h.available_at,h.connection_id FOR UPDATE OF h SKIP LOCKED LIMIT 1)
            UPDATE meta_messaging_history_import h SET status='syncing',lease_id=$1,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now()
            FROM candidate WHERE h.connection_id=candidate.connection_id
            RETURNING h.connection_id,h.connected_at,h.user_id,h.step,h.cursor,h.attempts"#,token)
            .fetch_optional(&self.pool).await.map_err(failure)?;
        row.map(|r| {
            Ok(HistoryWork {
                lease: Lease {
                    id: r.connection_id,
                    token,
                },
                connected_at: r.connected_at,
                user_id: r.user_id,
                step: decode(serde_json::Value::String(r.step))?,
                cursor: r.cursor,
                attempts: r.attempts as u16,
            })
        })
        .transpose()
    }
    pub(super) async fn heartbeat_history_import_impl(&self, lease: &Lease) -> PortResult<bool> {
        Ok(sqlx::query!(r#"UPDATE meta_messaging_history_import h SET lease_until=now()+interval '5 minutes'
            FROM meta_messaging_connection c WHERE h.connection_id=$1 AND h.lease_id=$2 AND h.lease_until>now()
                AND c.id=h.connection_id AND c.connected_at=h.connected_at AND c.status='connected'"#,lease.id,lease.token)
            .execute(&self.pool).await.map_err(failure)?.rows_affected()==1)
    }
    pub(super) async fn checkpoint_history_import_impl(
        &self,
        w: &HistoryWork,
        step: HistoryStep,
        cursor: Option<&str>,
        request: Option<&str>,
    ) -> PortResult<()> {
        let changed=sqlx::query!(r#"UPDATE meta_messaging_history_import SET step=$3,cursor=$4,
            contacts_request_id=CASE WHEN $3='messages' THEN $5 ELSE contacts_request_id END,
            history_request_id=CASE WHEN $3='waiting' THEN COALESCE($5,history_request_id) ELSE history_request_id END,
            updated_at=now() WHERE connection_id=$1 AND lease_id=$2 AND lease_until>now()
                AND EXISTS(SELECT 1 FROM meta_messaging_connection c WHERE c.id=$1 AND c.connected_at=meta_messaging_history_import.connected_at AND c.status='connected')"#,
            w.lease.id,w.lease.token,spelling(step),cursor,request).execute(&self.pool).await.map_err(failure)?;
        fenced(changed.rows_affected())
    }
    pub(super) async fn settle_history_import_impl(
        &self,
        w: &HistoryWork,
        status: HistoryStatus,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        let changed=sqlx::query!(r#"UPDATE meta_messaging_history_import SET
            status=CASE WHEN status IN ('complete','declined') OR error_code='history_permission_lost' THEN status ELSE $3 END,error_code=CASE WHEN error_code='history_permission_lost' THEN error_code ELSE $4 END,
            attempts=CASE WHEN $4::text IS NULL THEN 0 ELSE attempts END,
            available_at=now()+make_interval(secs=>COALESCE($5,0)),lease_id=NULL,lease_until=NULL,updated_at=now()
            WHERE connection_id=$1 AND lease_id=$2 AND lease_until>now()"#,
            w.lease.id,w.lease.token,spelling(status),error,retry.map(|s|s.min(3600) as i32)).execute(&self.pool).await.map_err(failure)?;
        fenced(changed.rows_affected())
    }
    pub(super) async fn history_consent_user_impl(
        &self,
        c: &Connection,
        received_at: DateTime<Utc>,
    ) -> PortResult<Option<String>> {
        sqlx::query_scalar!(
            "SELECT user_id FROM meta_messaging_history_import
            WHERE connection_id=$1 AND connected_at=$2 AND requested_at<=$3 AND step='waiting'
                AND status IN ('syncing','complete','failed') AND error_code IS DISTINCT FROM 'history_permission_lost'",
            c.id,
            c.connected_at,
            received_at
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)
    }
    pub(super) async fn revoke_history_consent_impl(&self, c: &Connection) -> PortResult<()> {
        sqlx::query!("UPDATE meta_messaging_history_import SET status='failed',error_code='history_permission_lost',updated_at=now() WHERE connection_id=$1 AND connected_at=$2",c.id,c.connected_at)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    pub(super) async fn history_import_progress_impl(
        &self,
        c: &Connection,
        progress: Option<u8>,
        declined: bool,
    ) -> PortResult<()> {
        sqlx::query!(r#"UPDATE meta_messaging_history_import SET progress=GREATEST(progress,$3),
            status=CASE WHEN $4 THEN 'declined' WHEN status='declined' THEN status WHEN $3=100 THEN 'complete' WHEN status='complete' THEN status ELSE 'syncing' END,
            error_code=CASE WHEN $4 THEN 'history_sharing_declined' ELSE NULL END,updated_at=now()
            WHERE connection_id=$1 AND connected_at=$2 AND step='waiting' AND error_code IS DISTINCT FROM 'history_permission_lost'"#,c.id,c.connected_at,progress.map(i16::from),declined)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    pub(super) async fn history_media_unavailable_impl(&self, c: &Connection) -> PortResult<()> {
        sqlx::query!("UPDATE meta_messaging_history_import SET unavailable_media=true WHERE connection_id=$1 AND connected_at=$2",c.id,c.connected_at)
            .execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
}
fn fenced(rows: u64) -> PortResult<()> {
    if rows != 1 {
        return Err(MessagingError::Conflict.into());
    }
    Ok(())
}
