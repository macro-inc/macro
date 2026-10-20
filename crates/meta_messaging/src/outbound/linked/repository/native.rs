//! Transactional canonical identity and observation storage; native effects are
//! composed by DSS using the channel, message and document owners.
use super::*;
use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

/// A locked canonical source reservation, independent of its receiving account.
pub struct Reservation {
    /// External author of a reaction, distinct from the target message author.
    pub reaction_actor: Option<Uuid>,
    /// Native channel binding.
    pub binding: Binding,
    /// Stable verified external actor.
    pub person: Uuid,
    /// Native canonical message ID.
    pub message: Uuid,
    /// Whether native persistence has not occurred yet.
    pub create: bool,
    /// Deliberate Macro actor, only when a durable dispatch intent exists.
    pub actor: Option<String>,
    /// Verified association for provider-origin display, never human authority.
    pub associated_user: Option<String>,
    /// Canonical source ID, including mutations targeting older messages.
    pub source: String,
    /// Durable deletion cannot be undone by a replay or late media.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Ordered edit content, including edit-before-original recovery.
    pub revision_content: Option<String>,
    /// Retained source revision.
    pub revision: i64,
    /// Retained source revision time.
    pub revised_at: Option<DateTime<Utc>>,
}
impl PgLinkedRepository {
    /// All explicitly adopted scopes this observation can publish into.
    pub async fn observed_bindings(&self, a: &Account, e: &Event) -> PortResult<Vec<Binding>> {
        let Some(group) = &e.group_jid else {
            return Ok(vec![]);
        };
        sqlx::query!(
            r#"SELECT to_jsonb(b) AS "data!" FROM whatsapp_group_binding b
          JOIN whatsapp_group_membership m ON m.binding_id=b.id
          WHERE b.group_jid=$1 AND b.state='active'
          AND m.account_id=$2 AND m.authorization_generation=$3 AND m.consent_ended_at IS NULL
          AND m.remote_member AND m.reconciled AND whatsapp_linked_can_view(b.channel_id,$5) AND b.adopted_at<=$4 AND m.consent_at<=$4
          ORDER BY b.id LIMIT 100"#,
            group,
            a.id,
            a.authorization_generation,
            e.source_at,
            a.user_id
        )
        .fetch_all(&self.pool)
        .await
        .map_err(failure)?
        .into_iter()
        .map(|r| decode(r.data))
        .collect()
    }
    /// Reserve under the shared binding lock. Conflicting aliases are quarantined,
    /// never guessed from a display name or merged by text/time proximity.
    pub async fn reserve_in(
        tx: &mut Transaction<'_, Postgres>,
        a: &Account,
        b: &Binding,
        e: &Event,
        accepted: Option<Uuid>,
    ) -> PortResult<Option<Reservation>> {
        let m = e
            .message
            .as_ref()
            .ok_or(MessagingError::Invalid("missing normalized message"))?;
        let current=sqlx::query!("SELECT user_id,state,ownership_state FROM whatsapp_group_binding WHERE id=$1 FOR UPDATE",b.id).fetch_one(&mut **tx).await.map_err(failure)?;
        if current.user_id != b.user_id || current.ownership_state != "active" {
            return Err(MessagingError::Unavailable.into());
        }
        let accepted_recovery = if let Some(intent) = accepted {
            sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM meta_messaging_send WHERE id=$1 AND linked_binding_id=$2 AND linked_account_id=$3 AND provider_message_id=$4 AND state IN ('accepted','sent','delivered','read')) AS "accepted!""#,intent,b.id,a.id,m.source_id).fetch_one(&mut **tx).await.map_err(failure)?
        } else {
            false
        };
        if !accepted_recovery {
            let valid=sqlx::query_scalar!("SELECT a.id FROM whatsapp_linked_account a JOIN whatsapp_group_membership m ON m.account_id=a.id JOIN whatsapp_group_audience v ON v.binding_id=m.binding_id AND v.user_id=a.user_id JOIN comms_channel_participants cp ON cp.channel_id=$4 AND cp.user_id=a.user_id JOIN team_user tu ON tu.team_id=$5 AND tu.user_id=a.user_id WHERE a.id=$1 AND a.authorization_generation=$2 AND a.state IN ('connected','offline') AND m.binding_id=$3 AND m.authorization_generation=$2 AND m.consent_ended_at IS NULL AND m.remote_member AND m.reconciled AND v.revoked_at IS NULL AND v.remote_member AND v.reconciled AND cp.left_at IS NULL FOR SHARE OF a,m,v,cp,tu",a.id,e.scope.authorization_generation,b.id,b.channel_id,b.team_id).fetch_optional(&mut **tx).await.map_err(failure)?;
            if valid.is_none() || current.state != "active" {
                return Err(MessagingError::Forbidden.into());
            }
        }
        let mut aliases = vec![m.sender.jid.clone()];
        if let Some(other) = &m.sender.alternate_jid {
            aliases.push(other.clone());
        }
        let people=sqlx::query_scalar!("SELECT DISTINCT person_id FROM whatsapp_identity_alias WHERE binding_id=$1 AND jid=ANY($2)",b.id,&aliases).fetch_all(&mut **tx).await.map_err(failure)?;
        if people.len() > 1
            || (people.is_empty()
                && m.sender.jid.ends_with("@lid")
                && m.sender.alternate_jid.is_none())
        {
            let count=sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM whatsapp_inbound_event WHERE account_id=$1 AND state<>'applied'"#,a.id).fetch_one(&mut **tx).await.map_err(failure)?;
            if count >= 4096 {
                return Err(MessagingError::Unavailable.into());
            }
            let payload = serde_json::to_value(e).map_err(failure)?;
            sqlx::query!("INSERT INTO whatsapp_inbound_event(account_id,event_id,authorization_generation,owner_epoch,schema_version,payload,state) VALUES($1,$2,$3,$4,1,$5,'quarantined') ON CONFLICT(account_id,event_id) DO NOTHING",a.id,e.event_id,a.authorization_generation,e.scope.owner_epoch,payload).execute(&mut **tx).await.map_err(failure)?;
            return Ok(None);
        }
        let associated=sqlx::query_scalar!("SELECT user_id FROM whatsapp_linked_account WHERE identity_jid=ANY($1) ORDER BY created_at LIMIT 1",&aliases).fetch_optional(&mut **tx).await.map_err(failure)?;
        let person = people.first().copied().unwrap_or_else(Uuid::now_v7);
        sqlx::query!("INSERT INTO whatsapp_external_person(id,binding_id,user_id,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET display_name=COALESCE(excluded.display_name,whatsapp_external_person.display_name)",person,b.id,associated,m.sender.display_name).execute(&mut **tx).await.map_err(failure)?;
        for alias in &aliases {
            sqlx::query!("INSERT INTO whatsapp_identity_alias(binding_id,jid,person_id,evidence_account_id,verified_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(binding_id,jid) DO NOTHING",b.id,alias,person,a.id,e.observed_at).execute(&mut **tx).await.map_err(failure)?;
        }
        if m.kind == "reaction" {
            let target = m
                .target
                .as_ref()
                .ok_or(MessagingError::Invalid("missing reaction target"))?;
            let row=sqlx::query!("SELECT m.person_id,m.message_id,m.deleted_at,m.revision_content,m.content_revision,m.revised_at FROM whatsapp_external_message m JOIN whatsapp_identity_alias a ON a.binding_id=m.binding_id AND a.person_id=m.person_id WHERE m.binding_id=$1 AND a.jid=$2 AND m.source_id=$3",b.id,target.sender_jid,target.source_id).fetch_optional(&mut **tx).await.map_err(failure)?;
            let Some(row) = row else {
                return Err(MessagingError::Unavailable.into());
            };
            let Some(message) = row.message_id else {
                return Err(MessagingError::Unavailable.into());
            };
            return Ok(Some(Reservation {
                reaction_actor: Some(person),
                binding: b.clone(),
                person: row.person_id,
                message,
                create: false,
                actor: None,
                associated_user: associated,
                source: target.source_id.clone(),
                deleted_at: row.deleted_at,
                revision_content: row.revision_content,
                revision: row.content_revision,
                revised_at: row.revised_at,
            }));
        }
        let revision = matches!(m.kind.as_str(), "edit" | "delete");
        let source = if revision {
            m.target
                .as_ref()
                .ok_or(MessagingError::Invalid("missing revision target"))?
                .source_id
                .clone()
        } else {
            m.source_id.clone()
        };
        // Only the same verified author can edit/revoke. Remote admin revocations
        // need separate authenticated role evidence and are currently rejected.
        if revision
            && m.target
                .as_ref()
                .is_some_and(|target| !aliases.contains(&target.sender_jid))
        {
            return Err(MessagingError::Forbidden.into());
        }
        let send=sqlx::query!("SELECT s.id,s.user_id FROM meta_messaging_send s JOIN whatsapp_linked_account a ON a.id=s.linked_account_id WHERE s.linked_binding_id=$1 AND s.allocated_source_id=$2 AND a.identity_jid=ANY($3) AND s.dispatch_started_at IS NOT NULL",b.id,source,&aliases).fetch_optional(&mut **tx).await.map_err(failure)?;
        let origin = if send.is_some() {
            "macro"
        } else if m.history {
            "history"
        } else {
            "whatsapp"
        };
        let deleted = (m.kind == "delete").then_some(e.source_at);
        let content = (m.kind == "edit").then_some(m.text.clone());
        sqlx::query!("INSERT INTO whatsapp_external_message(binding_id,person_id,source_id,origin,source_at,content_revision,deleted_at,revision_content,revised_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(binding_id,person_id,source_id) DO UPDATE SET deleted_at=COALESCE(whatsapp_external_message.deleted_at,excluded.deleted_at),revision_content=CASE WHEN excluded.content_revision>whatsapp_external_message.content_revision THEN excluded.revision_content ELSE whatsapp_external_message.revision_content END,revised_at=CASE WHEN excluded.content_revision>whatsapp_external_message.content_revision THEN excluded.revised_at ELSE whatsapp_external_message.revised_at END,content_revision=GREATEST(whatsapp_external_message.content_revision,excluded.content_revision)",b.id,person,source,origin,e.source_at,m.revision,deleted,content,revision.then_some(e.source_at)).execute(&mut **tx).await.map_err(failure)?;
        sqlx::query!("INSERT INTO whatsapp_message_observation(binding_id,person_id,source_id,account_id,authorization_generation,observed_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",b.id,person,source,a.id,a.authorization_generation,e.observed_at).execute(&mut **tx).await.map_err(failure)?;
        let row=sqlx::query!("SELECT message_id,deleted_at,revision_content,content_revision,revised_at FROM whatsapp_external_message WHERE binding_id=$1 AND person_id=$2 AND source_id=$3",b.id,person,source).fetch_one(&mut **tx).await.map_err(failure)?;
        if revision && row.message_id.is_none() {
            return Ok(None);
        }
        Ok(Some(Reservation {
            reaction_actor: None,
            binding: b.clone(),
            person,
            message: row
                .message_id
                .unwrap_or_else(|| send.as_ref().map_or_else(Uuid::now_v7, |s| s.id)),
            create: row.message_id.is_none(),
            actor: send.map(|s| s.user_id),
            associated_user: associated,
            source,
            deleted_at: row.deleted_at,
            revision_content: row.revision_content,
            revision: row.content_revision,
            revised_at: row.revised_at,
        }))
    }
    /// Finish canonical persistence in the same transaction as the native row.
    pub async fn finish_in(
        tx: &mut Transaction<'_, Postgres>,
        r: &Reservation,
        changed: bool,
    ) -> PortResult<()> {
        sqlx::query!("UPDATE whatsapp_external_message SET message_id=$4,effect_revision=effect_revision+CASE WHEN $5 THEN 1 ELSE 0 END,native_retry_at=now(),origin=CASE WHEN $6 THEN 'macro' ELSE origin END WHERE binding_id=$1 AND person_id=$2 AND source_id=$3",r.binding.id,r.person,r.source,r.message,changed,r.actor.is_some()).execute(&mut **tx).await.map_err(failure)?;
        if r.actor.is_some() {
            sqlx::query!("UPDATE meta_messaging_send SET state=CASE WHEN state IN ('sending','unknown') THEN 'accepted' ELSE state END,provider_message_id=$3,message_id=$4,lease_id=NULL,lease_until=NULL WHERE linked_binding_id=$1 AND user_id=$2 AND allocated_source_id=$3 AND dispatch_started_at IS NOT NULL",r.binding.id,r.actor,r.source,r.message).execute(&mut **tx).await.map_err(failure)?;
        }
        Ok(())
    }
    /// Pending native publication uses the same effects adapter as other messages.
    pub async fn effects(
        &self,
    ) -> PortResult<Vec<crate::outbound::repository::native::NativeEffect>> {
        let rows=sqlx::query!("SELECT b.channel_id,m.message_id,m.effect_revision,m.published_revision,m.origin FROM whatsapp_external_message m JOIN whatsapp_group_binding b ON b.id=m.binding_id WHERE m.message_id IS NOT NULL AND m.published_revision<m.effect_revision AND m.native_retry_at<=now() ORDER BY m.native_retry_at,m.message_id LIMIT 50").fetch_all(&self.pool).await.map_err(failure)?;
        rows.into_iter()
            .map(|r| {
                Ok(crate::outbound::repository::native::NativeEffect {
                    channel_id: r.channel_id,
                    message_id: r.message_id.ok_or(MessagingError::Unavailable)?,
                    revision: r.effect_revision,
                    first_publication: r.published_revision == 0,
                    provenance: if r.origin == "history" {
                        Provenance::OnboardingHistory
                    } else if r.origin == "macro" {
                        Provenance::MacroReply
                    } else {
                        Provenance::Customer
                    },
                    direction: crate::domain::events::Direction::Inbound,
                })
            })
            .collect()
    }
    /// Complete only the revision actually published; later revisions remain due.
    pub async fn published(&self, message: Uuid, revision: i64) -> PortResult<()> {
        sqlx::query!("UPDATE whatsapp_external_message SET published_revision=GREATEST(published_revision,$2) WHERE message_id=$1",message,revision).execute(&self.pool).await.map_err(failure)?;
        Ok(())
    }
}
