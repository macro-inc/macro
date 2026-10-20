//! Canonical linked-group media reuses the native private-file upload and viewers.
use super::*;
use meta_messaging::{
    domain::linked::models::{Account, Event},
    outbound::linked::{repository::native::Reservation, sessions::HttpSessions},
};

/// Linked file composition shares the native document adapter without coupling
/// text/canonical persistence to a live protocol endpoint.
#[async_trait]
pub(crate) trait LinkedFiles: Send + Sync {
    async fn receive(&self, account: &Account, event: &Event, r: &Reservation) -> PortResult<()>;
    async fn attach_sent(
        &self,
        work: &SendWork,
        binding: &meta_messaging::domain::linked::models::Binding,
        source: &ProviderId,
        message: Uuid,
        document: Uuid,
    ) -> PortResult<()>;
}
pub(crate) struct LinkedNativeFiles {
    pub files: Arc<NativeFiles>,
    pub sessions: Arc<HttpSessions>,
}
#[async_trait]
impl LinkedFiles for LinkedNativeFiles {
    async fn receive(&self, account: &Account, event: &Event, r: &Reservation) -> PortResult<()> {
        self.files
            .receive_linked(&self.sessions, account, event, r)
            .await
    }
    async fn attach_sent(
        &self,
        work: &SendWork,
        binding: &meta_messaging::domain::linked::models::Binding,
        source: &ProviderId,
        message: Uuid,
        document: Uuid,
    ) -> PortResult<()> {
        self.files
            .attach_linked_sent(work, binding, source, message, document)
            .await
    }
}

