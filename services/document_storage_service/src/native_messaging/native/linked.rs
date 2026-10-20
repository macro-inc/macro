//! Compose personal group bindings with existing native channel/message/file owners.
use super::*;
use entity_access::domain::models::AdminParticipantRole;
use messages::outbound::pg_message_repo::ExternalReaction;
use meta_messaging::{
    domain::linked::{models::*, ports::*},
    outbound::linked::repository::{PgLinkedRepository, native::Reservation},
};

pub(crate) struct LinkedComposition {
    pub repository: Arc<PgLinkedRepository>,
    pub files: Arc<dyn super::super::files::linked::LinkedFiles>,
}
impl NativeChannels {
    pub(crate) fn with_linked(mut self, linked: LinkedComposition) -> Self {
        self.linked = Some(linked);
        self
    }
    pub(super) fn linked(&self) -> PortResult<&LinkedComposition> {
        self.linked
            .as_ref()
            .ok_or_else(|| MessagingError::ConfigurationRequired.into())
    }
    async fn linked_owner(&self, b: &Binding) -> PortResult<MacroUserIdStr<'static>> {
        let owner =
            MacroUserIdStr::try_from(b.user_id.clone()).map_err(|_| MessagingError::Forbidden)?;
        if self
            .require_send(b.team_id, b.channel_id, owner.as_ref())
            .await
            .is_err()
        {
            sqlx::query!(
                "UPDATE whatsapp_group_binding SET ownership_state='transfer_required' WHERE id=$1 AND user_id=$2",
                b.id,b.user_id
            )
            .execute(&self.pool)
            .await
            .map_err(error)?;
            return Err(MessagingError::Forbidden.into());
        }
        Ok(owner)
    }
}
#[async_trait]
impl LinkedNative for NativeChannels {
    async fn authorize_adoption(
        &self,
        user: &str,
        request: &AdoptGroup,
        group: &GroupInfo,
    ) -> PortResult<()> {
        self.require_member(request.team_id, user).await?;
        let mut audience = request.users.clone();
        audience.push(user.to_owned());
        audience.sort();
        audience.dedup();
        for member in audience {
            self.require_member(request.team_id, &member).await?;
            let account = self
                .linked()?
                .repository
                .owned_account(&member)
                .await?
                .ok_or(MessagingError::Forbidden)?;
            if account
                .identity_jid
                .as_deref()
                .and_then(|id| group.participant(id))
                .is_none()
            {
                return Err(MessagingError::Forbidden.into());
            }
        }
        Ok(())
    }
    async fn adopt(
        &self,
        user: &str,
        a: &Account,
        request: &AdoptGroup,
        g: &GroupInfo,
    ) -> PortResult<Binding> {
        let mut tx = self.pool.begin().await.map_err(error)?;
        let lock = format!("{}:{}", request.team_id, request.group_jid);
        sqlx::query!(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,7982))",
            lock
        )
        .execute(&mut *tx)
        .await
        .map_err(error)?;
        let current=sqlx::query_scalar!("SELECT a.id FROM whatsapp_linked_account a JOIN team_user tu ON tu.user_id=a.user_id AND tu.team_id=$4 WHERE a.id=$1 AND a.user_id=$2 AND a.authorization_generation=$3 AND a.state='connected' FOR SHARE OF a,tu",a.id,user,a.authorization_generation,request.team_id).fetch_optional(&mut *tx).await.map_err(error)?;
        if current.is_none() {
            return Err(MessagingError::Forbidden.into());
        }
        let existing=sqlx::query!(r#"SELECT to_jsonb(b) AS "data!" FROM whatsapp_group_binding b WHERE team_id=$1 AND group_jid=$2 AND state<>'detached' FOR UPDATE"#,request.team_id,request.group_jid).fetch_optional(&mut *tx).await.map_err(error)?;
        let (binding, created) = if let Some(existing) = existing {
            let b: Binding = serde_json::from_value(existing.data).map_err(error)?;
            let permitted = sqlx::query_scalar!(
                r#"SELECT whatsapp_linked_can_view($1,$2) AS "allowed!""#,
                b.channel_id,
                user
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(error)?;
            if !permitted {
                return Err(MessagingError::Forbidden.into());
            }
            (b, false)
        } else {
            let owner =
                MacroUserIdStr::try_from(user.to_owned()).map_err(|_| MessagingError::Forbidden)?;
            let participants = request
                .users
                .iter()
                .map(|id| {
                    MacroUserIdStr::try_from(id.clone()).map_err(|_| MessagingError::Forbidden)
                })
                .collect::<Result<HashSet<_>, _>>()?;
            let channel = Uuid::now_v7();
            PgChannelsRepo::ensure_reserved_channel_in(
                &mut tx,
                &HistoricalChannel {
                    id: channel,
                    name: g.name.chars().take(100).collect(),
                    kind: HistoricalChannelKind::Private,
                    owner,
                    participants,
                    created_at: Utc::now(),
                },
                true,
            )
            .await
            .map_err(error)?;
            PgChannelsRepo::bind_messaging_in(
                &mut tx,
                channel,
                channels::domain::models::MessagingBinding::WhatsappLinkedGroup,
            )
            .await
            .map_err(error)?;
            let row=sqlx::query!(r#"INSERT INTO whatsapp_group_binding(id,team_id,group_jid,channel_id,user_id,state) VALUES($1,$2,$3,$4,$5,'active') RETURNING to_jsonb(whatsapp_group_binding) AS "data!""#,Uuid::now_v7(),request.team_id,request.group_jid,channel,user).fetch_one(&mut *tx).await.map_err(error)?;
            (serde_json::from_value(row.data).map_err(error)?, true)
        };
        // Existing hidden channels are never implicitly granted to an adopter.
        let mut audience = if created {
            request.users.clone()
        } else {
            vec![]
        };
        audience.push(user.to_owned());
        audience.sort();
        audience.dedup();
        for member in audience {
            let identity=sqlx::query_scalar!("SELECT a.identity_jid FROM whatsapp_linked_account a JOIN team_user tu ON tu.user_id=a.user_id AND tu.team_id=$2 WHERE a.user_id=$1 AND a.state IN ('connected','offline') ORDER BY a.updated_at DESC LIMIT 1 FOR SHARE OF a,tu",member,request.team_id).fetch_optional(&mut *tx).await.map_err(error)?.flatten().ok_or(MessagingError::Forbidden)?;
            if g.participant(&identity).is_none() {
                return Err(MessagingError::Forbidden.into());
            }
            sqlx::query!("INSERT INTO whatsapp_group_audience(binding_id,user_id,identity_jid,history_granted_at,remote_member,reconciled,membership_version,observed_at) VALUES($1,$2,$3,now(),true,true,$4,$5) ON CONFLICT(binding_id,user_id) DO UPDATE SET identity_jid=excluded.identity_jid,remote_member=true,reconciled=true,membership_version=excluded.membership_version,observed_at=excluded.observed_at,revoked_at=NULL",binding.id,member,identity,g.version,g.observed_at).execute(&mut *tx).await.map_err(error)?;
        }
        let own = g
            .participant(a.identity_jid.as_deref().ok_or(MessagingError::Forbidden)?)
            .ok_or(MessagingError::Forbidden)?;
        sqlx::query!("INSERT INTO whatsapp_group_membership(binding_id,account_id,authorization_generation,consent_at,remote_member,can_post,observed_at,metadata_version,reconciled) VALUES($1,$2,$3,clock_timestamp(),true,$4,$5,$6,true) ON CONFLICT(binding_id,account_id) DO UPDATE SET authorization_generation=excluded.authorization_generation,consent_at=CASE WHEN whatsapp_group_membership.authorization_generation=excluded.authorization_generation AND whatsapp_group_membership.consent_ended_at IS NULL THEN whatsapp_group_membership.consent_at ELSE excluded.consent_at END,consent_ended_at=NULL,remote_member=true,can_post=excluded.can_post,observed_at=excluded.observed_at,metadata_version=excluded.metadata_version,reconciled=true",binding.id,a.id,a.authorization_generation,!g.announce||own.admin,g.observed_at,g.version).execute(&mut *tx).await.map_err(error)?;
        tx.commit().await.map_err(error)?;
        if created {
            let owner =
                MacroUserIdStr::try_from(user.to_owned()).map_err(|_| MessagingError::Forbidden)?;
            self.channel_events
                .dispatch(channels::domain::events::ChannelEvent::ChannelCreated {
                    channel_id: binding.channel_id,
                    actor: ChannelSender::new_from_user(owner.clone()),
                    on_behalf_of: None,
                    channel_type: channels::domain::models::ChannelType::Private,
                    channel_name: Some(g.name.clone()),
                    participant_user_ids: vec![owner],
                });
        }
        Ok(binding)
    }
    async fn ingest_linked(&self, a: &Account, event: &Event) -> PortResult<()> {
        let linked = self.linked()?;
        for binding in linked.repository.observed_bindings(a, event).await? {
            self.linked_owner(&binding).await?;
            let mut tx = self.pool.begin().await.map_err(error)?;
            let Some(reservation) =
                PgLinkedRepository::reserve_in(&mut tx, a, &binding, event, None).await?
            else {
                let quarantined=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_inbound_event WHERE account_id=$1 AND event_id=$2 AND state='quarantined') AS "quarantined!""#,a.id,event.event_id).fetch_one(&mut *tx).await.map_err(error)?;
                tx.commit().await.map_err(error)?;
                if quarantined {
                    return Err(MessagingError::IdentityConflict.into());
                }
                continue;
            };
            let changed = self.persist_linked(&mut tx, event, &reservation).await?;
            PgLinkedRepository::finish_in(&mut tx, &reservation, changed).await?;
            tx.commit().await.map_err(error)?;
            if reservation.deleted_at.is_none()
                && reservation.actor.is_none()
                && let Err(failure) = linked.files.receive(a, event, &reservation).await
            {
                let text = event
                    .message
                    .as_ref()
                    .map(|m| m.text.as_str())
                    .unwrap_or("");
                let notice = if text.is_empty() {
                    "Attachment is temporarily unavailable. Retrying…".to_owned()
                } else {
                    format!(
                        "{}\n\nAttachment is temporarily unavailable. Retrying…",
                        plain_markdown(text)
                    )
                };
                let mut tx = self.pool.begin().await.map_err(error)?;
                PgMessageRepository::external_media_notice_in(
                    &mut tx,
                    reservation.binding.channel_id,
                    reservation.message,
                    reservation.binding.id,
                    &reservation.source,
                    &notice,
                )
                .await
                .map_err(error)?;
                tx.commit().await.map_err(error)?;
                return Err(failure);
            }
        }
        Ok(())
    }
    async fn grant_access(
        &self,
        user: &str,
        binding: &Binding,
        users: &[String],
        group: &GroupInfo,
    ) -> PortResult<()> {
        self.access
            .generate_entity_access_receipt::<AdminParticipantRole>(
                &MacroUserIdStr::try_from(user)
                    .map_err(|_| MessagingError::Forbidden)?
                    .0,
                None,
                &binding.channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        self.authorize_adoption(
            user,
            &AdoptGroup {
                team_id: binding.team_id,
                group_jid: binding.group_jid.clone(),
                users: users.to_vec(),
            },
            group,
        )
        .await?;
        let mut tx = self.pool.begin().await.map_err(error)?;
        sqlx::query!(
            "SELECT id FROM whatsapp_group_binding WHERE id=$1 FOR UPDATE",
            binding.id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(error)?;
        let participants = users
            .iter()
            .map(|id| MacroUserIdStr::try_from(id.clone()).map_err(|_| MessagingError::Forbidden))
            .collect::<Result<Vec<_>, _>>()?;
        channels::outbound::pg_channels_repo::historical::insert_members(
            &mut tx,
            binding.channel_id,
            &participants,
            Utc::now(),
        )
        .await
        .map_err(error)?;
        for member in users {
            let account = self
                .linked()?
                .repository
                .owned_account(member)
                .await?
                .ok_or(MessagingError::Forbidden)?;
            let identity = account.identity_jid.ok_or(MessagingError::Forbidden)?;
            sqlx::query!("INSERT INTO whatsapp_group_audience(binding_id,user_id,identity_jid,history_granted_at,remote_member,reconciled,membership_version,observed_at) VALUES($1,$2,$3,now(),true,true,$4,$5) ON CONFLICT(binding_id,user_id) DO UPDATE SET identity_jid=excluded.identity_jid,history_granted_at=excluded.history_granted_at,remote_member=true,reconciled=true,membership_version=excluded.membership_version,observed_at=excluded.observed_at,revoked_at=NULL",binding.id,member,identity,group.version,group.observed_at).execute(&mut *tx).await.map_err(error)?;
        }
        tx.commit().await.map_err(error)
    }
    async fn transfer_owner(
        &self,
        user: &str,
        binding: &Binding,
        new_owner: &str,
        group: &GroupInfo,
    ) -> PortResult<()> {
        self.access
            .generate_entity_access_receipt::<AdminParticipantRole>(
                &MacroUserIdStr::try_from(user)
                    .map_err(|_| MessagingError::Forbidden)?
                    .0,
                None,
                &binding.channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        self.authorize_adoption(
            user,
            &AdoptGroup {
                team_id: binding.team_id,
                group_jid: binding.group_jid.clone(),
                users: vec![new_owner.to_owned()],
            },
            group,
        )
        .await?;
        self.require_send(binding.team_id, binding.channel_id, new_owner)
            .await?;
        let mut tx = self.pool.begin().await.map_err(error)?;
        PgChannelsRepo::transfer_linked_owner_in(&mut tx, binding.channel_id, new_owner)
            .await
            .map_err(error)?;
        sqlx::query!(
            "UPDATE whatsapp_group_binding SET user_id=$2,ownership_state='active' WHERE id=$1",
            binding.id,
            new_owner
        )
        .execute(&mut *tx)
        .await
        .map_err(error)?;
        tx.commit().await.map_err(error)
    }
    async fn detach(&self, user: &str, b: &Binding) -> PortResult<()> {
        self.access
            .generate_entity_access_receipt::<AdminParticipantRole>(
                &MacroUserIdStr::try_from(user)
                    .map_err(|_| MessagingError::Forbidden)?
                    .0,
                None,
                &b.channel_id.to_string(),
                EntityType::Channel,
            )
            .await
            .map_err(access_error)?;
        let mut tx = self.pool.begin().await.map_err(error)?;
        sqlx::query!(
            "UPDATE whatsapp_group_binding SET state='detached' WHERE id=$1",
            b.id
        )
        .execute(&mut *tx)
        .await
        .map_err(error)?;
        sqlx::query!("UPDATE whatsapp_group_membership SET consent_ended_at=COALESCE(consent_ended_at,now()) WHERE binding_id=$1",b.id).execute(&mut *tx).await.map_err(error)?;
        sqlx::query!("UPDATE meta_messaging_send SET state='failed',error_code='group_detached',lease_id=NULL,lease_until=NULL WHERE linked_binding_id=$1 AND dispatch_started_at IS NULL AND state IN ('pending','sending')",b.id).execute(&mut *tx).await.map_err(error)?;
        tx.commit().await.map_err(error)
    }
}
impl NativeChannels {
    async fn persist_linked(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        event: &Event,
        r: &Reservation,
    ) -> PortResult<bool> {
        let source = event
            .message
            .as_ref()
            .ok_or(MessagingError::Invalid("missing message"))?;
        if let Some(actor) = r.reaction_actor {
            let sender = ChannelSender::new_external(actor)
                .ok_or(MessagingError::Invalid("invalid reaction actor"))?;
            return PgMessageRepository::external_reaction_in(
                tx,
                ExternalReaction {
                    message: r.message,
                    sender: &sender,
                    name: source.sender.display_name.as_deref(),
                    emoji: &source.text,
                    user: r.associated_user.as_deref(),
                    source: &source.source_id,
                    revision: source.revision,
                    at: event.source_at,
                },
            )
            .await
            .map_err(error);
        }
        let text = r.revision_content.as_deref().unwrap_or(&source.text);
        let mut content = plain_markdown(if text.is_empty() && !source.media.is_empty() {
            "Loading attachment…"
        } else {
            text
        });
        if r.create
            && source.kind == "text"
            && let Some(target) = &source.target
        {
            let original=sqlx::query!("SELECT m.message_id FROM whatsapp_external_message m JOIN whatsapp_identity_alias a ON a.binding_id=m.binding_id AND a.person_id=m.person_id WHERE m.binding_id=$1 AND m.source_id=$2 AND a.jid=$3 AND m.deleted_at IS NULL",r.binding.id,target.source_id,target.sender_jid).fetch_optional(&mut **tx).await.map_err(error)?;
            let original = if let Some(id) = original.and_then(|row| row.message_id) {
                PgMessageRepository::external_quote_in(tx, r.binding.channel_id, id)
                    .await
                    .map_err(error)?
            } else {
                None
            };
            let quote = original.unwrap_or_else(|| "Original message unavailable".to_owned());
            content = format!(
                "> {}\n\n{}",
                plain_markdown(&quote).replace('\n', "\n> "),
                content
            );
        }
        if r.create {
            let sender = if let Some(actor) = &r.actor {
                ChannelSender::new_from_user(
                    MacroUserIdStr::try_from(actor.clone())
                        .map_err(|_| MessagingError::Forbidden)?,
                )
            } else {
                ChannelSender::new_external(r.person)
                    .ok_or(MessagingError::Invalid("invalid participant"))?
            };
            PgMessageRepository::insert_historical_in(tx,&HistoricalBatch{channel_id:r.binding.channel_id,messages:vec![HistoricalMessage{id:r.message,thread_id:None,sender,imported_author:if r.actor.is_some(){None}else{Some(source.sender.display_name.clone().unwrap_or_else(||"WhatsApp participant".to_owned()))},content:content.clone(),created_at:event.source_at,updated_at:event.source_at,edited_at:None,import_metadata:serde_json::json!({"source":"whatsapp_linked","connection_id":r.binding.id,"provider_message_id":r.source,"provenance":if r.actor.is_some(){"macro_reply"}else{"phone_echo"},"direction":"outbound","origin":if r.actor.is_some(){"macro"}else{"whatsapp"},"verified_macro_user":r.associated_user,"quote":source.target}),import_order:0,reactions:vec![],mentions:vec![]}]}).await.map_err(error)?;
            advance_historical_activity(tx, r.binding.channel_id, event.source_at)
                .await
                .map_err(error)?;
        }
        let revised = if r.deleted_at.is_some() || r.revision > 0 {
            PgMessageRepository::revise_external_in(
                tx,
                ExternalMessageRevision {
                    channel: r.binding.channel_id,
                    message: r.message,
                    connection: r.binding.id,
                    provider_message: &r.source,
                    content: r.revision_content.as_ref().map(|_| content.as_str()),
                    number: r.revision,
                    edited_at: r.revised_at,
                    deleted_at: r.deleted_at,
                },
            )
            .await
            .map_err(error)?
        } else {
            false
        };
        if r.deleted_at.is_some() {
            let documents=sqlx::query_scalar!("UPDATE whatsapp_attachment SET state='deleted',lease_id=NULL,lease_until=NULL WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 RETURNING document_id",r.binding.id,r.person,r.source).fetch_all(&mut **tx).await.map_err(error)?;
            for document in documents {
                entity_access_db_utils::delete_channel_document_grant(
                    &mut **tx,
                    r.binding.channel_id,
                    document,
                )
                .await
                .map_err(error)?;
            }
        }
        let attributed = if let Some(actor) = &r.actor {
            let sender = ChannelSender::new_from_user(
                MacroUserIdStr::try_from(actor.clone()).map_err(|_| MessagingError::Forbidden)?,
            );
            PgMessageRepository::attribute_accepted_reply_in(
                tx,
                ExternalReplyAttribution {
                    channel: r.binding.channel_id,
                    message: r.message,
                    connection: r.binding.id,
                    provider_message: &r.source,
                    sender: &sender,
                    content: &content,
                },
            )
            .await
            .map_err(error)?
        } else {
            false
        };
        Ok(r.create || revised || attributed)
    }
}

impl NativeChannels {
    pub(super) async fn sent_linked(
        &self,
        work: &SendWork,
        c: &Conversation,
        scope: &meta_messaging::domain::replies::AccountScope,
        id: &ProviderId,
    ) -> PortResult<()> {
        let linked = self.linked()?;
        let binding = linked
            .repository
            .binding(work.channel_id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        self.linked_owner(&binding).await?;
        let account = linked
            .repository
            .linked_account(scope.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let personal = scope.personal.as_ref().ok_or(MessagingError::Forbidden)?;
        let text = work.rendered_text.clone().unwrap_or_default();
        let (kind, target, revision) = if let ReplyContent::Mutation {
            message_id,
            operation,
            ..
        } = &work.request.message
        {
            let source=sqlx::query!("SELECT m.source_id,a.jid FROM whatsapp_external_message m JOIN whatsapp_identity_alias a ON a.binding_id=m.binding_id AND a.person_id=m.person_id WHERE m.binding_id=$1 AND m.message_id=$2 ORDER BY (a.jid=$3) DESC,a.jid LIMIT 1",binding.id,message_id,personal.identity_jid).fetch_one(&self.pool).await.map_err(error)?;
            (
                match operation {
                    LinkedMutation::Reaction => "reaction",
                    LinkedMutation::Edit => "edit",
                    LinkedMutation::Delete => "delete",
                },
                Some(Target {
                    source_id: source.source_id,
                    sender_jid: source.jid,
                }),
                work.created_at.timestamp_millis(),
            )
        } else {
            let target = if let Some(id) = &work.request.reply_to {
                sqlx::query!("SELECT m.source_id,a.jid FROM whatsapp_external_message m JOIN whatsapp_identity_alias a ON a.binding_id=m.binding_id AND a.person_id=m.person_id WHERE m.binding_id=$1 AND m.message_id::text=$2 AND m.deleted_at IS NULL ORDER BY a.jid LIMIT 1",binding.id,id.as_str()).fetch_optional(&self.pool).await.map_err(error)?.map(|r|Target{source_id:r.source_id,sender_jid:r.jid})
            } else {
                None
            };
            ("text", target, 0)
        };

        let event = Event {
            schema_version: 1,
            event_id: work.lease.id,
            scope: SessionScope {
                account_id: account.id,
                authorization_generation: personal.authorization_generation,
                owner_epoch: personal.owner_epoch,
            },
            group_jid: Some(c.customer_id.as_str().to_owned()),
            source_at: work.created_at,
            observed_at: Utc::now(),
            kind: "message".into(),
            message: Some(meta_messaging::domain::linked::models::Message {
                source_id: id.as_str().to_owned(),
                sender: Identity {
                    jid: personal.identity_jid.clone(),
                    alternate_jid: None,
                    display_name: None,
                },
                text,
                kind: kind.into(),
                history: false,
                revision,
                target,
                media: vec![],
            }),
            group: None,
            receipt: None,
        };
        let mut tx = self.pool.begin().await.map_err(error)?;
        let Some(reservation) = PgLinkedRepository::reserve_in(
            &mut tx,
            &account,
            &binding,
            &event,
            Some(work.lease.id),
        )
        .await?
        else {
            return Err(MessagingError::Conflict.into());
        };
        let changed = self.persist_linked(&mut tx, &event, &reservation).await?;
        PgLinkedRepository::finish_in(&mut tx, &reservation, changed).await?;
        tx.commit().await.map_err(error)?;
        if let ReplyContent::Media { document_id, .. } = &work.request.message {
            linked
                .files
                .attach_sent(work, &binding, id, reservation.message, *document_id)
                .await?;
        }
        sqlx::query!("UPDATE meta_messaging_send SET message_id=$2,native_retry_at='infinity' WHERE id=$1 AND linked_binding_id=$3 AND provider_message_id=$4",work.lease.id,reservation.message,binding.id,id.as_str()).execute(&self.pool).await.map_err(error)?;
        Ok(())
    }
}
