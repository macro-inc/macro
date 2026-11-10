//! Metadata transitions participating in the membership owner's transaction.
use super::*;
use crate::domain::lifecycle::{Departure, depart_member};
use macro_user_id::user_id::MacroUserIdStr;

impl PgRepository {
    /// Fence metadata inside membership revocation's transaction. The caller must
    /// hold the same team advisory lease used by every protected vault operation.
    /// No provider request or credential value crosses this transaction bridge.
    #[tracing::instrument(skip_all, err, name="passwords.member.depart", fields(team_id=%team.0, outcome=tracing::field::Empty))]
    pub async fn prepare_member_removal(
        connection: &mut sqlx::PgConnection,
        team: TeamId,
        member: &str,
        owner: &str,
        departure: Departure,
    ) -> Result<(), Error> {
        let member = MacroUserIdStr::parse_from_str(member).map_err(|_| Error::Invalid)?;
        let owner = MacroUserIdStr::parse_from_str(owner).map_err(|_| Error::Invalid)?;
        let existing = sqlx::query_scalar!("SELECT id FROM password_member_removals WHERE team_id=$1 AND user_id=$2 AND state='prepared' FOR UPDATE",team.0,member.as_ref()).fetch_optional(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        if existing.is_some() {
            return Ok(());
        }
        let removal = Uuid::now_v7();
        sqlx::query!("INSERT INTO password_member_removals(id,team_id,user_id,state) VALUES($1,$2,$3,'prepared')",removal,team.0,member.as_ref()).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        // A lost create response may leave values with only a metadata intent.
        // Such an intent is not a committed sharing decision: fence it privately.
        let mut pending_cursor: Option<Uuid> = None;
        loop {
            let pending = sqlx::query!("SELECT operation_id,item_id,record FROM password_write_intents intent WHERE team_id=$1 AND record->>'user_id'=$2 AND ($3::uuid IS NULL OR operation_id>$3) AND NOT EXISTS(SELECT 1 FROM password_item_entities item WHERE item.team_id=intent.team_id AND item.id=intent.item_id) ORDER BY operation_id LIMIT 100",team.0,member.as_ref(),pending_cursor)
                .fetch_all(&mut *connection).await.map_err(|_|Error::Unavailable)?;
            if pending.is_empty() {
                break;
            }
            for row in pending {
                pending_cursor = Some(row.operation_id);
                let mut record: Record =
                    serde_json::from_value(row.record).map_err(|_| Error::Unavailable)?;
                if record.metadata.team_id != team
                    || record.metadata.id.0 != row.item_id
                    || record.user_id != member
                {
                    return Err(Error::Unavailable);
                }
                record.grants.clear();
                depart_member(&mut record.clone(), &member, &owner, departure)?;
                let version = record.metadata.version;
                let metadata = serde_json::to_value(record.metadata).map_err(|_| Error::Invalid)?;
                sqlx::query!("INSERT INTO password_item_entities(team_id,id,user_id,metadata,version,grants,deleting,member_removal_id,member_removal_created) VALUES($1,$2,$3,$4,$5,'[]',false,$6,true) ON CONFLICT(team_id,id) DO NOTHING",team.0,row.item_id,member.as_ref(),metadata,version,removal)
                    .execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
            }
        }
        let own_grant = serde_json::json!([{"kind":"user","id":member.as_ref()}]);
        let mut cursor: Option<Uuid> = None;
        loop {
            let rows = sqlx::query!(r#"SELECT id,metadata,user_id,grants,deleting,revision,totp_key_id,member_removal_id FROM password_item_entities WHERE team_id=$1 AND deleted_at IS NULL AND NOT deleting AND ($4::uuid IS NULL OR id>$4) AND (user_id=$2 OR grants @> $3) ORDER BY id LIMIT 100 FOR UPDATE"#, team.0,member.as_ref(),own_grant,cursor)
                .fetch_all(&mut *connection).await.map_err(|_| Error::Unavailable)?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                cursor = Some(row.id);
                if row.member_removal_id == Some(removal) {
                    continue;
                }
                if row.member_removal_id.is_some() {
                    return Err(Error::Busy);
                }
                let record = decode(
                    row.metadata,
                    row.user_id,
                    row.grants,
                    row.deleting,
                    false,
                    row.revision,
                    row.totp_key_id,
                )?;
                if let Err(error) = depart_member(&mut record.clone(), &member, &owner, departure) {
                    tracing::Span::current().record("outcome", "owned_items_blocked");
                    return Err(error);
                }
                sqlx::query!("UPDATE password_item_entities SET member_removal_id=$3,revision=revision+1 WHERE team_id=$1 AND id=$2",team.0,row.id,removal).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
            }
        }
        tracing::Span::current().record("outcome", "metadata_prepared");
        Ok(())
    }

    /// Commit the durable erasure queue only after the membership saga succeeds.
    /// Caller holds the team lease; queue and finished marker commit atomically.
    #[tracing::instrument(skip_all,err,name="passwords.member.finish",fields(team_id=%team.0,outcome=tracing::field::Empty))]
    pub async fn finish_member_removal(
        connection: &mut sqlx::PgConnection,
        team: TeamId,
        member: &str,
    ) -> Result<(), Error> {
        let removal = sqlx::query_scalar!("SELECT id FROM password_member_removals WHERE team_id=$1 AND user_id=$2 AND state='prepared' FOR UPDATE",team.0,member).fetch_optional(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        let Some(removal) = removal else {
            return Ok(());
        };
        let owner = sqlx::query_scalar!("SELECT owner_id FROM team WHERE id=$1 FOR UPDATE", team.0)
            .fetch_one(&mut *connection)
            .await
            .map_err(|_| Error::Unavailable)?;
        let owner = MacroUserIdStr::parse_from_str(&owner).map_err(|_| Error::Invalid)?;
        let member = MacroUserIdStr::parse_from_str(member).map_err(|_| Error::Invalid)?;
        loop {
            let rows = sqlx::query!("SELECT id,metadata,user_id,grants,deleting,revision,totp_key_id FROM password_item_entities WHERE member_removal_id=$1 ORDER BY id LIMIT 100 FOR UPDATE",removal).fetch_all(&mut *connection).await.map_err(|_|Error::Unavailable)?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let mut record = decode(
                    row.metadata,
                    row.user_id,
                    row.grants,
                    row.deleting,
                    true,
                    row.revision,
                    row.totp_key_id,
                )?;
                depart_member(&mut record, &member, &owner, Departure::Administrative)?;
                let metadata =
                    serde_json::to_value(&record.metadata).map_err(|_| Error::Invalid)?;
                let grants = serde_json::to_value(&record.grants).map_err(|_| Error::Invalid)?;
                let key = record.totp_key_id.map(|key| key.0);
                sqlx::query!("UPDATE password_item_entities SET user_id=$3,metadata=$4,grants=$5,deleting=$6,revision=revision+1,totp_key_id=$7,member_removal_id=NULL,member_removal_created=false,cleanup_due_at=CASE WHEN $6 THEN COALESCE(cleanup_due_at,now()) ELSE cleanup_due_at END WHERE team_id=$1 AND id=$2",team.0,row.id,record.user_id.as_ref(),metadata,grants,record.deleting,key).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
                if record.deleting {
                    sqlx::query!("UPDATE password_totp_enrollments SET state='retired',cleanup_after=GREATEST(cleanup_after,now()+interval '180 seconds') WHERE team_id=$1 AND item_id=$2 AND state<>'retired'",team.0,row.id).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
                }
            }
        }
        sqlx::query!(
            "UPDATE password_member_removals SET state='finished',finished_at=now() WHERE id=$1",
            removal
        )
        .execute(&mut *connection)
        .await
        .map_err(|_| Error::Unavailable)?;
        tracing::Span::current().record("outcome", "erasure_queued");
        Ok(())
    }

    /// Restore the original authorization facts without ever queuing erasure.
    #[tracing::instrument(skip_all,err,name="passwords.member.rollback",fields(team_id=%team.0,outcome=tracing::field::Empty))]
    pub async fn rollback_member_removal(
        connection: &mut sqlx::PgConnection,
        team: TeamId,
        member: &str,
    ) -> Result<(), Error> {
        let removal=sqlx::query_scalar!("SELECT id FROM password_member_removals WHERE team_id=$1 AND user_id=$2 AND state='prepared' FOR UPDATE",team.0,member).fetch_optional(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        let Some(removal) = removal else {
            return Ok(());
        };
        sqlx::query!("DELETE FROM password_item_entities WHERE member_removal_id=$1 AND member_removal_created",removal).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        sqlx::query!("UPDATE password_item_entities SET member_removal_id=NULL,revision=revision+1 WHERE member_removal_id=$1",removal).execute(&mut *connection).await.map_err(|_|Error::Unavailable)?;
        sqlx::query!(
            "UPDATE password_member_removals SET state='rolled_back',finished_at=now() WHERE id=$1",
            removal
        )
        .execute(&mut *connection)
        .await
        .map_err(|_| Error::Unavailable)?;
        tracing::Span::current().record("outcome", "unfenced");
        Ok(())
    }
}
