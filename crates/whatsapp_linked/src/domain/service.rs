//! Owner-bound account lifecycle, adoption and deliberate sends, as served by DSS.

use super::{models::*, ports::*, timeline::*};
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, RequiredPermission};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;
mod timeline;

/// DSS use cases for personal linked devices.
#[derive(Clone)]
pub struct LinkedService {
    features: Features,
    accounts: Arc<dyn AccountRepository>,
    groups: Arc<dyn GroupRepository>,
    bindings: Arc<dyn BindingRepository>,
    sends: Arc<dyn SendRepository>,
    authorizer: Arc<dyn Authorizer>,
    timeline: Arc<dyn TimelineRepository>,
    send_rate_limiter: Arc<dyn SendRateLimiter>,
}

impl LinkedService {
    /// Wire adapters at the composition root.
    pub fn new<R>(
        features: Features,
        repository: Arc<R>,
        authorizer: Arc<dyn Authorizer>,
        send_rate_limiter: Arc<dyn SendRateLimiter>,
    ) -> Self
    where
        R: AccountRepository
            + GroupRepository
            + BindingRepository
            + SendRepository
            + TimelineRepository
            + 'static,
    {
        Self {
            features,
            accounts: repository.clone(),
            groups: repository.clone(),
            bindings: repository.clone(),
            sends: repository.clone(),
            timeline: repository,
            authorizer,

            send_rate_limiter,
        }
    }

    /// Server rollout switches.
    pub fn features(&self) -> Features {
        self.features
    }

    /// Personal settings never depend on workspace administration.
    pub async fn account(&self, user: &str) -> LinkedResult<Option<Account>> {
        self.accounts.owned_account(user).await
    }

