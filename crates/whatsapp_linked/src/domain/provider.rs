//! WhatsApp as an external chat provider: which chats a person can add, who
//! can send in them, their members and names, and the `whatsapp_send` outbox
//! the session service dispatches.

use super::{
    jid::{Jid, is_group_jid},
    models::*,
    ports::*,
    service::{chat_fallback_name, connected},
};
use async_trait::async_trait;
use external_chat::domain::{
    models::*,
    ports::{
        AccountRef, ChatProvider, ExternalChatResult, Members, MutationTarget, SendIntent,
        SendingFacts, StoredSend,
    },
    timeline::{ExternalChatMembers, ExternalChatParticipant, view::People},
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

/// Linked WhatsApp accounts behind external chats.
#[derive(Clone)]
pub struct WhatsAppProvider {
    accounts: Arc<dyn AccountRepository>,
    groups: Arc<dyn GroupRepository>,
    adoptions: Arc<dyn AdoptionRepository>,
    sends: Arc<dyn SendRepository>,
}

impl WhatsAppProvider {
    /// Wire adapters at the composition root.
    pub fn new<R>(repository: Arc<R>) -> Self
    where
        R: AccountRepository + GroupRepository + AdoptionRepository + SendRepository + 'static,
    {
        Self {
            accounts: repository.clone(),
            groups: repository.clone(),
            adoptions: repository.clone(),
            sends: repository,
        }
    }
}

#[async_trait]
impl ChatProvider for WhatsAppProvider {
    fn capabilities(&self, _chat: &ChatRef) -> Capabilities {
        Capabilities::default()
    }

    /// Each mention is a person's WhatsApp id that the text names as
    /// `@<user part>`, the way WhatsApp renders it.
    fn validate_mentions(&self, text: &str, mentions: &[String]) -> ExternalChatResult<()> {
        if mentions.len() > MENTION_LIMIT {
            return Err(ExternalChatError::Invalid("too many mentions in one message").into());
        }
        for mention in mentions {
            let user = Jid::parse(mention)
                .filter(|jid| jid.is_person())
                .ok_or(ExternalChatError::Invalid(
                    "a mention is not a WhatsApp participant",
                ))?
                .user;
            if !text.contains(&format!("@{user}")) {
                return Err(ExternalChatError::Invalid(
                    "a mentioned person is not named in the text",
                )
                .into());
            }
        }
        Ok(())
    }

    async fn account(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Option<AccountRef>> {
        Ok(self
            .accounts
            .owned_account(user)
            .await?
            .map(|account| AccountRef {
                id: account.id,
                user_id: account.user_id,
                identity: account.identity_jid,
                connected: account.state == AccountState::Connected,
                generation: account.authorization_generation,
            }))
    }

    async fn sending_facts(
        &self,
        account: &AccountRef,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<SendingFacts>> {
        let groups: Vec<String> = chats
            .iter()
            .filter(|chat| chat.kind == ExternalChatKind::Group)
            .map(|chat| chat.remote_id.clone())
            .collect();
        let rosters = if groups.is_empty() {
            vec![]
        } else {
            self.groups.account_rosters(account.id, &groups).await?
        };
        Ok(chats
            .iter()
            .map(|chat| {
                sending_facts(
                    account,
                    chat,
                    rosters.iter().find(|roster| roster.jid == chat.remote_id),
                )
            })
            .collect())
    }

    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>> {
        self.groups.communities(chats).await
    }

    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<Members>> {
        Ok(self.groups.chat_roster(chat).await?.map(|roster| Members {
            disappearing_seconds: roster.disappearing_seconds,
            members: members(&roster),
        }))
    }

    async fn people(&self, chat: &ChatRef, ids: &[String]) -> ExternalChatResult<People> {
        self.groups.people(chat, ids).await
    }

    async fn request_refresh(&self, chat: &ChatRef, viewer: &str) -> ExternalChatResult<()> {
        let observers = self.groups.group_accounts(chat.id, viewer).await?;
        self.groups.request_groups_refresh(&observers).await
    }

    /// Add an existing WhatsApp group the person has joined, or a direct chat
    /// from their chat list, as their own external chat; never creates or
    /// joins anything in WhatsApp. Adding the same chat twice returns the
    /// existing one.
    #[tracing::instrument(
        name = "whatsapp.linked.adopt",
        skip_all,
        err,
        fields(chat_id, created, kind)
    )]
    async fn adopt(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &AddChat,
    ) -> ExternalChatResult<ChatRef> {
        match request.provider {
            ExternalChatProvider::WhatsApp => {}
        }
        let jid = request.remote_id.as_str();
        let kind = if is_group_jid(jid) {
            ExternalChatKind::Group
        } else {
            ExternalChatKind::Direct
        };
        if kind != request.kind {
            return Err(ExternalChatError::Invalid("the chat kind does not match its id").into());
        }
        let (account, identity) = connected(self.accounts.as_ref(), user).await?;
        let adoption = if kind == ExternalChatKind::Group {
            let group = self
                .groups
                .account_group(account.id, jid)
                .await?
                .ok_or(ExternalChatError::CannotAdd(CannotAdd::NotInGroup))?;
            if group.community_parent {
                return Err(ExternalChatError::CannotAdd(CannotAdd::Community).into());
            }
            if group.participant(&identity).is_none() {
                return Err(ExternalChatError::CannotAdd(CannotAdd::NotInGroup).into());
            }
            Adoption {
                jid: group.jid.clone(),
                kind: ExternalChatKind::Group,
                name: group.display_name(&identity),
                can_post: group.can_post(&identity),
                observed_at: group.observed_at,
            }
        } else {
            if jid == identity {
                return Err(ExternalChatError::CannotAdd(CannotAdd::OwnChat).into());
            }
            let chat = self
                .groups
                .account_chats(account.id)
                .await?
                .into_iter()
                .find(|chat| chat.kind == ExternalChatKind::Direct && chat.jid == jid)
                .ok_or(ExternalChatError::CannotAdd(CannotAdd::NotInChatList))?;
            Adoption {
                name: chat
                    .name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| chat_fallback_name(&chat.jid, chat.kind, &identity)),
                jid: chat.jid,
                kind: ExternalChatKind::Direct,
                can_post: true,
                observed_at: chrono::Utc::now(),
            }
        };
        let adopted = self
            .adoptions
            .adopt(AdoptionRecord {
                user,
                account: &account,
                adoption: &adoption,
            })
            .await?;
        let span = tracing::Span::current();
        span.record("chat_id", tracing::field::display(adopted.chat.id));
        span.record("created", adopted.created);
        span.record("kind", adoption.kind.as_ref());
        Ok(adopted.chat)
    }

    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()> {
        self.adoptions.detach(chat).await
    }

    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>> {
        self.sends.mutation_target(chat, message).await
    }

    async fn stored_send(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        idempotency_key: Uuid,
    ) -> ExternalChatResult<Option<StoredSend>> {
        self.sends.stored_send(chat_id, user, idempotency_key).await
    }

    async fn enqueue_send(&self, intent: SendIntent<'_>) -> ExternalChatResult<SendProgress> {
        self.sends.enqueue(intent).await
    }

    async fn open_sends(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<SendProgress>> {
        self.sends.open_sends(chat_id, user).await
    }

    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>> {
        self.sends.sends_for(chat_id, user, ids).await
    }

    async fn delivery_states(
        &self,
        chat_id: Uuid,
        viewer: &str,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<(Uuid, DeliveryState)>> {
        self.sends.delivery_states(chat_id, viewer, messages).await
    }
}

/// A group's roster as the chat's side panel shows it.
fn members(info: &GroupInfo) -> ExternalChatMembers {
    ExternalChatMembers {
        name: info.name.clone(),
        participants: info
            .participants
            .iter()
            .map(|participant| ExternalChatParticipant {
                jid: participant.identity.jid.clone(),
                alternate_jid: participant.identity.alternate_jid.clone(),
                display_name: participant.identity.display_name.clone(),
                admin: participant.admin,
            })
            .collect(),
        announce: info.announce,
        observed_at: info.observed_at,
    }
}

/// Whether the person's own account can send in the chat, from its own
/// roster of the group. A direct chat has two people: only its owner's own
/// account is in it.
fn sending_facts(account: &AccountRef, chat: &ChatRef, roster: Option<&GroupInfo>) -> SendingFacts {
    if chat.kind == ExternalChatKind::Direct {
        let owner = account.user_id == chat.user_id;
        return SendingFacts {
            observing: owner,
            remote_member: owner,
            can_post: owner,
        };
    }
    let identity = account.identity.as_deref();
    SendingFacts {
        observing: roster.is_some(),
        remote_member: roster
            .zip(identity)
            .is_some_and(|(group, identity)| group.participant(identity).is_some()),
        can_post: roster
            .zip(identity)
            .is_some_and(|(group, identity)| group.can_post(identity)),
    }
}
