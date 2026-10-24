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
        let adoptions = self.groups.visible_adoptions(user, &jids).await?;
        for group in &mut groups {
            (group.group, group.shared) = adoption_of(user, &adoptions, &group.jid);
            group.name = group.display_name(&identity);
        }
        groups.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        tracing::Span::current().record("count", groups.len());
        Ok(groups)
    }

    /// The person's WhatsApp chat list, as WhatsApp Web shows it: groups and
    /// direct chats, newest activity first. Groups carry the same added /
    /// shared / addable facts as [`Self::groups`]; direct chats are addable
    /// too (not your own chat) and never shown as shared. Returns stored data
    /// and requests a group refresh.
    #[tracing::instrument(name = "whatsapp.linked.chats", skip_all, err, fields(count))]
    pub async fn chats(&self, user: &str) -> LinkedResult<ChatList> {
        if !self.features.adoption {
            return Err(LinkedError::ConfigurationRequired.into());
        }
        let (account, identity) = self.connected(user).await?;
        self.groups.request_groups_refresh(&[account.id]).await?;
        let roster = self.groups.account_groups(account.id).await?;
        let stored = self.groups.account_chats(account.id).await?;
        let mut group_jids: Vec<String> = roster.iter().map(|g| g.jid.clone()).collect();
        group_jids.extend(stored.iter().map(|chat| chat.jid.clone()));
        group_jids.sort();
        group_jids.dedup();
        let adoptions = self.groups.visible_adoptions(user, &group_jids).await?;
        let mut chats: Vec<Chat> = Vec::with_capacity(stored.len() + roster.len());
        let mut listed = std::collections::HashMap::new();
        for chat in stored {
            listed.insert(chat.jid.clone(), chats.len());
            let (group, shared) = adoption_of(user, &adoptions, &chat.jid);
            // Someone else's chat with the same person is their own
            // conversation, not this one.
            let shared = shared.filter(|_| chat.kind == ChatKind::Group);
            let name = chat
                .name
                .clone()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| chat_fallback_name(&chat.jid, chat.kind, &identity));
            let reason = match chat.kind {
                ChatKind::Direct if chat.jid == identity => Some(cannot_add::OWN_CHAT),
                ChatKind::Direct => None,
                // Listed by WhatsApp but not in the account's groups any more.
                ChatKind::Group => Some(cannot_add::NOT_IN_GROUP),
            };
            let open = group.is_none() && shared.is_none();
            chats.push(Chat {
                name: if chat.jid == identity {
                    "You".to_owned()
                } else {
                    name
                },
                jid: chat.jid,
                kind: chat.kind,
                last_activity_at: chat.last_activity_at,
                archived: chat.archived,
                pinned: chat.pinned,
                can_add: open && reason.is_none(),
                cannot_add_reason: reason.filter(|_| open).map(str::to_owned),
                group,
                shared,
                community: None,
            });
        }
        for info in &roster {
            let index = match listed.get(&info.jid) {
                Some(index) => *index,
                None => {
                    chats.push(Chat {
                        jid: info.jid.clone(),
                        kind: ChatKind::Group,
                        name: String::new(),
                        last_activity_at: None,
                        archived: false,
                        pinned: false,
                        group: None,
                        shared: None,
                        can_add: false,
                        cannot_add_reason: None,
                        community: None,
                    });
                    chats.len() - 1
                }
            };
            let chat = &mut chats[index];
            chat.kind = ChatKind::Group;
            chat.name = info.display_name(&identity);
            (chat.group, chat.shared) = adoption_of(user, &adoptions, &info.jid);
            chat.community = info.community(
                info.community_jid
                    .as_ref()
                    .and_then(|parent| roster.iter().find(|group| &group.jid == parent)),
            );
            let reason = if info.community_parent {
                Some(cannot_add::COMMUNITY)
            } else if info.participant(&identity).is_none() {
                Some(cannot_add::NOT_IN_GROUP)
            } else {
                None
            };
            let open = chat.group.is_none() && chat.shared.is_none();
            chat.can_add = open && reason.is_none();
            chat.cannot_add_reason = reason.filter(|_| open).map(str::to_owned);
        }
        chats.sort_by(|a, b| {
            b.last_activity_at
                .cmp(&a.last_activity_at)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        tracing::Span::current().record("count", chats.len());
        Ok(ChatList { chats })
    }

    /// Add an existing group the person has joined, or a direct chat from
    /// their chat list, as their own Macro chat; never creates or joins
    /// anything in WhatsApp. Adding the same chat twice returns the existing
    /// one.
    #[tracing::instrument(
        name = "whatsapp.linked.adopt",
        skip_all,
        err,
        fields(binding_id, created, kind)
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
        let (account, identity) = self.connected(user).await?;
        let adoption = if is_group_jid(&request.group_jid) {
            let group = self
                .groups
                .account_group(account.id, &request.group_jid)
                .await?
                .ok_or(LinkedError::Invalid(cannot_add::NOT_IN_GROUP))?;
            if group.community_parent {
                return Err(LinkedError::Invalid(cannot_add::COMMUNITY).into());
            }
            if group.participant(&identity).is_none() {
                return Err(LinkedError::Invalid(cannot_add::NOT_IN_GROUP).into());
            }
            Adoption {
                jid: group.jid.clone(),
                kind: ChatKind::Group,
                name: group.display_name(&identity),
                can_post: group.can_post(&identity),
                observed_at: group.observed_at,
            }
        } else {
            if request.group_jid == identity {
                return Err(LinkedError::Invalid(cannot_add::OWN_CHAT).into());
            }
            let chat = self
                .groups
                .account_chats(account.id)
                .await?
                .into_iter()
                .find(|chat| chat.kind == ChatKind::Direct && chat.jid == request.group_jid)
                .ok_or(LinkedError::Invalid(
                    "this chat is not in your WhatsApp chat list",
                ))?;
            Adoption {
                name: chat
                    .name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| chat_fallback_name(&chat.jid, chat.kind, &identity)),
                jid: chat.jid,
                kind: ChatKind::Direct,
                can_post: true,
                observed_at: chrono::Utc::now(),
            }
        };
        let adopted = self
            .bindings
            .adopt(AdoptionRecord {
                user,
                account: &account,
                adoption: &adoption,
            })
            .await?;
        let span = tracing::Span::current();
        span.record("binding_id", tracing::field::display(adopted.binding.id));
        span.record("created", adopted.created);
        span.record("kind", adoption.kind.as_str());
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
                shape: super::shape::measure(kind, mime, bytes),
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
/// The caller's own Macro group for a WhatsApp group, else someone else's
/// group for it that was shared with them.
fn adoption_of(
    user: &str,
    adoptions: &[VisibleAdoption],
    jid: &str,
) -> (Option<GroupReference>, Option<SharedGroupReference>) {
    let mine = adoptions
        .iter()
        .find(|adoption| adoption.group_jid == jid && adoption.owner_id == user)
        .map(|adoption| GroupReference {
            id: adoption.id,
            name: adoption.name.clone(),
        });
    let shared = mine.is_none().then(|| {
        adoptions
            .iter()
            .find(|adoption| adoption.group_jid == jid && adoption.owner_id != user)
            .map(|adoption| SharedGroupReference {
                id: adoption.id,
                name: adoption.name.clone(),
                owner_id: adoption.owner_id.clone(),
            })
    });
    (mine, shared.flatten())
}

