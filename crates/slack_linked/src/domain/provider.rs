//! Slack as an external chat provider: which conversations a person can add,
//! who can send in them, their members and names, and the `slack_send`
//! outbox the session service dispatches.
//!
//! A person may have several Slack accounts (one per workspace), while
//! `external_chat` asks for one account per person: [`SlackProvider::account`]
//! answers with the person's oldest active account, and the per-chat facts
//! (`sending_facts`, the sending account of `enqueue_send`) use whichever of
//! the person's accounts observes each chat.

use super::{models::*, ports::*, service::display_name};
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

/// The person's Slack sessions behind external chats.
#[derive(Clone)]
pub struct SlackProvider {
    accounts: Arc<dyn AccountRepository>,
    catalogue: Arc<dyn CatalogueRepository>,
    adoptions: Arc<dyn AdoptionRepository>,
    sends: Arc<dyn SendRepository>,
}

impl SlackProvider {
    /// Wire adapters at the composition root.
    pub fn new<Repository>(repository: Arc<Repository>) -> Self
    where
        Repository:
            AccountRepository + CatalogueRepository + AdoptionRepository + SendRepository + 'static,
    {
        Self {
            accounts: repository.clone(),
            catalogue: repository.clone(),
            adoptions: repository.clone(),
            sends: repository,
        }
    }
}

#[async_trait]
impl ChatProvider for SlackProvider {
    fn capabilities(&self, _chat: &ChatRef) -> Capabilities {
        // Slack keeps several reactions per person, so a reaction adds one and
        // RemoveReaction takes one away.
        Capabilities {
            mutations: vec![
                Mutation::Reaction,
                Mutation::RemoveReaction,
                Mutation::Edit,
                Mutation::Delete,
            ],
            threads: true,
            ..Capabilities::default()
        }
    }

    /// The owner's read position goes back to Slack, from every account of
    /// theirs that observes the chat.
    async fn read_advanced(
        &self,
        chat: &ChatRef,
        read: &external_chat::domain::timeline::ReadAdvance,
    ) -> ExternalChatResult<()> {
        self.sends.queue_read_mark(chat, read).await
    }

    /// Each mention is a Slack user id that the mrkdwn text writes as
    /// `<@U…>`, the way Slack encodes it.
    fn validate_mentions(&self, text: &str, mentions: &[String]) -> ExternalChatResult<()> {
        if mentions.len() > MENTION_LIMIT {
            return Err(ExternalChatError::Invalid("too many mentions in one message").into());
        }
        for mention in mentions {
            if !lazy_regex::regex_is_match!(r"^[UW][A-Z0-9]{6,}$", mention) {
                return Err(ExternalChatError::Invalid("a mention is not a Slack user").into());
            }
            if !text.contains(&format!("<@{mention}>")) {
                return Err(ExternalChatError::Invalid(
                    "a mentioned person is not named in the text",
                )
                .into());
            }
        }
        Ok(())
    }

