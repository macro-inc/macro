//! Shared conversation, human-send, and durable recovery use cases.

use chrono::Utc;
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use messages::domain::service::{MessageView, MessageWrite};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

use super::{
    connection::{Conversation, ReplyContent, SendProgress, SendReply, UploadedAttachment},
    events::MediaKind,
    models::MessagingError,
    policy::SendAuthority,
    ports::{
        ConversationRepository, MediaBytes, NativeConversation, PortResult, ReplyPolicy,
        ReplyTransport,
    },
    replies::{AccountScope, ReplyCapabilities, ReplyEligibility, ReplyOptions, reply_mode},
};

mod dispatch;
#[cfg(test)]
mod test;

/// Common use cases depend only on messaging, persistence and native domain ports.
#[derive(Clone)]
pub struct MessagingService {
    /// Durable send work used by the worker driver.
    pub repository: Arc<dyn ConversationRepository>,
    policy: Arc<dyn ReplyPolicy>,
    transport: Arc<dyn ReplyTransport>,
    native: Arc<dyn NativeConversation>,
}

/// Authorized conversation facts, before provider-specific wire compatibility mapping.
pub struct ConversationState {
    /// Current retained account scope.
    pub account: AccountScope,
    /// Native channel binding and observed conversation facts.
    pub conversation: Conversation,
    /// Permission-only compatibility field; not complete sending eligibility.
    pub can_reply: bool,
    /// Implemented operations and limits.
    pub capabilities: ReplyCapabilities,
    /// Current policy, account and caller eligibility.
    pub eligibility: ReplyEligibility,
    /// Recent durable send attempts.
    pub sends: Vec<SendProgress>,
}

impl MessagingService {
    /// Wire only the capabilities needed by conversation and send use cases.
    pub fn new(
        repository: Arc<dyn ConversationRepository>,
        policy: Arc<dyn ReplyPolicy>,
        transport: Arc<dyn ReplyTransport>,
        native: Arc<dyn NativeConversation>,
    ) -> Self {
        Self {
            repository,
            policy,
            transport,
            native,
        }
    }

    /// Resolve a native channel binding after its owning domain grants view access.
    pub async fn conversation(
        &self,
        access: &EntityAccessReceipt<MessageView>,
    ) -> PortResult<Option<Conversation>> {
        self.repository.conversation(channel_id(access)?).await
    }

    /// Report supported operations separately from current eligibility.
    pub async fn conversation_view(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        authority: SendAuthority,
    ) -> PortResult<Option<ConversationState>> {
        let Some(conversation) = self.conversation(access).await? else {
            return Ok(None);
        };
        let account = self.account(conversation.connection_id).await?;
        let can_reply = if let Ok(user) = access.get_authenticated_user() {
            self.native
                .require_send(account.team_id, conversation.channel_id, user.as_ref())
                .await
                .is_ok()
        } else {
            false
        };
        let mut options = self
            .policy
            .evaluate(&account, &conversation, Utc::now())
            .await?;
        options
            .eligibility
            .restrict(&account, can_reply && authority == SendAuthority::Human);
        let sends = self.repository.sends(conversation.channel_id).await?;
        Ok(Some(ConversationState {
            account,
            conversation,
            can_reply,
            capabilities: options.capabilities,
            eligibility: options.eligibility,
            sends,
        }))
    }

    /// Read bounded delivery state through ordinary native channel access.
    pub async fn message_delivery(
        &self,
        access: &EntityAccessReceipt<MessageView>,
        message_ids: &[Uuid],
    ) -> PortResult<Vec<SendProgress>> {
        if message_ids.len() > 100 {
            return Err(MessagingError::Invalid("request at most 100 message statuses").into());
        }
        let Some(conversation) = self.conversation(access).await? else {
            return Ok(vec![]);
        };
        self.repository
            .sends_for_messages(conversation.channel_id, message_ids)
            .await
    }