impl NativeFiles {
    pub(crate) async fn receive_linked(
        &self,
        sessions: &HttpSessions,
        account: &Account,
        event: &Event,
        r: &Reservation,
    ) -> PortResult<()> {
        let Some(message) = &event.message else {
            return Ok(());
        };
        let owner = MacroUserIdStr::try_from(r.binding.user_id.clone())
            .map_err(|_| MessagingError::Forbidden)?;
        for (ordinal, media) in message.media.iter().enumerate() {
            if ordinal >= 10 {
                return Err(MessagingError::Invalid("too many attachments").into());
            }
            let ready=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_attachment WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 AND ordinal=$4 AND state IN ('ready','deleted')) AS "ready!""#,r.binding.id,r.person,r.source,ordinal as i16).fetch_one(&self.pool).await.map_err(error)?;
            if ready {
                continue;
            }
            let bytes = sessions
                .download(&account.scope()?, &r.binding.group_jid, &media.id)
                .await?;
            let digest = Sha256::digest(&bytes);
            let sha = format!("{digest:x}");
            if sha != media.sha256 || bytes.len() as u64 != media.size {
                return Err(MessagingError::Invalid("attachment integrity check failed").into());
            }
            let file = MediaBytes {
                filename: media.filename.clone(),
                mime_type: media.mime.clone(),
                bytes,
            };
            let kind = received_type(&file)?;
            let id = Uuid::now_v7();
            let lease = Uuid::now_v7();
            let ordinal = ordinal as i16;
            let mut tx = self.pool.begin().await.map_err(error)?;
            let scope_valid=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_group_binding b JOIN whatsapp_linked_account a ON a.id=$3 JOIN whatsapp_group_membership m ON m.binding_id=b.id AND m.account_id=a.id WHERE b.id=$1 AND b.user_id=$2 AND b.ownership_state='active' AND b.state='active' AND a.authorization_generation=$4 AND a.state IN ('connected','offline') AND m.authorization_generation=$4 AND m.consent_ended_at IS NULL AND whatsapp_linked_can_view(b.channel_id,a.user_id) AND whatsapp_linked_can_view(b.channel_id,b.user_id)) AS "valid!""#,r.binding.id,r.binding.user_id,account.id,account.authorization_generation).fetch_one(&mut *tx).await.map_err(error)?;
            if !scope_valid {
                return Err(MessagingError::Forbidden.into());
            }
            let alive=sqlx::query_scalar!(r#"SELECT deleted_at IS NULL AS "alive!" FROM whatsapp_external_message WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 FOR UPDATE"#,r.binding.id,r.person,r.source).fetch_one(&mut *tx).await.map_err(error)?;
            if !alive {
                tx.commit().await.map_err(error)?;
                return Ok(());
            }
            sqlx::query!("INSERT INTO whatsapp_attachment(binding_id,person_id,source_id,ordinal,document_id,sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(binding_id,person_id,source_id,ordinal) DO NOTHING",r.binding.id,r.person,r.source,ordinal,id,&digest[..]).execute(&mut *tx).await.map_err(error)?;
            let reserved=sqlx::query!("UPDATE whatsapp_attachment SET lease_id=$5,lease_until=now()+interval '2 minutes' WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 AND ordinal=$4 AND state IN ('pending','failed') AND (lease_until IS NULL OR lease_until<=now()) AND sha256=$6 RETURNING document_id",r.binding.id,r.person,r.source,ordinal,lease,&digest[..]).fetch_optional(&mut *tx).await.map_err(error)?;
            tx.commit().await.map_err(error)?;
            let Some(reserved) = reserved else {
                let done=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_attachment WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 AND ordinal=$4 AND state IN ('ready','deleted')) AS "done!""#,r.binding.id,r.person,r.source,ordinal).fetch_one(&self.pool).await.map_err(error)?;
                if done {
                    continue;
                }
                // Retain the durable source event until a live lease finishes or
                // expires; acknowledging here would strand a crashed upload.
                return Err(MessagingError::Unavailable.into());
            };
            let source = self
                .access
                .generate_entity_access_receipt::<MemberParticipantRole>(
                    &owner.0,
                    None,
                    &r.binding.channel_id.to_string(),
                    EntityType::Channel,
                )
                .await
                .map_err(access_error)?;
            self.store_private_file(
                source,
                NewDocument {
                    id: Some(reserved.document_id),
                    sha,
                    document_name: document_name(&file.filename),
                    file_type: Some(kind),
                    project_id: None,
                    team_id: None,
                    share_with_team: false,
                    created_at: Some(event.source_at),
                    sub_type: None,
                    skip_history: true,
                    initial_link_share: InitialLinkShare::Exact(LinkShareState::Off),
                },
                file,
                base64::engine::general_purpose::STANDARD.encode(digest),
            )
            .await?;
            let current=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM whatsapp_group_binding b WHERE b.id=$1 AND b.user_id=$2 AND b.ownership_state='active' AND b.state='active' AND whatsapp_linked_can_view(b.channel_id,$2)) AS "valid!""#,r.binding.id,r.binding.user_id).fetch_one(&self.pool).await.map_err(error)?;
            if !current {
                return Err(MessagingError::Forbidden.into());
            }
            self.share(owner.clone(), r.binding.channel_id, reserved.document_id)
                .await?;
            let mut tx = self.pool.begin().await.map_err(error)?;
            let alive=sqlx::query_scalar!(r#"SELECT deleted_at IS NULL AS "alive!" FROM whatsapp_external_message WHERE binding_id=$1 AND person_id=$2 AND source_id=$3 FOR UPDATE"#,r.binding.id,r.person,r.source).fetch_one(&mut *tx).await.map_err(error)?;
            let current=sqlx::query_scalar!(r#"SELECT user_id=$2 AND ownership_state='active' AND state='active' AND whatsapp_linked_can_view(channel_id,$2) AS "valid!" FROM whatsapp_group_binding WHERE id=$1 FOR SHARE"#,r.binding.id,r.binding.user_id).fetch_one(&mut *tx).await.map_err(error)?;
            if !alive || !current {
                entity_access_db_utils::delete_channel_document_grant(
                    &mut *tx,
                    r.binding.channel_id,
                    reserved.document_id,
                )
                .await
                .map_err(error)?;
                sqlx::query!("UPDATE whatsapp_attachment SET state='deleted',lease_id=NULL,lease_until=NULL WHERE document_id=$1",reserved.document_id).execute(&mut *tx).await.map_err(error)?;
                tx.commit().await.map_err(error)?;
                continue;
            }
            let finished=sqlx::query!("UPDATE whatsapp_attachment SET state='ready',lease_id=NULL,lease_until=NULL WHERE document_id=$1 AND lease_id=$2 AND lease_until>now() RETURNING document_id",reserved.document_id,lease).fetch_optional(&mut *tx).await.map_err(error)?;
            if finished.is_none() {
                return Err(MessagingError::Conflict.into());
            }
            PgMessageRepository::attach_external_file_in(
                &mut tx,
                r.binding.channel_id,
                r.message,
                r.binding.id,
                &r.source,
                reserved.document_id,
            )
            .await
            .map_err(error)?;
            PgMessageRepository::external_media_notice_in(
                &mut tx,
                r.binding.channel_id,
                r.message,
                r.binding.id,
                &r.source,
                &plain_markdown(&message.text),
            )
            .await
            .map_err(error)?;
            sqlx::query!("UPDATE whatsapp_external_message SET effect_revision=effect_revision+1,native_retry_at=now() WHERE message_id=$1",r.message).execute(&mut *tx).await.map_err(error)?;
            tx.commit().await.map_err(error)?;
        }
        Ok(())
    }
}

impl NativeFiles {
    pub(crate) async fn attach_linked_sent(
        &self,
        work: &SendWork,
        binding: &meta_messaging::domain::linked::models::Binding,
        source: &ProviderId,
        message: Uuid,
        document: Uuid,
    ) -> PortResult<()> {
        // Accepted recovery may complete only the native file effect; it never
        // uploads to WhatsApp or obtains fresh external sending authority.
        self.read(&work.user_id, binding.channel_id, document)
            .await?;
        let user = MacroUserIdStr::try_from(work.user_id.clone())
            .map_err(|_| MessagingError::Forbidden)?;
        self.share(user, binding.channel_id, document).await?;
        let mut tx = self.pool.begin().await.map_err(error)?;
        PgMessageRepository::attach_external_file_in(
            &mut tx,
            binding.channel_id,
            message,
            binding.id,
            source.as_str(),
            document,
        )
        .await
        .map_err(error)?;
        sqlx::query!("UPDATE whatsapp_external_message SET effect_revision=effect_revision+1,native_retry_at=now() WHERE message_id=$1",message).execute(&mut *tx).await.map_err(error)?;
        tx.commit().await.map_err(error)
    }
}
