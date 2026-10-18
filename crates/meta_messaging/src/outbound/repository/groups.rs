//! Current group bindings and confirmed membership. No orphan adoption or operation log.
use super::*;
use crate::domain::groups::{ports::GroupRepository, *};
use sqlx::{Postgres, Transaction};

/// Native subject mutation to commit in the same composition transaction.
pub struct GroupNameChange {
    /// Existing native channel.
    pub channel_id: Uuid,
    /// Confirmed provider subject.
    pub name: String,
}

impl PgMessagingRepository {
    /// Fence binding/retry/reconnect through native deletion, without holding a
    /// row lock during provider I/O. Discard can never delete a bound group.
    pub async fn lock_group_deletion_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        channel: Uuid,
        discard: bool,
    ) -> PortResult<()> {
        // Local teardown remains valid after disconnect. Keep the same row lock
        // and reconnect-generation fence without requiring new provider authority.
        let current = sqlx::query!("SELECT connected_at FROM meta_messaging_connection WHERE id=$1 AND team_id=$2 FOR UPDATE",c.id,c.team_id)
            .fetch_optional(&mut **tx).await.map_err(failure)?.ok_or(MessagingError::NotFound)?;
        if current.connected_at != c.connected_at {
            return Err(MessagingError::Conflict.into());
        }
        let allowed = if discard {
            sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_group_setup WHERE channel_id=$1 AND connection_id=$2 AND (state IN ('failed','unknown') OR started_at<now()-make_interval(secs=>$3::int))) AS \"allowed!\"",channel,c.id,GROUP_SETUP_TIMEOUT_SECONDS).fetch_one(&mut **tx).await.map_err(failure)?
        } else {
            sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_conversation WHERE channel_id=$1 AND connection_id=$2 AND kind='group' AND group_status='deleted') AS \"allowed!\"",channel,c.id).fetch_one(&mut **tx).await.map_err(failure)?
        };
        if !allowed {
            return Err(MessagingError::Conflict.into());
        }
        Ok(())
    }

    /// Reserve only the requested native identity after its channel has been created.
    pub async fn create_group_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        request: &CreateGroup,
    ) -> PortResult<GroupAttempt> {
        Self::lock_identity_in(tx, c).await?;
        let attempt = Uuid::now_v7();
        sqlx::query!("INSERT INTO meta_messaging_group_setup(channel_id,connection_id,subject,state,attempt_id,generation) VALUES ($1,$2,$3,'creating',$4,$5)", request.channel_id,c.id,request.subject,attempt,c.connected_at)
            .execute(&mut **tx).await.map_err(failure)?;
        Ok(GroupAttempt {
            setup: GroupSetup {
                channel_id: request.channel_id,
                connection_id: c.id,
                subject: request.subject.clone(),
                state: GroupSetupState::Creating,
                error_code: None,
            },
            attempt_id: attempt,
            generation: c.connected_at,
        })
    }

    async fn unknown_group_in(
        tx: &mut Transaction<'_, Postgres>,
        connection: Uuid,
        awaiting_request: bool,
    ) -> PortResult<()> {
        let waiting = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM meta_messaging_group_setup WHERE connection_id=$1 AND state IN ('creating','pending') AND started_at>=now()-make_interval(secs=>$3::int) AND (NOT $2 OR (state='creating' AND request_id IS NULL))) AS \"waiting!\"",connection,awaiting_request,GROUP_SETUP_TIMEOUT_SECONDS).fetch_one(&mut **tx).await.map_err(failure)?;
        if waiting {
            Err(MessagingError::GroupBindingPending.into())
        } else {
            tracing::info!(connection_id=%connection,"unknown WhatsApp group/request ignored");
            Ok(())
        }
    }

    /// Apply a source-ordered signed fact. Callers own native name mutation/publication.
    pub async fn apply_group_event_in(
        tx: &mut Transaction<'_, Postgres>,
        c: &Connection,
        event: &GroupEvent,
    ) -> PortResult<Option<GroupNameChange>> {
        Self::lock_identity_in(tx, c).await?;
        if let GroupFact::Created {
            request_id,
            group_id,
            subject,
            invite_link,
            error_code,
        } = &event.fact
        {
            let setup = sqlx::query!("SELECT channel_id,subject,generation FROM meta_messaging_group_setup WHERE connection_id=$1 AND request_id=$2 AND state='pending' FOR UPDATE",c.id,request_id.as_str()).fetch_optional(&mut **tx).await.map_err(failure)?;
            let Some(setup) = setup else {
                Self::unknown_group_in(tx, c.id, true).await?;
                return Ok(None);
            };
            if setup.generation != c.connected_at {
                return Ok(None);
            }
            if let Some(error_code) = error_code {
                sqlx::query!("UPDATE meta_messaging_group_setup SET state='failed',error_code=$2 WHERE channel_id=$1",setup.channel_id,error_code).execute(&mut **tx).await.map_err(failure)?;
                return Ok(None);
            }
            let (Some(group), Some(subject), Some(invite_link)) = (group_id, subject, invite_link)
            else {
                return Err(MessagingError::InvalidProviderPayload.into());
            };
            sqlx::query!("INSERT INTO meta_messaging_conversation(connection_id,kind,customer_id,channel_id,external_sender_id,customer_display_name,group_status,group_status_at,group_subject_at,group_invite_link,group_creation_subject,group_creation_generation) VALUES ($1,'group',$2,$3,$4,$5,'active',$6,$6,$7,$8,$9)",c.id,group.as_str(),setup.channel_id,Uuid::now_v7(),subject,event.timestamp,invite_link,setup.subject,setup.generation).execute(&mut **tx).await.map_err(failure)?;
            sqlx::query!(
                "DELETE FROM meta_messaging_group_setup WHERE channel_id=$1",
                setup.channel_id
            )
            .execute(&mut **tx)
            .await
            .map_err(failure)?;
            return Ok(Some(GroupNameChange {
                channel_id: setup.channel_id,
                name: subject.clone(),
            }));
        }
        let group_id = match &event.fact {
            GroupFact::Deleted { group_id }
            | GroupFact::Participant { group_id, .. }
            | GroupFact::Subject { group_id, .. }
            | GroupFact::Status { group_id, .. } => group_id,
            GroupFact::Created { .. } => unreachable!("creation handled above"),
        };
        let group = sqlx::query!("SELECT channel_id,group_status AS \"group_status: GroupStatus\" FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='group' AND customer_id=$2 FOR UPDATE",c.id,group_id.as_str()).fetch_optional(&mut **tx).await.map_err(failure)?;
        let Some(group) = group else {
            Self::unknown_group_in(tx, c.id, false).await?;
            return Ok(None);
        };
        if group.group_status == Some(GroupStatus::Deleted) {
            return Ok(None);
        }
        match &event.fact {
            GroupFact::Deleted { .. } => {
                sqlx::query!("UPDATE meta_messaging_conversation SET group_status='deleted',group_status_at=GREATEST(group_status_at,$2),group_invite_link=NULL WHERE channel_id=$1",group.channel_id,event.timestamp).execute(&mut **tx).await.map_err(failure)?;
            }
            GroupFact::Status { status, .. } => {
                sqlx::query!("UPDATE meta_messaging_conversation SET group_status=$2,group_status_at=$3 WHERE channel_id=$1 AND group_status<>'deleted' AND (group_status_at IS NULL OR group_status_at<$3 OR (group_status_at=$3 AND $2='suspended'))",group.channel_id,status.as_ref(),event.timestamp).execute(&mut **tx).await.map_err(failure)?;
            }
            GroupFact::Subject { subject, .. } => {
                let changed=sqlx::query!("UPDATE meta_messaging_conversation SET customer_display_name=$2,group_subject_at=$3 WHERE channel_id=$1 AND (group_subject_at IS NULL OR group_subject_at<$3)",group.channel_id,subject,event.timestamp).execute(&mut **tx).await.map_err(failure)?;
                if changed.rows_affected() > 0 {
                    return Ok(Some(GroupNameChange {
                        channel_id: group.channel_id,
                        name: subject.clone(),
                    }));
                }
            }
            GroupFact::Participant { participant, .. } => {
                let customer = Self::observe_identity_in(
                    tx,
                    c,
                    &participant.customer_id,
                    participant.phone.as_ref(),
                    event.timestamp,
                )
                .await?;
                Self::participant_in(
                    tx,
                    group.channel_id,
                    &customer,
                    participant,
                    event.timestamp,
                    true,
                )
                .await?;
            }
            GroupFact::Created { .. } => unreachable!("creation handled above"),
        }
        Ok(None)
    }

    /// Resolve a stable author without creating a direct conversation or changing its window.
    pub async fn participant_in(
        tx: &mut Transaction<'_, Postgres>,
        channel: Uuid,
        customer: &ProviderId,
        fact: &ParticipantFact,
        at: DateTime<Utc>,
        membership: bool,
    ) -> PortResult<Uuid> {
        let sender = Uuid::now_v7();
        sqlx::query_scalar!(r#"INSERT INTO meta_messaging_group_participant(channel_id,customer_id,external_sender_id,display_name,username,phone,active,membership_at,profile_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
            ON CONFLICT(channel_id,customer_id) DO UPDATE SET
              active=CASE WHEN $9 AND (meta_messaging_group_participant.membership_at<EXCLUDED.membership_at OR (meta_messaging_group_participant.membership_at=EXCLUDED.membership_at AND NOT EXCLUDED.active)) THEN EXCLUDED.active ELSE meta_messaging_group_participant.active END,
              membership_at=CASE WHEN $9 THEN GREATEST(meta_messaging_group_participant.membership_at,EXCLUDED.membership_at) ELSE meta_messaging_group_participant.membership_at END,
              display_name=CASE WHEN EXCLUDED.profile_at>=meta_messaging_group_participant.profile_at THEN COALESCE(EXCLUDED.display_name,meta_messaging_group_participant.display_name) ELSE meta_messaging_group_participant.display_name END,
              username=CASE WHEN EXCLUDED.profile_at>=meta_messaging_group_participant.profile_at THEN COALESCE(EXCLUDED.username,meta_messaging_group_participant.username) ELSE meta_messaging_group_participant.username END,
              phone=CASE WHEN EXCLUDED.profile_at>=meta_messaging_group_participant.profile_at THEN COALESCE(EXCLUDED.phone,meta_messaging_group_participant.phone) ELSE meta_messaging_group_participant.phone END,
              profile_at=GREATEST(EXCLUDED.profile_at,meta_messaging_group_participant.profile_at)
            RETURNING external_sender_id"#,channel,customer.as_str(),sender,fact.display_name,fact.username,fact.phone.as_ref().map(ProviderId::as_str),fact.active,at,membership)
            .fetch_one(&mut **tx).await.map_err(failure)
    }
}

