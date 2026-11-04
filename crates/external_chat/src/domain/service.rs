//! Adding, detaching and deliberate sends of external chats, as served by DSS.

use super::{models::*, ports::*, timeline::*};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, RequiredPermission};
use macro_user_id::user_id::MacroUserIdStr;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;
mod timeline;

/// DSS use cases for external chats of one provider.
pub struct ExternalChatService<P> {
    provider: Arc<P>,
    chats: Arc<dyn ChatRepository>,
    timeline: Arc<dyn TimelineRepository>,
    send_rate_limiter: Arc<dyn SendRateLimiter>,
}

impl<P> Clone for ExternalChatService<P> {
    fn clone(&self) -> Self {
        Self {
            provider: self.provider.clone(),
            chats: self.chats.clone(),
            timeline: self.timeline.clone(),
            send_rate_limiter: self.send_rate_limiter.clone(),
        }
    }
}

impl<P: ChatProvider> ExternalChatService<P> {
    /// Wire adapters at the composition root.
    pub fn new<R>(
        provider: Arc<P>,
        repository: Arc<R>,
        send_rate_limiter: Arc<dyn SendRateLimiter>,
    ) -> Self
    where
        R: ChatRepository + TimelineRepository + 'static,
    {
        Self {
            provider,
            chats: repository.clone(),
            timeline: repository,
            send_rate_limiter,
        }
    }

    /// Add an existing chat of the person's provider account, such as a
    /// WhatsApp group they joined, as their own external chat; never creates
    /// or joins anything at the provider. Adding the same chat twice returns
    /// the existing one.
    pub async fn add(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &AddChat,
        authority: SendAuthority,
    ) -> ExternalChatResult<ChatRef> {
        human(authority)?;
        self.provider.adopt(user, request).await
    }