/// A chat WhatsApp gave no name: a direct chat by its phone number.
fn chat_fallback_name(jid: &str, kind: ChatKind, identity: &str) -> String {
    match kind {
        ChatKind::Group => "WhatsApp group".to_owned(),
        ChatKind::Direct if jid == identity => "You".to_owned(),
        ChatKind::Direct => jid
            .strip_suffix("@s.whatsapp.net")
            .map(|phone| format!("+{phone}"))
            .unwrap_or_else(|| "WhatsApp contact".to_owned()),
    }
}

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

/// Each mention is a person's WhatsApp id that the text names as
/// `@<user part>`, the way WhatsApp renders it.
fn validate_mentions(text: &str, mentions: &[String]) -> LinkedResult<()> {
    if mentions.len() > MENTION_LIMIT {
        return Err(LinkedError::Invalid("too many mentions in one message").into());
    }
    for mention in mentions {
        let user = mention
            .strip_suffix("@s.whatsapp.net")
            .or_else(|| mention.strip_suffix("@lid"))
            .filter(|user| !user.is_empty() && user.bytes().all(|byte| byte.is_ascii_digit()))
            .ok_or(LinkedError::Invalid(
                "a mention is not a WhatsApp participant",
            ))?;
        if !text.contains(&format!("@{user}")) {
            return Err(LinkedError::Invalid("a mentioned person is not named in the text").into());
        }
    }
    Ok(())
}

pub(crate) fn validate_request(request: &SendReply) -> LinkedResult<()> {
    if request.idempotency_key.is_nil() {
        return Err(LinkedError::Invalid("a stable send intent key is required").into());
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