#[async_trait]
impl GroupRepository for PgMessagingRepository {
    async fn group_attempt(&self, channel: Uuid) -> PortResult<Option<GroupAttempt>> {
        let row=sqlx::query!("SELECT channel_id,connection_id,subject,CASE WHEN state IN ('creating','pending') AND started_at<now()-make_interval(secs=>$2::int) THEN 'unknown' ELSE state END AS \"state!\",error_code,attempt_id,generation FROM meta_messaging_group_setup WHERE channel_id=$1",channel,GROUP_SETUP_TIMEOUT_SECONDS).fetch_optional(&self.pool).await.map_err(failure)?;
        row.map(|r| {
            Ok(GroupAttempt {
                setup: GroupSetup {
                    channel_id: r.channel_id,
                    connection_id: r.connection_id,
                    subject: r.subject,
                    state: r.state.parse().map_err(failure)?,
                    error_code: r.error_code,
                },
                attempt_id: r.attempt_id,
                generation: r.generation,
            })
        })
        .transpose()
    }
    async fn completed_group(
        &self,
        c: &Connection,
        channel: Uuid,
    ) -> PortResult<Option<GroupSetup>> {
        let row = sqlx::query!(
            "SELECT group_creation_subject AS subject FROM meta_messaging_conversation WHERE channel_id=$1 AND connection_id=$2 AND kind='group' AND group_creation_subject IS NOT NULL AND group_creation_generation IS NOT DISTINCT FROM $3",
            channel, c.id, c.connected_at
        ).fetch_optional(&self.pool).await.map_err(failure)?;
        row.map(|row| {
            Ok(GroupSetup {
                channel_id: channel,
                connection_id: c.id,
                subject: row.subject.ok_or(MessagingError::Unavailable)?,
                state: GroupSetupState::Bound,
                error_code: None,
            })
        })
        .transpose()
    }
    async fn retry_group(&self, c: &Connection, channel: Uuid) -> PortResult<GroupAttempt> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        Self::lock_identity_in(&mut tx, c).await?;
        let attempt = Uuid::now_v7();
        let row=sqlx::query!("UPDATE meta_messaging_group_setup SET state='creating',attempt_id=$3,generation=$4,request_id=NULL,error_code=NULL,started_at=now() WHERE channel_id=$1 AND connection_id=$2 AND (state IN ('failed','unknown') OR started_at<now()-make_interval(secs=>$5::int)) RETURNING subject",channel,c.id,attempt,c.connected_at,GROUP_SETUP_TIMEOUT_SECONDS).fetch_optional(&mut *tx).await.map_err(failure)?.ok_or(MessagingError::Conflict)?;
        tx.commit().await.map_err(failure)?;
        Ok(GroupAttempt {
            setup: GroupSetup {
                channel_id: channel,
                connection_id: c.id,
                subject: row.subject,
                state: GroupSetupState::Creating,
                error_code: None,
            },
            attempt_id: attempt,
            generation: c.connected_at,
        })
    }
    async fn finish_group_create(
        &self,
        c: &Connection,
        attempt: &GroupAttempt,
        result: GroupCreateResult,
    ) -> PortResult<()> {
        let (state, request, error) = match result {
            GroupCreateResult::Pending(id) => (GroupSetupState::Pending, Some(id), None),
            GroupCreateResult::Rejected(code) => (GroupSetupState::Failed, None, Some(code)),
            GroupCreateResult::Unknown => (
                GroupSetupState::Unknown,
                None,
                Some("group_unconfirmed".into()),
            ),
        };
        let changed=sqlx::query!("UPDATE meta_messaging_group_setup s SET state=$4,request_id=$5,error_code=$6 WHERE channel_id=$1 AND connection_id=$2 AND attempt_id=$3 AND generation=$7 AND EXISTS(SELECT 1 FROM meta_messaging_connection c WHERE c.id=s.connection_id AND c.connected_at=s.generation)",attempt.setup.channel_id,c.id,attempt.attempt_id,state.as_ref(),request.as_ref().map(ProviderId::as_str),error,attempt.generation).execute(&self.pool).await.map_err(failure)?;
        if changed.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        self.work_ready.receipts.notify_one();
        Ok(())
    }
    async fn group_participants(&self, channel: Uuid) -> PortResult<Vec<GroupParticipant>> {
        sqlx::query!("SELECT customer_id,external_sender_id,display_name,username,phone FROM meta_messaging_group_participant WHERE channel_id=$1 AND active ORDER BY customer_id LIMIT 100",channel).fetch_all(&self.pool).await.map_err(failure)?.into_iter().map(|r|Ok(GroupParticipant { customer_id:r.customer_id.try_into()?,external_sender_id:r.external_sender_id,display_name:r.display_name,username:r.username,phone:r.phone })).collect()
    }
    async fn group_link(&self, channel: Uuid) -> PortResult<GroupInviteLink> {
        let link=sqlx::query_scalar!("SELECT group_invite_link FROM meta_messaging_conversation WHERE channel_id=$1 AND kind='group' AND group_status<>'deleted'",channel).fetch_optional(&self.pool).await.map_err(failure)?.flatten().ok_or(MessagingError::NotFound)?;
        Ok(GroupInviteLink { invite_link: link })
    }
    async fn group_channel(&self, c: &Connection, group: &ProviderId) -> PortResult<Option<Uuid>> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        let channel=sqlx::query_scalar!("SELECT channel_id FROM meta_messaging_conversation WHERE connection_id=$1 AND kind='group' AND customer_id=$2",c.id,group.as_str()).fetch_optional(&mut *tx).await.map_err(failure)?;
        if channel.is_none() {
            Self::unknown_group_in(&mut tx, c.id, false).await?;
        }
        Ok(channel)
    }
    async fn confirm_group_deleted(&self, c: &Connection, channel: Uuid) -> PortResult<()> {
        let mut tx = self.pool.begin().await.map_err(failure)?;
        Self::lock_identity_in(&mut tx, c).await?;
        sqlx::query!("UPDATE meta_messaging_conversation SET group_status='deleted',group_status_at=now(),group_invite_link=NULL WHERE channel_id=$1 AND connection_id=$2 AND kind='group'",channel,c.id).execute(&mut *tx).await.map_err(failure)?;
        tx.commit().await.map_err(failure)
    }
}
