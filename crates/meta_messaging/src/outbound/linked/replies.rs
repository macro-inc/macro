//! Personal transport plugs into the existing human-intent/preparation/recovery service.
use super::{repository::PgLinkedRepository, sessions::HttpSessions};
use crate::domain::{
    connection::*,
    linked::{
        models::SessionScope,
        ports::{LinkedRepository, Sessions},
    },
    models::*,
    policy::ReplyMode,
    ports::*,
    replies::*,
};
use crate::outbound::repository::failure;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

/// Linked policy/transport shares the same native authorization and send lifecycle.
pub struct LinkedReplies {
    /// Personal persistence.
    pub repository: Arc<PgLinkedRepository>,
    /// Authenticated protocol RPC.
    pub sessions: Arc<HttpSessions>,
}
#[async_trait]
impl ReplyPolicy for LinkedReplies {
    async fn evaluate(
        &self,
        a: &AccountScope,
        c: &Conversation,
        now: DateTime<Utc>,
    ) -> PortResult<ReplyOptions> {
        let eligible = self.repository.eligible(a, c).await?;
        Ok(ReplyOptions {
            capabilities: ReplyCapabilities {
                modes: vec![ReplyMode::FreeForm],
                text_limit: 16_384,
                text_limit_in_bytes: true,
                media: media_capabilities(),
                max_attachments: 1,
            },
            eligibility: ReplyEligibility {
                evaluated_at: now,
                modes: vec![ModeEligibility {
                    mode: ReplyMode::FreeForm,
                    allowed: eligible,
                    reason: (!eligible).then_some(ReplyBlockReason::Forbidden),
                    expires_at: None,
                }],
            },
        })
    }
    async fn validate_content(&self, _: &AccountScope, r: &SendReply) -> PortResult<()> {
        if matches!(r.message, ReplyContent::Mutation { .. }) && r.reply_to.is_some() {
            return Err(
                MessagingError::Invalid("message changes cannot also quote a message").into(),
            );
        }
        if r.human_support || matches!(r.message, ReplyContent::Template { .. }) {
            return Err(
                MessagingError::Invalid("this action is unavailable for linked groups").into(),
            );
        }
        Ok(())
    }
}
/// Explicit product limits; these are not claims about WhatsApp's protocol maxima.
pub fn media_capabilities() -> Vec<crate::domain::media::MediaCapability> {
    use crate::domain::{events::MediaKind, media::MediaCapability};
    [
        (
            MediaKind::Image,
            vec!["image/jpeg", "image/png", "image/webp"],
        ),
        (
            MediaKind::Audio,
            vec!["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac"],
        ),
        (MediaKind::Video, vec!["video/mp4"]),
        (MediaKind::Document, vec!["application/pdf", "text/plain"]),
    ]
    .into_iter()
    .map(|(kind, mimes)| MediaCapability {
        kind,
        mime_types: mimes.into_iter().map(str::to_owned).collect(),
        max_bytes: 32 * 1024 * 1024,
        caption_limit: if kind == MediaKind::Audio {
            None
        } else {
            Some(4096)
        },
    })
    .collect()
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Command {
    schema_version: u16,
    command_id: Uuid,
    #[serde(flatten)]
    scope: SessionScope,
    group_jid: String,
    source_id: String,
    expires_at: DateTime<Utc>,
    digest: String,
    content: serde_json::Value,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResultState {
    command_id: Uuid,
    source_id: String,
    state: String,
}
struct Prepared {
    sessions: Arc<HttpSessions>,
    command: Command,
    text: String,
}
#[async_trait]
impl ReplyTransport for LinkedReplies {
    async fn prepare(
        &self,
        a: &AccountScope,
        c: &Conversation,
        r: &SendReply,
        media: Option<&OutboundMedia>,
    ) -> PortResult<Box<dyn PreparedSend>> {
        let personal = a.personal.as_ref().ok_or(MessagingError::Forbidden)?;
        let scope = SessionScope {
            account_id: a.id,
            authorization_generation: personal.authorization_generation,
            owner_epoch: personal.owner_epoch,
        };
        let row=sqlx::query!("SELECT id,allocated_source_id,created_at+interval '10 minutes' AS expires_at,authorization_generation,owner_epoch FROM meta_messaging_send WHERE channel_id=$1 AND linked_account_id=$2 AND user_id=$3 AND idempotency_key=$4",c.channel_id,a.id,personal.user_id,r.idempotency_key).fetch_one(&self.repository.pool).await.map_err(failure)?;
        if row.authorization_generation != Some(personal.authorization_generation)
            || row.owner_epoch != Some(personal.owner_epoch)
        {
            return Err(MessagingError::Conflict.into());
        }
        let (mut content, text) = match &r.message {
            ReplyContent::Text { text } => {
                (serde_json::json!({"kind":"text","text":text}), text.clone())
            }
            ReplyContent::Media { kind, caption, .. } => {
                let file = &media.ok_or(MessagingError::Unavailable)?.file;
                self.sessions
                    .upload(&scope, c.customer_id.as_str(), row.id, file.bytes.clone())
                    .await?;
                (
                    serde_json::json!({"kind":kind,"text":caption.clone().unwrap_or_default(),"mediaId":row.id,"mime":file.mime_type,"filename":file.filename,"voice":file.mime_type=="audio/ogg" && file.bytes.windows(8).take(256).any(|bytes|bytes==b"OpusHead")}),
                    caption.clone().unwrap_or_default(),
                )
            }
            ReplyContent::Mutation {
                message_id,
                operation,
                text,
            } => {
                let source=sqlx::query!("SELECT m.source_id,m.source_at,alias.jid FROM whatsapp_external_message m JOIN whatsapp_identity_alias alias ON alias.binding_id=m.binding_id AND alias.person_id=m.person_id WHERE m.binding_id=$1 AND m.message_id=$2 AND m.deleted_at IS NULL ORDER BY (alias.jid=$3) DESC,alias.jid LIMIT 1",c.connection_id,message_id,personal.identity_jid).fetch_optional(&self.repository.pool).await.map_err(failure)?.ok_or(MessagingError::NotFound)?;
                let kind = match operation {
                    LinkedMutation::Reaction => "reaction",
                    LinkedMutation::Edit => "edit",
                    LinkedMutation::Delete => "delete",
                };
                if !matches!(operation, LinkedMutation::Reaction)
                    && (source.jid != personal.identity_jid
                        || Utc::now() - source.source_at > chrono::Duration::minutes(10))
                {
                    return Err(MessagingError::Forbidden.into());
                }
                let text = text.clone().unwrap_or_default();
                if (matches!(operation, LinkedMutation::Reaction) && text.len() > 128)
                    || text.len() > 16384
                    || (matches!(operation, LinkedMutation::Edit) && text.trim().is_empty())
                {
                    return Err(MessagingError::Invalid("invalid message change").into());
                }
                (
                    serde_json::json!({"kind":kind,"text":text,"target":{"sourceId":source.source_id,"senderJid":source.jid}}),
                    text,
                )
            }
            ReplyContent::Template { .. } => {
                return Err(
                    MessagingError::Invalid("templates are unavailable for linked groups").into(),
                );
            }
        };
        if let Some(target) = &r.reply_to {
            let source=sqlx::query!("SELECT m.source_id,alias.jid FROM whatsapp_external_message m JOIN whatsapp_identity_alias alias ON alias.binding_id=m.binding_id AND alias.person_id=m.person_id WHERE m.binding_id=$1 AND m.message_id::text=$2 AND m.deleted_at IS NULL ORDER BY alias.jid LIMIT 1",c.connection_id,target.as_str()).fetch_optional(&self.repository.pool).await.map_err(failure)?;
            if let Some(source) = source {
                content["target"] =
                    serde_json::json!({"sourceId":source.source_id,"senderJid":source.jid});
            }
        }
        let digest = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&content).map_err(failure)?)
        );
        let mut command = Command {
            schema_version: 1,
            command_id: row.id,
            scope: scope.clone(),
            group_jid: c.customer_id.as_str().to_owned(),
            source_id: row.allocated_source_id.unwrap_or_default(),
            expires_at: row.expires_at.ok_or(MessagingError::Unavailable)?,
            digest,
            content,
        };
        let result: ResultState = self
            .sessions
            .json(
                &scope,
                reqwest::Method::POST,
                "commands/prepare",
                Some(&command),
            )
            .await?;
        if result.command_id != row.id || result.source_id.is_empty() {
            return Err(MessagingError::Conflict.into());
        }
        command.source_id = result.source_id;
        // Retain the upstream-generated ID before the shared dispatch fence.
        let saved=sqlx::query!("UPDATE meta_messaging_send SET allocated_source_id=$2 WHERE id=$1 AND (allocated_source_id IS NULL OR allocated_source_id=$2) AND dispatch_started_at IS NULL",row.id,command.source_id).execute(&self.repository.pool).await.map_err(failure)?;
        if saved.rows_affected() != 1 {
            return Err(MessagingError::Conflict.into());
        }
        let account = self
            .repository
            .linked_account(a.id)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let group = self.sessions.group(&scope, c.customer_id.as_str()).await?;
        self.repository.reconcile_group(&account, &group).await?;
        Ok(Box::new(Prepared {
            sessions: self.sessions.clone(),
            command,
            text,
        }))
    }
}
#[async_trait]
impl PreparedSend for Prepared {
    fn rendered_text(&self) -> &str {
        &self.text
    }
    async fn dispatch(self: Box<Self>) -> PortResult<ProviderSendResult> {
        let result: Result<ResultState, _> = self
            .sessions
            .json(
                &self.command.scope,
                reqwest::Method::POST,
                "commands/dispatch",
                Some(&self.command),
            )
            .await;
        Ok(match result {
            Ok(result)
                if result.command_id == self.command.command_id
                    && result.source_id == self.command.source_id
                    && result.state == "accepted" =>
            {
                ProviderSendResult::Accepted(result.source_id.try_into()?)
            }
            _ => ProviderSendResult::Unknown,
        })
    }
}