    async fn account(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Option<AccountRef>> {
        let accounts = self.accounts.accounts(user).await?;
        let active = accounts.iter().find(|account| account.state.is_active());
        Ok(active.or(accounts.first()).map(|account| AccountRef {
            id: account.id,
            user_id: user.as_ref().to_owned(),
            identity: account.slack_user_id.clone(),
            connected: account.state.is_active(),
            generation: account.authorization_generation,
        }))
    }

    async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>> {
        self.accounts.account_owner(account).await
    }

    async fn sending_facts(
        &self,
        account: &AccountRef,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<SendingFacts>> {
        let facts = self
            .catalogue
            .sending_facts(&account.user_id, chats)
            .await?;
        Ok(facts
            .into_iter()
            .map(|(observing, can_post)| SendingFacts {
                observing,
                remote_member: observing,
                can_post,
            })
            .collect())
    }

    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>> {
        Ok(vec![None; chats.len()])
    }

    /// Slack pictures aren't imported yet: initials.
    async fn pictures(&self, chats: &[ChatRef]) -> ExternalChatResult<Vec<Option<Uuid>>> {
        Ok(vec![None; chats.len()])
    }

    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<Members>> {
        Ok(self.catalogue.members(chat).await?.map(|members| Members {
            disappearing_seconds: None,
            members: ExternalChatMembers {
                name: members.name,
                participants: members
                    .people
                    .into_iter()
                    .map(|person| ExternalChatParticipant {
                        jid: person.slack_user_id,
                        alternate_jid: None,
                        display_name: Some(person.name.clone()),
                        name: match person.team {
                            Some(team) => format!("{} ({})", person.name, team.name),
                            None => person.name,
                        },
                        admin: false,
                        picture_file_id: None,
                    })
                    .collect(),
                announce: false,
                observed_at: members.observed_at,
            },
        }))
    }

    async fn people(
        &self,
        chat: &ChatRef,
        ids: &[String],
        persons: &[Uuid],
    ) -> ExternalChatResult<People> {
        self.catalogue.people(chat, ids, persons).await
    }

    async fn request_refresh(&self, chat: &ChatRef, viewer: &str) -> ExternalChatResult<()> {
        let accounts = self.catalogue.chat_accounts(chat.id, viewer).await?;
        self.catalogue.request_catalogue_refresh(&accounts).await?;
        Ok(())
    }

    /// Add a Slack Connect conversation from the person's catalogue as their
    /// own external chat, observed by every active account of theirs that
    /// sees it. Adding it again returns the existing one.
    #[tracing::instrument(
        name = "slack.linked.adopt",
        skip_all,
        err,
        fields(chat_id, created, kind, accounts)
    )]
    async fn adopt(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &AddChat,
    ) -> ExternalChatResult<ChatRef> {
        match request.provider {
            ExternalChatProvider::Slack => {}
            ExternalChatProvider::WhatsApp => {
                return Err(ExternalChatError::Invalid("not a Slack conversation").into());
            }
        }
        let accounts: Vec<Account> = self
            .accounts
            .accounts(user)
            .await?
            .into_iter()
            .filter(|account| account.state.is_active())
            .collect();
        if accounts.is_empty() {
            return Err(ExternalChatError::Disconnected.into());
        }
        let seen: Vec<CatalogueEntry> = self
            .catalogue
            .catalogue(user)
            .await?
            .into_iter()
            .filter(|entry| entry.conversation_id == request.remote_id)
            .collect();
        let entry = seen
            .iter()
            .find(|entry| entry.is_member)
            .ok_or(ExternalChatError::CannotAdd(CannotAdd::NotMember))?;
        if entry.kind != request.kind {
            return Err(ExternalChatError::Invalid("the chat kind does not match its id").into());
        }
        if entry.frozen_reason.is_some() {
            return Err(ExternalChatError::CannotAdd(CannotAdd::Frozen).into());
        }
        if entry.is_archived {
            return Err(ExternalChatError::CannotAdd(CannotAdd::Archived).into());
        }
        let observers: Vec<(Uuid, i64)> = seen
            .iter()
            .filter(|entry| entry.is_member)
            .filter_map(|entry| {
                accounts
                    .iter()
                    .find(|account| account.id == entry.account_id)
                    .map(|account| (account.id, account.authorization_generation))
            })
            .collect();
        let name = display_name(entry);
        let adopted = self
            .adoptions
            .adopt(AdoptionRecord {
                user,
                conversation_id: &request.remote_id,
                kind: entry.kind,
                name: &name,
                accounts: &observers,
            })
            .await?;
        let span = tracing::Span::current();
        span.record("chat_id", tracing::field::display(adopted.chat.id));
        span.record("created", adopted.created);
        span.record("kind", entry.kind.as_ref());
        span.record("accounts", observers.len());
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