    /// Start explicit owner consent. Replacement never inherits the old identity.
    #[tracing::instrument(name = "whatsapp.linked.connect", skip_all, err, fields(replace = replace, pairing_id))]
    pub async fn connect(
        &self,
        user: &str,
        replace: bool,
        authority: SendAuthority,
    ) -> LinkedResult<Pairing> {
        human(authority)?;
        if !self.features.pairing {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        let pairing = self.accounts.begin_pairing(user, replace).await?;
        tracing::Span::current().record("pairing_id", tracing::field::display(pairing.id));
        Ok(pairing)
    }

    /// Poll the initiating person's transaction, including secret enrollment material.
    pub async fn pair_state(
        &self,
        user: &str,
        pairing: Uuid,
        authority: SendAuthority,
    ) -> LinkedResult<PairState> {
        human(authority)?;
        self.accounts.pair_state(user, pairing).await
    }

    /// Forward the owner's WebAuthn assertion for a transaction waiting on a
    /// passkey. The replica hands it to WhatsApp.
    #[tracing::instrument(name = "whatsapp.linked.passkey", skip_all, err, fields(pairing_id = %pairing))]
    pub async fn passkey(
        &self,
        user: &str,
        pairing: Uuid,
        response: &serde_json::Value,
        authority: SendAuthority,
    ) -> LinkedResult<()> {
        human(authority)?;
        if !self.features.pairing {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        if !response.is_object() || response.to_string().len() > PASSKEY_LIMIT_BYTES {
            return Err(LinkedError::Invalid("invalid passkey response").into());
        }
        self.accounts.submit_passkey(user, pairing, response).await
    }

    /// Cancel the initiating person's transaction; the replica stops pairing.
    #[tracing::instrument(name = "whatsapp.linked.cancel_pairing", skip_all, err, fields(pairing_id = %pairing))]
    pub async fn cancel(
        &self,
        user: &str,
        pairing: Uuid,
        authority: SendAuthority,
    ) -> LinkedResult<()> {
        human(authority)?;
        self.accounts.cancel_pairing(user, pairing).await
    }

    /// End observation consent. History and established entity access remain.
    #[tracing::instrument(name = "whatsapp.linked.disconnect", skip_all, err, fields(generation = generation))]
    pub async fn disconnect(
        &self,
        user: &str,
        generation: i64,
        authority: SendAuthority,
    ) -> LinkedResult<Disconnect> {
        human(authority)?;
        let changed = self.accounts.disconnect(user, generation).await?;
        Ok(Disconnect {
            remote_unlink_requested: changed,
        })
    }

    async fn connected(&self, user: &str) -> LinkedResult<(Account, String)> {
        let account = self
            .accounts
            .owned_account(user)
            .await?
            .filter(|a| a.state == AccountState::Connected)
            .ok_or(LinkedError::Disconnected)?;
        let identity = account
            .identity_jid
            .clone()
            .ok_or(LinkedError::Disconnected)?;
        Ok((account, identity))
    }

    /// Only a person's own joined groups are discoverable. The stored list is
    /// returned at once and a refresh is requested (rate limited per account).
    /// Each group points at the caller's own Macro group once added, or at
    /// someone else's group that was shared with them.
    #[tracing::instrument(name = "whatsapp.linked.groups", skip_all, err, fields(count))]
    pub async fn groups(&self, user: &str) -> LinkedResult<Vec<GroupInfo>> {
        if !self.features.adoption {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        let (account, identity) = self.connected(user).await?;
        self.groups.request_groups_refresh(&[account.id]).await?;
        let mut groups = self.groups.account_groups(account.id).await?;
        let jids: Vec<String> = groups.iter().map(|g| g.jid.clone()).collect();
        for adoption in self.groups.visible_adoptions(user, &jids).await? {
            let Some(group) = groups.iter_mut().find(|g| g.jid == adoption.group_jid) else {
                continue;
            };
            if adoption.owner_id == user {
                group.group = Some(GroupReference {
                    id: adoption.id,
                    name: adoption.name,
                });
            } else if group.shared.is_none() {
                group.shared = Some(SharedGroupReference {
                    id: adoption.id,
                    name: adoption.name,
                    owner_id: adoption.owner_id,
                });
            }
        }
        for group in &mut groups {
            if group.group.is_some() {
                group.shared = None;
            }
            group.name = group.display_name(&identity);
        }
        groups.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        tracing::Span::current().record("count", groups.len());
        Ok(groups)
    }

    /// Add an existing group the person has joined as their own Macro group;
    /// never creates or joins a group in WhatsApp. Adding the same group twice
    /// returns the existing one.
    #[tracing::instrument(
        name = "whatsapp.linked.adopt",
        skip_all,
        err,
        fields(binding_id, created)
    )]
    pub async fn adopt(
        &self,
        user: &str,
        request: &AdoptGroup,
        authority: SendAuthority,
    ) -> LinkedResult<Binding> {
        human(authority)?;
        if !self.features.adoption {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        if !is_group_jid(&request.group_jid) {
            return Err(LinkedError::Invalid("invalid WhatsApp group").into());
        }
        let (account, identity) = self.connected(user).await?;
        let group = self
            .groups
            .account_group(account.id, &request.group_jid)
            .await?
            .ok_or(LinkedError::Invalid(
                "your WhatsApp is not in this group any more",
            ))?;
        if group.community {
            return Err(LinkedError::Invalid("community groups can't be added to Macro").into());
        }
        if group.disappearing {
            return Err(LinkedError::Invalid(
                "groups with disappearing messages can't be added to Macro",
            )
            .into());
        }
        if group.participant(&identity).is_none() {
            return Err(LinkedError::Invalid("your WhatsApp is not in this group any more").into());
        }
        let adopted = self
            .bindings
            .adopt(AdoptionRecord {
                user,
                account: &account,
                name: &group.display_name(&identity),
                group: &group,
            })
            .await?;
        let span = tracing::Span::current();
        span.record("binding_id", tracing::field::display(adopted.binding.id));
        span.record("created", adopted.created);
        Ok(adopted.binding)
    }

    async fn managed_binding(&self, user: &str, group_id: Uuid) -> LinkedResult<Binding> {
        let binding = self
            .bindings
            .binding(group_id)
            .await?
            .ok_or(LinkedError::NotFound)?;
        self.authorizer.require_group_owner(group_id, user).await?;
        if binding.user_id != user {
            return Err(LinkedError::Forbidden.into());
        }
        Ok(binding)
    }

    /// Detach locally; nothing changes in WhatsApp.
    #[tracing::instrument(name = "whatsapp.linked.detach", skip_all, err, fields(group_id = %group_id))]
    pub async fn detach(
        &self,
        user: &str,
        group_id: Uuid,
        authority: SendAuthority,
    ) -> LinkedResult<()> {
        human(authority)?;
        let binding = self.managed_binding(user, group_id).await?;
        self.bindings.detach(&binding).await
    }

    async fn reply_block(
        &self,
        account: Option<&Account>,
        binding: &Binding,
    ) -> LinkedResult<Option<ReplyBlock>> {
        let facts = match account {
            Some(account) if account.state == AccountState::Connected => {
                Some(self.sends.sending_facts(account, binding).await?)
            }
            _ => None,
        };
        Ok(reply_block(self.features, account, binding, facts.as_ref()))
    }

    /// Record a deliberate send for the person's own account. The account's
    /// replica dispatches it; uncertain outcomes are never resent.
    #[tracing::instrument(
        name = "whatsapp.linked.send",
        skip_all,
        err,
        fields(group_id, send_id, kind)
    )]
    pub async fn send_reply<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        request: &SendReply,
        authority: SendAuthority,
    ) -> LinkedResult<SendProgress> {
        sender(authority)?;
        let (user, group_id) = receipt_scope(access)?;
        tracing::Span::current().record("group_id", tracing::field::display(group_id));
        if !self.features.sending {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        validate_request(request)?;
        let digest: [u8; 32] = Sha256::digest(
            serde_json::to_vec(request).map_err(|_| LinkedError::Invalid("invalid request"))?,
        )
        .into();
        // A retry with the same intent key returns the original send, whatever
        // happened since; it never sends twice.
        if let Some((stored, progress)) = self
            .sends
            .stored_send(group_id, user, request.idempotency_key)
            .await?
        {
            if stored != digest {
                return Err(LinkedError::Conflict.into());
            }
            tracing::Span::current().record("send_id", tracing::field::display(progress.id));
            return Ok(progress);
        }
        self.send_rate_limiter.check(user).await?;
        let binding = self
            .bindings
            .binding(group_id)
            .await?
            .ok_or(LinkedError::NotFound)?;
        let account = self.accounts.owned_account(user).await?;
        match self.reply_block(account.as_ref(), &binding).await? {
            None => {}
            Some(ReplyBlock::NoAccount | ReplyBlock::Disconnected) => {
                return Err(LinkedError::Disconnected.into());
            }
            Some(_) => return Err(LinkedError::Forbidden.into()),
        }
        let account = account.ok_or(LinkedError::Disconnected)?;
        let identity = account
            .identity_jid
            .as_deref()
            .ok_or(LinkedError::Disconnected)?;
        if let Some(quoted) = request.reply_to {
            self.sends
                .mutation_target(&binding, quoted)
                .await?
                .filter(|target| !target.deleted)
                .ok_or(LinkedError::NotFound)?;
        }
        if let ReplyContent::Media { upload_id, caption } = &request.message {
            let (mime, _) = self
                .sends
                .staged_upload(user, group_id, *upload_id)
                .await?
                .ok_or(LinkedError::NotFound)?;
            if MediaKind::of(&mime) == Some(MediaKind::Audio) && caption.is_some() {
                return Err(
                    LinkedError::Invalid("send an audio caption as a separate message").into(),
                );
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
                .sends
                .mutation_target(&binding, *message_id)
                .await?
                .filter(|target| !target.deleted)
                .ok_or(LinkedError::NotFound)?;
            authorize_mutation(*operation, &target, identity, Utc::now())?;
        }
        let progress = self
            .sends
            .enqueue(SendIntent {
                user,
                account: &account,
                binding: &binding,
                request,
                digest,
            })
            .await?;
        tracing::Span::current().record("send_id", tracing::field::display(progress.id));
        Ok(progress)
    }

    /// Stage one attachment for a later deliberate send in this group. Nothing
    /// is sent until a media reply names it.
    #[tracing::instrument(name = "whatsapp.linked.upload", skip_all, err, fields(group_id, size = bytes.len()))]
    pub async fn upload_attachment<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        filename: &str,
        mime: &str,
        bytes: &[u8],
        authority: SendAuthority,
    ) -> LinkedResult<UploadedAttachment> {
        sender(authority)?;
        let (user, group_id) = receipt_scope(access)?;
        tracing::Span::current().record("group_id", tracing::field::display(group_id));
        if !self.features.sending {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        let kind = MediaKind::of(mime).ok_or(LinkedError::Invalid(
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
            return Err(LinkedError::Invalid(
                "attachments must be 1 byte to 32 MiB with a filename",
            )
            .into());
        }
        let binding = self
            .bindings
            .binding(group_id)
            .await?
            .ok_or(LinkedError::NotFound)?;
        let account = self.accounts.owned_account(user).await?;
        if self
            .reply_block(account.as_ref(), &binding)
            .await?
            .is_some()
        {
            return Err(LinkedError::Forbidden.into());
        }
        let upload_id = self
            .sends
            .stage_upload(StagedUpload {
                user,
                group_id,
                filename,
                mime,
                bytes,
                sha256: Sha256::digest(bytes).into(),
            })
            .await?;
        Ok(UploadedAttachment {
            upload_id,
            filename: filename.to_owned(),
            kind,
        })
    }

    /// Attachment states of linked messages the viewer can read. The message
    /// body keeps a text fallback for readers that don't know about them.
    pub async fn message_attachments<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        messages: &[Uuid],
    ) -> LinkedResult<Vec<MessageAttachments>> {
        let (_, group_id) = view_scope(access)?;
        if messages.len() > 100 {
            return Err(LinkedError::Invalid("at most 100 messages").into());
        }
        let binding = self
            .bindings
            .binding(group_id)
            .await?
            .ok_or(LinkedError::NotFound)?;
        self.bindings.message_attachments(&binding, messages).await
    }

    /// The viewer's sends for these intents or group messages.
    pub async fn delivery<T: RequiredPermission>(
        &self,
        access: &EntityAccessReceipt<T>,
        ids: &[Uuid],
    ) -> LinkedResult<Vec<SendProgress>> {
        let (user, group_id) = receipt_scope(access)?;
        if ids.len() > 100 {
            return Err(LinkedError::Invalid("at most 100 messages").into());
        }
        self.sends.sends_for(group_id, user, ids).await
    }
}

/// Largest WebAuthn assertion accepted from the browser.
const PASSKEY_LIMIT_BYTES: usize = 32 * 1024;

fn human(authority: SendAuthority) -> LinkedResult<()> {
    match authority {
        SendAuthority::Human => Ok(()),
        SendAuthority::UserApiToken | SendAuthority::Automation => {
            Err(LinkedError::Forbidden.into())
        }
    }
}

fn sender(authority: SendAuthority) -> LinkedResult<()> {
    match authority {
        SendAuthority::Human | SendAuthority::UserApiToken => Ok(()),
        SendAuthority::Automation => Err(LinkedError::Forbidden.into()),
    }
}

fn receipt_scope<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> LinkedResult<(&str, Uuid)> {
    let user = access
        .get_authenticated_user()
        .map_err(|_| LinkedError::Forbidden)?;
    let entity = access.entity();
    if entity.entity_type != EntityType::WhatsAppGroup {
        return Err(LinkedError::Forbidden.into());
    }
    let group_id = Uuid::parse_str(&entity.entity_id).map_err(|_| LinkedError::NotFound)?;
    Ok((user.as_ref(), group_id))
}

/// Read receipts may represent a bot, but never borrow its acting user's phone
/// identity, send records or unread state.
fn view_scope<T: RequiredPermission>(
    access: &EntityAccessReceipt<T>,
) -> LinkedResult<(&str, Uuid)> {
    let principal = match access.auth() {
        entity_access::domain::models::EntityAccessAuth::Authenticated(user) => user.as_ref(),
        entity_access::domain::models::EntityAccessAuth::Bot(bot) => bot.bot_id_str().as_ref(),
        _ => return Err(LinkedError::Forbidden.into()),
    };
    let entity = access.entity();
    if entity.entity_type != EntityType::WhatsAppGroup {
        return Err(LinkedError::Forbidden.into());
    }
    Ok((
        principal,
        Uuid::parse_str(&entity.entity_id).map_err(|_| LinkedError::NotFound)?,
    ))
}

/// WhatsApp group JIDs: digits, optionally `creator-timestamp`, at `g.us`.
pub(crate) fn is_group_jid(jid: &str) -> bool {
    jid.len() <= 256
        && jid.strip_suffix("@g.us").is_some_and(|user| {
            !user.is_empty() && user.bytes().all(|b| b.is_ascii_digit() || b == b'-')
        })
}

/// Why the person cannot send now, from the current facts.
pub(crate) fn reply_block(
    features: Features,
    account: Option<&Account>,
    binding: &Binding,
    facts: Option<&SendingFacts>,
) -> Option<ReplyBlock> {
    if !features.sending {
        return Some(ReplyBlock::SendingDisabled);
    }
    let Some(account) = account else {
        return Some(ReplyBlock::NoAccount);
    };
    if account.state != AccountState::Connected {
        return Some(ReplyBlock::Disconnected);
    }
    if binding.state != BindingState::Active || binding.ownership_state != OwnershipState::Active {
        return Some(ReplyBlock::GroupUnavailable);
    }
    let Some(facts) = facts.filter(|facts| facts.observing) else {
        return Some(ReplyBlock::NotObserving);
    };
    if !facts.remote_member || !facts.can_post {
        return Some(ReplyBlock::NotAllowedInGroup);
    }
    None
}

fn validate_text(text: &str) -> LinkedResult<()> {
    if text.trim().is_empty() || text.len() > TEXT_LIMIT_BYTES {
        return Err(LinkedError::Invalid("message is empty or longer than 16 KiB").into());
    }
    Ok(())
}

pub(crate) fn validate_request(request: &SendReply) -> LinkedResult<()> {
    if request.idempotency_key.is_nil() {
        return Err(LinkedError::Invalid("a stable send intent key is required").into());
    }
    match &request.message {
        ReplyContent::Text { text } => validate_text(text),
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
            Err(LinkedError::Invalid("invalid message operation").into())
        }
    }
}

/// Edits and deletes are limited to the person's own recent messages.
pub(crate) fn authorize_mutation(
    operation: Mutation,
    target: &MutationTarget,
    identity: &str,
    now: DateTime<Utc>,
) -> LinkedResult<()> {
    if operation == Mutation::Reaction {
        return Ok(());
    }
    if !target.sent_by.iter().any(|jid| jid == identity) {
        return Err(LinkedError::Forbidden.into());
    }
    if now - target.source_at > chrono::Duration::seconds(MUTATION_WINDOW_SECONDS) {
        return Err(LinkedError::Invalid("messages can only be changed for ten minutes").into());
    }
    Ok(())
}