    /// Only a deliberate human action may create an external send intent.
    pub async fn send_reply(
        &self,
        access: &EntityAccessReceipt<MessageWrite>,
        request: SendReply,
        authority: SendAuthority,
    ) -> PortResult<SendProgress> {
        if authority != SendAuthority::Human {
            return Err(MessagingError::Forbidden.into());
        }
        let channel = channel_id(access)?;
        let user = access
            .get_authenticated_user()
            .map_err(|_| MessagingError::Forbidden)?
            .as_ref();
        let conversation = self
            .repository
            .conversation(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let account = self.account(conversation.connection_id).await?;
        self.native
            .require_send(account.team_id, channel, user)
            .await?;
        let options = self
            .validate_send(&account, &conversation, &request)
            .await?;
        self.policy.validate_content(&account, &request).await?;
        options
            .eligibility
            .require(reply_mode(&request), Utc::now())?;
        if let ReplyContent::Media {
            document_id, kind, ..
        } = &request.message
        {
            let file = self
                .native
                .outgoing_media(user, channel, *document_id)
                .await?;
            options.capabilities.validate_media(
                *kind,
                &file.file.mime_type,
                file.file.bytes.len(),
            )?;
        }
        // Preserve the v1 serializer, including default fields, and its exact intent hash.
        let encoded = serde_json::to_vec(&request)
            .map_err(|_| MessagingError::Invalid("invalid send request"))?;
        self.repository
            .enqueue_send(
                account.id,
                channel,
                user,
                &request,
                &Sha256::digest(encoded),
            )
            .await
    }

    /// File selection stages a private native document; it creates no send intent.
    pub async fn upload_attachment(
        &self,
        access: &EntityAccessReceipt<MessageWrite>,
        file: MediaBytes,
    ) -> PortResult<UploadedAttachment> {
        let channel = channel_id(access)?;
        let user = access
            .get_authenticated_user()
            .map_err(|_| MessagingError::Forbidden)?
            .as_ref();
        let conversation = self
            .repository
            .conversation(channel)
            .await?
            .ok_or(MessagingError::NotFound)?;
        let account = self.account(conversation.connection_id).await?;
        self.native
            .require_send(account.team_id, channel, user)
            .await?;
        let kind = if file.mime_type.starts_with("image/") {
            MediaKind::Image
        } else if file.mime_type.starts_with("audio/") {
            MediaKind::Audio
        } else if file.mime_type.starts_with("video/") {
            MediaKind::Video
        } else {
            MediaKind::Document
        };
        let options = self
            .policy
            .evaluate(&account, &conversation, Utc::now())
            .await?;
        options
            .capabilities
            .validate_media(kind, &file.mime_type, file.bytes.len())?;
        self.native.upload_attachment(user, channel, file).await
    }

    async fn account(&self, id: Uuid) -> PortResult<AccountScope> {
        self.repository
            .account_scope(id)
            .await?
            .ok_or_else(|| MessagingError::NotFound.into())
    }

    async fn validate_send(
        &self,
        account: &AccountScope,
        conversation: &Conversation,
        request: &SendReply,
    ) -> PortResult<ReplyOptions> {
        let now = Utc::now();
        let mut options = self.policy.evaluate(account, conversation, now).await?;
        options.eligibility.restrict(account, true);
        options.capabilities.validate(request)?;
        options.eligibility.require(reply_mode(request), now)?;
        if let Some(message) = &request.reply_to
            && !self.repository.has_message(conversation, message).await?
        {
            return Err(MessagingError::Invalid(
                "quoted message does not belong to this customer conversation",
            )
            .into());
        }
        Ok(options)
    }
}

pub(super) fn channel_id<T: entity_access::domain::models::RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> Result<Uuid, MessagingError> {
    if access.entity().entity_type != EntityType::Channel {
        return Err(MessagingError::Forbidden);
    }
    access
        .entity()
        .entity_id
        .parse()
        .map_err(|_| MessagingError::Forbidden)
}
