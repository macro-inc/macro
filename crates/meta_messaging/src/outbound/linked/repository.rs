//! Linked state only. Native channel/message/document writes remain in their owners.
use crate::domain::{
    connection::*,
    linked::{models::*, ports::*},
    models::*,
    ports::*,
    replies::{AccountScope, PersonalAccountScope},
};
use crate::outbound::repository::{PgMessagingRepository, decode, failure};
use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

pub mod native;
mod sends;
#[cfg(test)]
mod test;

/// Personal account/group adapter sharing the foundation's durable intent table.
#[derive(Clone)]
pub struct PgLinkedRepository {
    /// MacroDB pool for hosting composition transactions.
    pub pool: PgPool,
    /// Existing durable queue implementation; no parallel send lifecycle.
    pub queue: PgMessagingRepository,
    /// Deployment send gate, checked again at the dispatch fence.
    pub sending: bool,
}
impl PgLinkedRepository {
    /// Wire the native database and server rollout gate.
    pub fn new(pool: PgPool, sending: bool) -> Self {
        Self {
            queue: PgMessagingRepository::new(pool.clone()),
            pool,
            sending,
        }
    }
    async fn account_in(
        &self,
        id: Option<Uuid>,
        user: Option<&str>,
    ) -> PortResult<Option<Account>> {
        sqlx::query!(
            r#"SELECT to_jsonb(a) || jsonb_build_object('owner_epoch',o.epoch) AS "data!"
            FROM whatsapp_linked_account a LEFT JOIN whatsapp_session_owner o ON o.account_id=a.id
            WHERE ($1::uuid IS NULL OR a.id=$1) AND ($2::text IS NULL OR a.user_id=$2)
            ORDER BY a.created_at DESC LIMIT 1"#,
            id,
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(|r| decode(r.data))
        .transpose()
    }
}
#[async_trait]
impl LinkedRepository for PgLinkedRepository {
    async fn owned_account(&self, user: &str) -> PortResult<Option<Account>> {
        self.account_in(None, Some(user)).await
    }
    async fn linked_account(&self, id: Uuid) -> PortResult<Option<Account>> {
        self.account_in(Some(id), None).await
    }
    async fn begin_pairing(&self, user: &str, replace: bool) -> PortResult<Pairing> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,7981))",
            user
        )
        .execute(&mut *tx)
        .await
        .map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_pairing SET state='expired',consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL AND expires_at<=now()",user).execute(&mut *tx).await.map_err(failure)?;
        if let Some(row)=sqlx::query!(r#"SELECT to_jsonb(p) AS "data!" FROM whatsapp_pairing p WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>now()"#,user).fetch_optional(&mut *tx).await.map_err(failure)? {
            let pairing=decode(row.data)?;tx.commit().await.map_err(failure)?;return Ok(pairing);
        }
        let old=sqlx::query!("SELECT id,identity_jid,state FROM whatsapp_linked_account WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",user).fetch_optional(&mut *tx).await.map_err(failure)?;
        if old
            .as_ref()
            .is_some_and(|a| a.state == "connected" || a.state == "offline")
        {
            return Err(MessagingError::Conflict.into());
        }
        let id = if replace {
            Uuid::now_v7()
        } else {
            old.as_ref().map_or_else(Uuid::now_v7, |a| a.id)
        };
        let store = Uuid::now_v7();
        let generation=sqlx::query_scalar!(r#"INSERT INTO whatsapp_linked_account(id,user_id,store_ref) VALUES($1,$2,$3)
            ON CONFLICT(id) DO UPDATE SET state='connecting',authorization_generation=whatsapp_linked_account.authorization_generation+1,updated_at=now()
            RETURNING authorization_generation"#,id,user,store).fetch_one(&mut *tx).await.map_err(failure)?;
        let expected = if replace {
            None
        } else {
            old.and_then(|a| a.identity_jid)
        };
        let pairing = Uuid::now_v7();
        let row=sqlx::query!(r#"INSERT INTO whatsapp_pairing(id,account_id,user_id,authorization_generation,state,expires_at,expected_identity_jid)
            VALUES($1,$2,$3,$4,'created',clock_timestamp()+interval '5 minutes',$5) RETURNING to_jsonb(whatsapp_pairing) AS "data!""#,pairing,id,user,generation,expected)
            .fetch_one(&mut *tx).await.map_err(failure)?;
        let pairing = decode(row.data)?;
        tx.commit().await.map_err(failure)?;
        Ok(pairing)
    }
    async fn pending_pairing(&self, account: Uuid) -> PortResult<Option<Pairing>> {
        sqlx::query!(r#"SELECT to_jsonb(p) AS "data!" FROM whatsapp_pairing p WHERE account_id=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp()"#,account).fetch_optional(&self.pool).await.map_err(failure)?.map(|r|decode(r.data)).transpose()
    }
    async fn pairing_snapshot(&self, user: &str, id: Uuid) -> PortResult<Pairing> {
        let row = sqlx::query!(
            r#"SELECT to_jsonb(p) AS "data!" FROM whatsapp_pairing p WHERE id=$1 AND user_id=$2"#,
            id,
            user
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .ok_or(MessagingError::Forbidden)?;
        decode(row.data)
    }
    async fn pairing(&self, user: &str, id: Uuid) -> PortResult<Pairing> {
        let row=sqlx::query!(r#"SELECT to_jsonb(p) AS "data!" FROM whatsapp_pairing p WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL AND expires_at>clock_timestamp()"#,id,user)
            .fetch_optional(&self.pool).await.map_err(failure)?.ok_or(MessagingError::Forbidden)?;
        decode(row.data)
    }
    async fn complete_pairing(&self, p: &Pairing, identity: &str) -> PortResult<Account> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let consumed=sqlx::query!("UPDATE whatsapp_pairing SET state='connected',consumed_at=clock_timestamp() WHERE id=$1 AND user_id=$2 AND account_id=$3 AND authorization_generation=$4 AND consumed_at IS NULL AND expires_at>clock_timestamp() AND (expected_identity_jid IS NULL OR expected_identity_jid=$5)",p.id,p.user_id,p.account_id,p.authorization_generation,identity).execute(&mut *tx).await.map_err(failure)?;
        if consumed.rows_affected() != 1 {
            let completed=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_pairing p JOIN whatsapp_linked_account a ON a.id=p.account_id WHERE p.id=$1 AND p.user_id=$2 AND p.state='connected' AND p.consumed_at IS NOT NULL AND a.id=$3 AND a.authorization_generation=$4 AND a.identity_jid=$5 AND a.state='connected') AS "completed!""#,p.id,p.user_id,p.account_id,p.authorization_generation,identity).fetch_one(&mut *tx).await.map_err(failure)?;
            if !completed {
                return Err(MessagingError::Conflict.into());
            }
            tx.commit().await.map_err(failure)?;
            return self
                .linked_account(p.account_id)
                .await?
                .ok_or_else(|| MessagingError::NotFound.into());
        }
        sqlx::query!("INSERT INTO whatsapp_verified_identity(jid,user_id) VALUES($1,$2) ON CONFLICT(jid) DO NOTHING",identity,p.user_id).execute(&mut *tx).await.map_err(failure)?;
        let owner = sqlx::query_scalar!(
            "SELECT user_id FROM whatsapp_verified_identity WHERE jid=$1 FOR UPDATE",
            identity
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        if owner != p.user_id {
            return Err(MessagingError::Forbidden.into());
        }
        // Unique verified identity prevents another owner from stealing an account.
        let changed=sqlx::query!("UPDATE whatsapp_linked_account SET identity_jid=$3,state='connected',updated_at=now() WHERE id=$1 AND user_id=$2 AND authorization_generation=$4 AND (identity_jid IS NULL OR identity_jid=$3)",p.account_id,p.user_id,identity,p.authorization_generation).execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        tx.commit().await.map_err(failure)?;
        self.linked_account(p.account_id)
            .await?
            .ok_or_else(|| MessagingError::NotFound.into())
    }
    async fn cancel_pairing(&self, p: &Pairing) -> PortResult<bool> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let changed=sqlx::query!("UPDATE whatsapp_pairing SET state='cancelled',consumed_at=now(),handoff_sha256=NULL WHERE id=$1 AND user_id=$2 AND consumed_at IS NULL",p.id,p.user_id).execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            tx.commit().await.map_err(failure)?;
            return Ok(false);
        }

        sqlx::query!("UPDATE whatsapp_linked_account SET state='disconnected',authorization_generation=authorization_generation+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND authorization_generation=$3",p.account_id,p.user_id,p.authorization_generation).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;
        Ok(true)
    }
    async fn disconnect_account(&self, user: &str, id: Uuid, generation: i64) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let changed=sqlx::query!("UPDATE whatsapp_linked_account SET state='disconnected',authorization_generation=authorization_generation+1,updated_at=now() WHERE id=$1 AND user_id=$2 AND authorization_generation=$3",id,user,generation).execute(&mut *tx).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Forbidden.into());
        }
        sqlx::query!("UPDATE whatsapp_pairing SET state='cancelled',consumed_at=now(),handoff_sha256=NULL WHERE account_id=$1 AND consumed_at IS NULL",id).execute(&mut *tx).await.map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_group_membership SET consent_ended_at=COALESCE(consent_ended_at,now()) WHERE account_id=$1",id).execute(&mut *tx).await.map_err(failure)?;
        sqlx::query!("UPDATE meta_messaging_send SET state='failed',error_code='authorization_ended',lease_id=NULL,lease_until=NULL WHERE linked_account_id=$1 AND dispatch_started_at IS NULL AND state IN ('pending','sending')",id).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
    async fn binding(&self, channel: Uuid) -> PortResult<Option<Binding>> {
        sqlx::query!(
            r#"SELECT to_jsonb(b) AS "data!" FROM whatsapp_group_binding b WHERE channel_id=$1"#,
            channel
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(failure)?
        .map(|r| decode(r.data))
        .transpose()
    }
    async fn active_accounts(&self) -> PortResult<Vec<Account>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_linked_account a SET state='disconnected',authorization_generation=a.authorization_generation+1,updated_at=now() FROM whatsapp_pairing p WHERE p.account_id=a.id AND p.authorization_generation=a.authorization_generation AND p.consumed_at IS NULL AND p.expires_at<=clock_timestamp()").execute(&mut *tx).await.map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_pairing SET state='expired',consumed_at=clock_timestamp(),handoff_sha256=NULL WHERE consumed_at IS NULL AND expires_at<=clock_timestamp()").execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)?;

        sqlx::query!(r#"SELECT to_jsonb(a)||jsonb_build_object('owner_epoch',o.epoch) AS "data!" FROM whatsapp_linked_account a LEFT JOIN whatsapp_session_owner o ON o.account_id=a.id WHERE a.state IN ('connecting','connected','offline','reconnect') OR EXISTS(SELECT 1 FROM meta_messaging_send s WHERE s.linked_account_id=a.id AND s.state IN ('sending','unknown') AND s.dispatch_started_at IS NOT NULL AND s.provider_message_id IS NULL) ORDER BY a.updated_at,a.id LIMIT 100"#)
            .fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.data)).collect()
    }
    async fn record_account_event(&self, e: &Event) -> PortResult<()> {
        let state = match e.kind.as_str() {
            "offline" => Some("offline"),
            "logged_out" => Some("reconnect"),
            "connected" => Some("connected"),
            _ => None,
        };
        let mut tx = self.pool.begin().await.map_err(failure)?;
        if let Some(state) = state {
            sqlx::query!("UPDATE whatsapp_linked_account SET state=$4,authorization_generation=authorization_generation+CASE WHEN $4='reconnect' THEN 1 ELSE 0 END,updated_at=now() WHERE id=$1 AND authorization_generation=$2 AND EXISTS(SELECT 1 FROM whatsapp_session_owner WHERE account_id=$1 AND epoch=$3) AND identity_jid IS NOT NULL",e.scope.account_id,e.scope.authorization_generation,e.scope.owner_epoch,state).execute(&mut *tx).await.map_err(failure)?;
        }
        if e.kind == "group_left" {
            sqlx::query!("UPDATE whatsapp_group_membership m SET remote_member=false,can_post=false,reconciled=true,observed_at=$4 FROM whatsapp_group_binding b WHERE b.id=m.binding_id AND b.group_jid=$1 AND m.account_id=$2 AND m.authorization_generation=$3 AND m.observed_at<=$4",e.group_jid,e.scope.account_id,e.scope.authorization_generation,e.observed_at).execute(&mut *tx).await.map_err(failure)?;
            sqlx::query!("UPDATE whatsapp_group_audience v SET remote_member=false,reconciled=true,observed_at=$4 FROM whatsapp_group_binding b,whatsapp_linked_account a WHERE b.id=v.binding_id AND b.group_jid=$1 AND a.id=$2 AND a.authorization_generation=$3 AND v.user_id=a.user_id AND v.observed_at<=$4",e.group_jid,e.scope.account_id,e.scope.authorization_generation,e.observed_at).execute(&mut *tx).await.map_err(failure)?;
        }
        if let Some(receipt) = &e.receipt {
            for source in receipt.source_ids.iter().take(256) {
                sqlx::query!("INSERT INTO whatsapp_participant_receipt(account_id,binding_id,source_id,participant_jid,receipt_state,source_at) SELECT $1,b.id,$4,$5,$6,$7 FROM whatsapp_group_binding b JOIN whatsapp_group_membership m ON m.binding_id=b.id JOIN whatsapp_linked_account a ON a.id=m.account_id WHERE b.group_jid=$2 AND m.account_id=$1 AND m.authorization_generation=$3 AND m.consent_ended_at IS NULL AND whatsapp_linked_can_view(b.channel_id,a.user_id) ON CONFLICT(account_id,binding_id,source_id,participant_jid,receipt_state) DO UPDATE SET source_at=GREATEST(whatsapp_participant_receipt.source_at,excluded.source_at)",e.scope.account_id,e.group_jid,e.scope.authorization_generation,source,receipt.participant_jid,receipt.state,e.source_at).execute(&mut *tx).await.map_err(failure)?;
            }
        }
        // Content has already committed at this point; retain an event ID, not a
        // second copy of message bodies, QR material or protocol data.
        sqlx::query!("INSERT INTO whatsapp_inbound_event(account_id,event_id,authorization_generation,owner_epoch,schema_version,payload,state) VALUES($1,$2,$3,$4,1,'{}','applied') ON CONFLICT(account_id,event_id) DO UPDATE SET state='applied',payload='{}'",e.scope.account_id,e.event_id,e.scope.authorization_generation,e.scope.owner_epoch).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
    async fn roster(&self, channel: Uuid) -> PortResult<Option<GroupInfo>> {
        sqlx::query!("SELECT r.metadata FROM whatsapp_group_roster r JOIN whatsapp_group_binding b ON b.id=r.binding_id WHERE b.channel_id=$1",channel).fetch_optional(&self.pool).await.map_err(failure)?.map(|r|decode(r.metadata)).transpose()
    }
    async fn observing_groups(&self, a: &Account) -> PortResult<Vec<ObservationGrant>> {
        sqlx::query!(r#"SELECT jsonb_build_object('binding',to_jsonb(b),'starts_at',GREATEST(b.adopted_at,m.consent_at)) AS "data!" FROM whatsapp_group_binding b JOIN whatsapp_group_membership m ON m.binding_id=b.id WHERE m.account_id=$1 AND m.authorization_generation=$2 AND m.consent_ended_at IS NULL AND b.state='active' AND whatsapp_linked_can_view(b.channel_id,$3) ORDER BY b.id LIMIT 100"#,a.id,a.authorization_generation,a.user_id).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.data)).collect()
    }
    async fn defer_event(&self, e: &Event) -> PortResult<()> {
        let payload = serde_json::to_value(e).map_err(failure)?;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        sqlx::query!(
            "SELECT id FROM whatsapp_linked_account WHERE id=$1 FOR UPDATE",
            e.scope.account_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(failure)?;
        let count=sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id=$1 AND state<>'applied'"#,e.scope.account_id).fetch_one(&mut *tx).await.map_err(failure)?;
        if count >= 4096 {
            return Err(MessagingError::Unavailable.into());
        }
        sqlx::query!("INSERT INTO whatsapp_inbound_event(account_id,event_id,authorization_generation,owner_epoch,schema_version,payload,state,retry_at) SELECT $1,$2,$3,$4,1,$5,'pending',now()+interval '10 seconds' WHERE EXISTS(SELECT 1 FROM whatsapp_group_binding b JOIN whatsapp_group_membership m ON m.binding_id=b.id JOIN whatsapp_linked_account a ON a.id=m.account_id WHERE b.group_jid=$6 AND m.account_id=$1 AND m.authorization_generation=$3 AND m.consent_ended_at IS NULL AND b.adopted_at<=$7 AND whatsapp_linked_can_view(b.channel_id,a.user_id)) ON CONFLICT(account_id,event_id) DO UPDATE SET retry_at=now()+interval '30 seconds',attempts=whatsapp_inbound_event.attempts+1",e.scope.account_id,e.event_id,e.scope.authorization_generation,e.scope.owner_epoch,payload,e.group_jid,e.source_at).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
    async fn pending_events(&self, a: &Account) -> PortResult<Vec<Event>> {
        sqlx::query!("SELECT payload FROM whatsapp_inbound_event WHERE account_id=$1 AND authorization_generation=$2 AND state IN ('pending','quarantined') AND retry_at<=now() ORDER BY retry_at,event_id LIMIT 32",a.id,a.authorization_generation).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.payload)).collect()
    }
    async fn unresolved_commands(&self, account: Uuid) -> PortResult<Vec<(Uuid, i64)>> {
        sqlx::query!(r#"SELECT id,authorization_generation AS "generation!" FROM meta_messaging_send WHERE linked_account_id=$1 AND allocated_source_id IS NOT NULL AND dispatch_started_at IS NOT NULL AND provider_message_id IS NULL AND state IN ('sending','unknown') ORDER BY created_at,id LIMIT 32"#,account).fetch_all(&self.pool).await.map_err(failure).map(|rows|rows.into_iter().map(|r|(r.id,r.generation)).collect())
    }
    async fn recover_outcome(
        &self,
        account: Uuid,
        generation: i64,
        command: Uuid,
        source: &str,
        state: &str,
    ) -> PortResult<()> {
        if state != "accepted" {
            return Ok(());
        }
        sqlx::query!("UPDATE meta_messaging_send SET state='accepted',provider_message_id=allocated_source_id,lease_id=NULL,lease_until=NULL,native_retry_at=now() WHERE id=$1 AND linked_account_id=$2 AND authorization_generation=$3 AND allocated_source_id=$4 AND dispatch_started_at IS NOT NULL AND provider_message_id IS NULL AND state IN ('sending','unknown')",command,account,generation,source).execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
    async fn reconcile_group(&self, a: &Account, g: &GroupInfo) -> PortResult<()> {
        let roster: Vec<String> = g
            .participants
            .iter()
            .flat_map(|p| {
                std::iter::once(p.identity.jid.clone()).chain(p.identity.alternate_jid.clone())
            })
            .collect();
        let own = a.identity_jid.as_deref().and_then(|id| g.participant(id));
        let member = own.is_some();
        let posting =
            own.is_some_and(|p| !g.announce || p.admin) && !g.community && !g.disappearing;
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let valid=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_linked_account a JOIN whatsapp_session_owner o ON o.account_id=a.id WHERE a.id=$1 AND a.authorization_generation=$2 AND o.epoch=$3 AND a.state<>'disconnected') AS "valid!""#,a.id,a.authorization_generation,a.owner_epoch).fetch_one(&mut *tx).await.map_err(failure)?;
        if !valid {
            return Err(MessagingError::Conflict.into());
        }
        // Serialize competing observer snapshots before upgrading audience locks.
        sqlx::query!(
            "SELECT id FROM whatsapp_group_binding WHERE group_jid=$1 ORDER BY id FOR UPDATE",
            g.jid
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(failure)?;
        let permitted=sqlx::query_scalar!("SELECT b.id FROM whatsapp_group_binding b JOIN whatsapp_group_membership m ON m.binding_id=b.id JOIN whatsapp_group_audience v ON v.binding_id=b.id AND v.user_id=$3 JOIN comms_channel_participants cp ON cp.channel_id=b.channel_id AND cp.user_id=$3 JOIN team_user tu ON tu.team_id=b.team_id AND tu.user_id=$3 WHERE b.group_jid=$1 AND m.account_id=$2 AND m.consent_ended_at IS NULL AND m.authorization_generation=$4 AND v.revoked_at IS NULL AND cp.left_at IS NULL FOR SHARE OF b,m,v,cp,tu",g.jid,a.id,a.user_id,a.authorization_generation).fetch_all(&mut *tx).await.map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_group_membership m SET remote_member=$4,can_post=$5,observed_at=$6,metadata_version=$7,reconciled=true FROM whatsapp_group_binding b WHERE m.binding_id=b.id AND b.group_jid=$1 AND m.account_id=$2 AND m.authorization_generation=$3 AND m.observed_at<=$6 AND b.id=ANY($8)",g.jid,a.id,a.authorization_generation,member,posting,g.observed_at,g.version,&permitted).execute(&mut *tx).await.map_err(failure)?;
        sqlx::query!("UPDATE whatsapp_group_audience v SET remote_member=(v.identity_jid=ANY($2)),reconciled=true,observed_at=$3,membership_version=$4 FROM whatsapp_group_binding b WHERE v.binding_id=b.id AND b.group_jid=$1 AND v.observed_at<=$3 AND b.id=ANY($5)",g.jid,&roster,g.observed_at,g.version,&permitted).execute(&mut *tx).await.map_err(failure)?;
        let metadata = serde_json::to_value(g).map_err(failure)?;
        sqlx::query!("INSERT INTO whatsapp_group_roster(binding_id,observed_at,metadata) SELECT b.id,$3,$4 FROM whatsapp_group_binding b JOIN whatsapp_group_membership m ON m.binding_id=b.id WHERE b.group_jid=$1 AND m.account_id=$2 AND m.consent_ended_at IS NULL AND b.id=ANY($5) ON CONFLICT(binding_id) DO UPDATE SET metadata=excluded.metadata,observed_at=excluded.observed_at WHERE whatsapp_group_roster.observed_at<excluded.observed_at",g.jid,a.id,g.observed_at,metadata,&permitted).execute(&mut *tx).await.map_err(failure)?;
        if g.disappearing || g.community {
            sqlx::query!("UPDATE whatsapp_group_binding SET state='suspended' WHERE group_jid=$1 AND state='active' AND id=ANY($2)",g.jid,&permitted).execute(&mut *tx).await.map_err(failure)?;
        }
        tx.commit().await.map_err(failure)
    }
}
#[async_trait]
impl ConversationRepository for PgLinkedRepository {
    async fn account_scope(&self, id: Uuid, channel: Uuid) -> PortResult<Option<AccountScope>> {
        let Some(a) = self.linked_account(id).await? else {
            return Ok(None);
        };
        let Some(b) = self.binding(channel).await? else {
            return Ok(None);
        };
        Ok(Some(AccountScope {
            id: a.id,
            team_id: b.team_id,
            generation: None,
            status: if a.state == AccountState::Connected {
                ConnectionStatus::Connected
            } else {
                ConnectionStatus::Disconnected
            },
            personal: Some(PersonalAccountScope {
                user_id: a.user_id,
                authorization_generation: a.authorization_generation,
                owner_epoch: a.owner_epoch.ok_or(MessagingError::Disconnected)?,
                identity_jid: a.identity_jid.ok_or(MessagingError::Disconnected)?,
            }),
        }))
    }
    async fn account_for_sender(&self, c: &Conversation, user: &str) -> PortResult<AccountScope> {
        let a = self
            .owned_account(user)
            .await?
            .ok_or(MessagingError::Disconnected)?;
        self.account_scope(a.id, c.channel_id)
            .await?
            .ok_or_else(|| MessagingError::NotFound.into())
    }
    async fn conversation(&self, channel: Uuid) -> PortResult<Option<Conversation>> {
        self.binding(channel)
            .await?
            .map(|b| conversation(&b).map_err(Into::into))
            .transpose()
    }
    async fn has_message(&self, c: &Conversation, id: &ProviderId) -> PortResult<bool> {
        sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_external_message WHERE binding_id=$1 AND message_id::text=$2 AND deleted_at IS NULL) AS "exists!""#,c.connection_id,id.as_str()).fetch_one(&self.pool).await.map_err(failure)
    }
    async fn enqueue_send(
        &self,
        account: Uuid,
        channel: Uuid,
        user: &str,
        request: &SendReply,
        digest: &[u8],
    ) -> PortResult<SendProgress> {
        self.enqueue(account, channel, user, request, digest).await
    }
    async fn sends(&self, channel: Uuid) -> PortResult<Vec<SendProgress>> {
        self.queue.sends(channel).await
    }
    async fn sends_for_messages(
        &self,
        channel: Uuid,
        ids: &[Uuid],
    ) -> PortResult<Vec<SendProgress>> {
        sqlx::query!(r#"SELECT to_jsonb(s) AS "data!" FROM meta_messaging_send s WHERE channel_id=$1 AND linked_binding_id IS NOT NULL AND message_id=ANY($2) LIMIT 100"#,channel,ids).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|decode(r.data)).collect()
    }
    async fn claim_send(&self) -> PortResult<Option<SendWork>> {
        self.queue.claim_send_impl(true).await
    }
    async fn accepted_sends(&self) -> PortResult<Vec<(SendWork, ProviderId)>> {
        self.queue.accepted_sends_impl(true).await
    }
    async fn defer_accepted_send(&self, work: &SendWork, id: &ProviderId) -> PortResult<()> {
        self.queue.defer_accepted_send(work, id).await
    }
    async fn prepare_send(
        &self,
        lease: &Lease,
        account: &AccountScope,
        c: &Conversation,
        text: &str,
    ) -> PortResult<()> {
        self.fence(lease, account, c, text).await
    }
    async fn settle_send(
        &self,
        lease: &Lease,
        state: DeliveryState,
        id: Option<&ProviderId>,
        error: Option<&str>,
        retry: Option<u32>,
    ) -> PortResult<()> {
        self.queue.settle_send(lease, state, id, error, retry).await
    }
}