    /// Detach locally; nothing changes at the provider. Only the person who
    /// added the chat, in their own session, stops syncing it.
    #[tracing::instrument(name = "whatsapp.linked.detach", skip_all, err, fields(chat_id))]
    pub async fn detach<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        authority: SendAuthority,
    ) -> ExternalChatResult<()> {
        human(authority)?;
        let (user, chat_id) = receipt_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(chat_id));
        let chat = self
            .chats
            .chat(chat_id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        if chat.user_id != user.as_ref() {
            return Err(ExternalChatError::Forbidden.into());
        }
        self.provider.detach(&chat).await
    }

    async fn reply_block(
        &self,
        account: Option<&AccountRef>,
        chat: &ChatRef,
    ) -> ExternalChatResult<Option<ReplyBlock>> {
        let facts = match account {
            Some(account) if account.connected => self
                .provider
                .sending_facts(account, std::slice::from_ref(chat))
                .await?
                .pop(),
            _ => None,
        };
        Ok(reply_block(account, chat, facts.as_ref()))
    }

    /// Record a deliberate send for the person's own account. The provider
    /// dispatches it; uncertain outcomes are never resent.
    #[tracing::instrument(
        name = "whatsapp.linked.send",
        skip_all,
        err,
        fields(chat_id, send_id, kind)
    )]
    pub async fn send_reply<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        request: &SendReply,
        authority: SendAuthority,
    ) -> ExternalChatResult<SendProgress> {
        sender(authority)?;
        let (user, chat_id) = receipt_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(chat_id));
        validate_request(request, |text, mentions| {
            self.provider.validate_mentions(text, mentions)
        })?;
        let digest: [u8; 32] = Sha256::digest(
            serde_json::to_vec(request)
                .map_err(|_| ExternalChatError::Invalid("invalid request"))?,
        )
        .into();
        // A retry with the same intent key returns the original send, whatever
        // happened since; it never sends twice.
        if let Some(StoredSend {
            request_sha256,
            progress,
        }) = self
            .provider
            .stored_send(chat_id, user, request.idempotency_key)
            .await?
        {
            if request_sha256 != digest {
                return Err(ExternalChatError::Conflict.into());
            }
            tracing::Span::current().record("send_id", tracing::field::display(progress.id));
            return Ok(progress);
        }
        self.send_rate_limiter.check(user).await?;
        let chat = self
            .chats
            .chat(chat_id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        let account = self.provider.account(user).await?;
        if let Some(block) = self.reply_block(account.as_ref(), &chat).await? {
            return Err(refusal(block).into());
        }
        let account = account.ok_or(ExternalChatError::Disconnected)?;
        let identity = account
            .identity
            .as_deref()
            .ok_or(ExternalChatError::Disconnected)?;
        if let Some(quoted) = request.reply_to {
            self.provider
                .mutation_target(&chat, quoted)
                .await?
                .filter(|target| !target.deleted)
                .ok_or(ExternalChatError::NotFound)?;
        }
        if let ReplyContent::Media { upload_id, caption } = &request.message {
            let mime = self
                .chats
                .staged_upload_mime(user, chat_id, *upload_id)
                .await?
                .ok_or(ExternalChatError::NotFound)?;
            if MediaKind::of(&mime) == Some(MediaKind::Audio) && caption.is_some() {
                return Err(ExternalChatError::Invalid(
                    "send an audio caption as a separate message",
                )
                .into());
            }
        }
        if let ReplyContent::Mutation {
            message_id,
            operation,
            ..
        } = &request.message
        {
            tracing::Span::current().record("kind", tracing::field::debug(operation));
            let target = self
                .provider
                .mutation_target(&chat, *message_id)
                .await?
                .filter(|target| !target.deleted)
                .ok_or(ExternalChatError::NotFound)?;
            authorize_mutation(*operation, &target, identity, Utc::now())?;
        }
        let progress = self
            .provider
            .enqueue_send(SendIntent {
                user,
                account: &account,
                chat: &chat,
                request,
                digest,
            })
            .await?;
        tracing::Span::current().record("send_id", tracing::field::display(progress.id));
        Ok(progress)
    }

    /// Stage one attachment for a later deliberate send in this chat. Nothing
    /// is sent until a media reply names it.
    #[tracing::instrument(name = "whatsapp.linked.upload", skip_all, err, fields(chat_id, size = bytes.len()))]
    pub async fn upload_attachment<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        filename: &str,
        mime: &str,
        bytes: &[u8],
        authority: SendAuthority,
    ) -> ExternalChatResult<UploadedAttachment> {
        sender(authority)?;
        let (user, chat_id) = receipt_scope(access)?;
        tracing::Span::current().record("chat_id", tracing::field::display(chat_id));
        let kind = MediaKind::of(mime).ok_or(ExternalChatError::Invalid(
            "this file type cannot be sent to WhatsApp",
        ))?;
        let filename = filename.trim();
        if bytes.is_empty()
            || bytes.len() > MEDIA_LIMIT_BYTES
            || filename.is_empty()
            || filename.len() > 255
            || filename
                .chars()
                .any(|c| c.is_control() || c == '/' || c == '\\')
        {
            return Err(ExternalChatError::Invalid(
                "an attachment needs a filename and must be non-empty and within the size limit",
            )
            .into());
        }
        let chat = self
            .chats
            .chat(chat_id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        let account = self.provider.account(user).await?;
        if let Some(block) = self.reply_block(account.as_ref(), &chat).await? {
            return Err(refusal(block).into());
        }
        let upload_id = self
            .chats
            .stage_upload(StagedUpload {
                user,
                chat_id,
                filename,
                mime,
                bytes,
                sha256: Sha256::digest(bytes).into(),
                shape: super::shape::measure(kind, mime, bytes),
            })
            .await?;
        Ok(UploadedAttachment {
            upload_id,
            filename: filename.to_owned(),
            kind,
        })
    }

    /// Attachment states of messages the viewer can read. The message body
    /// keeps a text fallback for readers that don't know about them.
    pub async fn message_attachments<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<MessageAttachments>> {
        let (_, chat_id) = view_scope(access)?;
        if messages.len() > BATCH_LIMIT {
            return Err(ExternalChatError::Invalid("too many messages in one request").into());
        }
        let chat = self
            .chats
            .chat(chat_id)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        self.chats.message_attachments(&chat, messages).await
    }

    /// The viewer's sends for these intents or chat messages.
    pub async fn delivery<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>> {
        let (user, chat_id) = receipt_scope(access)?;
        if ids.len() > BATCH_LIMIT {
            return Err(ExternalChatError::Invalid("too many messages in one request").into());
        }
        self.provider.sends_for(chat_id, user, ids).await
    }
}

fn human(authority: SendAuthority) -> ExternalChatResult<()> {
    match authority {
        SendAuthority::Human => Ok(()),
        SendAuthority::UserApiToken | SendAuthority::Automation => {
            Err(ExternalChatError::Forbidden.into())
        }
    }
}

fn sender(authority: SendAuthority) -> ExternalChatResult<()> {
    match authority {
        SendAuthority::Human | SendAuthority::UserApiToken => Ok(()),
        SendAuthority::Automation => Err(ExternalChatError::Forbidden.into()),
    }
}

/// The external chat a receipt names.
fn receipt_chat<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> ExternalChatResult<Uuid> {
    let entity = access.entity();
    if entity.entity_type != EntityType::ExternalChat {
        return Err(ExternalChatError::Forbidden.into());
    }
    Ok(Uuid::parse_str(&entity.entity_id).map_err(|_| ExternalChatError::NotFound)?)
}

/// The person and chat of a receipt held by a person.
fn receipt_scope<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> ExternalChatResult<(&MacroUserIdStr<'static>, Uuid)> {
    let user = access
        .get_authenticated_user()
        .map_err(|_| ExternalChatError::Forbidden)?;
    Ok((user, receipt_chat(access)?))
}

/// Read receipts may represent a bot, but never borrow its acting user's
/// provider identity, send records or unread state.
fn view_scope<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> ExternalChatResult<(&str, Uuid)> {
    let principal = match access.auth() {
        entity_access::domain::models::EntityAccessAuth::Authenticated(user) => user.as_ref(),
        entity_access::domain::models::EntityAccessAuth::Bot(bot) => bot.bot_id_str().as_ref(),
        _ => return Err(ExternalChatError::Forbidden.into()),
    };
    Ok((principal, receipt_chat(access)?))
}

/// The error a send or upload refused for `block` returns.
fn refusal(block: ReplyBlock) -> ExternalChatError {
    match block {
        ReplyBlock::NoAccount | ReplyBlock::Disconnected => ExternalChatError::Disconnected,
        ReplyBlock::NotAdded | ReplyBlock::NotAllowed | ReplyBlock::Unavailable => {
            ExternalChatError::Forbidden
        }
    }
}

/// Why the person cannot send now, from the current facts.
pub(crate) fn reply_block(
    account: Option<&AccountRef>,
    chat: &ChatRef,
    facts: Option<&SendingFacts>,
) -> Option<ReplyBlock> {
    let Some(account) = account else {
        return Some(ReplyBlock::NoAccount);
    };
    if !account.connected {
        return Some(ReplyBlock::Disconnected);
    }
    if chat.state != ChatState::Active {
        return Some(ReplyBlock::Unavailable);
    }
    let Some(facts) = facts.filter(|facts| facts.observing) else {
        return Some(ReplyBlock::NotAdded);
    };
    if !facts.remote_member || !facts.can_post {
        return Some(ReplyBlock::NotAllowed);
    }
    None
}

fn validate_text(text: &str) -> ExternalChatResult<()> {
    if text.trim().is_empty() || text.len() > TEXT_LIMIT_BYTES {
        return Err(ExternalChatError::Invalid(
            "the message is empty or longer than the text limit",
        )
        .into());
    }
    Ok(())
}

/// Check a request before anything is stored; the provider checks mentions.
pub(crate) fn validate_request(
    request: &SendReply,
    validate_mentions: impl FnOnce(&str, &[String]) -> ExternalChatResult<()>,
) -> ExternalChatResult<()> {
    if request.idempotency_key.is_nil() {
        return Err(ExternalChatError::Invalid("a stable send intent key is required").into());
    }
    match &request.message {
        ReplyContent::Text { text, mentions } => {
            validate_text(text)?;
            validate_mentions(text, mentions)
        }
        ReplyContent::Media { caption: None, .. } => Ok(()),
        ReplyContent::Media {
            caption: Some(caption),
            ..
        } => validate_text(caption),
        ReplyContent::Mutation {
            operation: Mutation::Edit,
            text: Some(text),
            ..
        } => validate_text(text),
        ReplyContent::Mutation {
            operation: Mutation::Reaction,
            text: Some(emoji),
            ..
        } if emoji.chars().count() <= 32 && !emoji.chars().any(char::is_control) => Ok(()),
        ReplyContent::Mutation {
            operation: Mutation::Delete,
            text: None,
            ..
        } => Ok(()),
        ReplyContent::Mutation { .. } => {
            Err(ExternalChatError::Invalid("invalid message operation").into())
        }
    }
}

/// Edits and deletes are limited to the person's own recent messages.
pub(crate) fn authorize_mutation(
    operation: Mutation,
    target: &MutationTarget,
    identity: &str,
    now: DateTime<Utc>,
) -> ExternalChatResult<()> {
    if operation == Mutation::Reaction {
        return Ok(());
    }
    if !target.sent_by.iter().any(|id| id == identity) {
        return Err(ExternalChatError::Forbidden.into());
    }
    if now - target.source_at > chrono::Duration::seconds(MUTATION_WINDOW_SECONDS) {
        return Err(
            ExternalChatError::Invalid("the time to change this message has passed").into(),
        );
    }
    Ok(())
}
