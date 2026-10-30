//! Owner-bound account lifecycle and the WhatsApp chat list, as served by DSS.
//! Added chats are `external_chat`'s; [`super::provider`] adds and sends.

use super::{jid::PhoneNumber, models::*, ports::*};
use external_chat::domain::{models::*, ports::ExternalChatResult};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// DSS use cases for a person's linked WhatsApp account.
#[derive(Clone)]
pub struct WhatsAppService {
    accounts: Arc<dyn AccountRepository>,
    groups: Arc<dyn GroupRepository>,
}

impl WhatsAppService {
    /// Wire adapters at the composition root.
    pub fn new<R>(repository: Arc<R>) -> Self
    where
        R: AccountRepository + GroupRepository + 'static,
    {
        Self {
            accounts: repository.clone(),
            groups: repository,
        }
    }

    /// Personal settings never depend on workspace administration.
    pub async fn account(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Option<Account>> {
        self.accounts.owned_account(user).await
    }

    /// Start explicit owner consent. Replacement never inherits the old identity.
    #[tracing::instrument(name = "whatsapp.linked.connect", skip_all, err, fields(replace = replace, pairing_id, account_id))]
    pub async fn connect(
        &self,
        user: &MacroUserIdStr<'_>,
        replace: bool,
        authority: SendAuthority,
    ) -> ExternalChatResult<Pairing> {
        human(authority)?;
        let pairing = self.accounts.begin_pairing(user, replace).await?;
        let span = tracing::Span::current();
        span.record("pairing_id", tracing::field::display(pairing.id));
        span.record("account_id", tracing::field::display(pairing.account_id));
        Ok(pairing)
    }

    /// Poll the initiating person's transaction, including secret enrollment material.
    pub async fn pair_state(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<PairState> {
        human(authority)?;
        self.accounts.pair_state(user, pairing).await
    }

    /// Forward the owner's WebAuthn assertion for a transaction waiting on a
    /// passkey. The replica hands it to WhatsApp.
    #[tracing::instrument(name = "whatsapp.linked.passkey", skip_all, err, fields(pairing_id = %pairing))]
    pub async fn passkey(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
        response: &serde_json::Value,
        authority: SendAuthority,
    ) -> ExternalChatResult<()> {
        human(authority)?;
        if !response.is_object() || response.to_string().len() > PASSKEY_LIMIT_BYTES {
            return Err(ExternalChatError::Invalid("invalid passkey response").into());
        }
        self.accounts.submit_passkey(user, pairing, response).await
    }

    /// Cancel the initiating person's transaction; the replica stops pairing.
    #[tracing::instrument(name = "whatsapp.linked.cancel_pairing", skip_all, err, fields(pairing_id = %pairing))]
    pub async fn cancel(
        &self,
        user: &MacroUserIdStr<'_>,
        pairing: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<()> {
        human(authority)?;
        self.accounts.cancel_pairing(user, pairing).await
    }

    /// End observation consent. History and established entity access remain.
    #[tracing::instrument(name = "whatsapp.linked.disconnect", skip_all, err, fields(generation = generation))]
    pub async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        generation: i64,
        authority: SendAuthority,
    ) -> ExternalChatResult<Disconnect> {
        human(authority)?;
        let changed = self.accounts.disconnect(user, generation).await?;
        Ok(Disconnect {
            remote_unlink_requested: changed,
        })
    }

    /// The person's WhatsApp chat list, as WhatsApp Web shows it: groups and
    /// direct chats, newest activity first. Each chat says whether it is
    /// added, shared with the caller or addable; direct chats are addable (not
    /// your own chat) and never shown as shared. Returns stored data
    /// and requests a group refresh.
    #[tracing::instrument(
        name = "whatsapp.linked.chats",
        skip_all,
        err,
        fields(count, account_id)
    )]
    pub async fn chats(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<ChatList> {
        let (account, identity) = connected(self.accounts.as_ref(), user).await?;
        tracing::Span::current().record("account_id", tracing::field::display(account.id));
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
            let (added, shared) = adoption_of(user, &adoptions, &chat.jid);
            // Someone else's chat with the same person is their own
            // conversation, not this one.
            let shared = shared.filter(|_| chat.kind == ExternalChatKind::Group);
            let name = chat
                .name
                .clone()
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| chat_fallback_name(&chat.jid, chat.kind, &identity));
            let reason = match chat.kind {
                ExternalChatKind::Direct if chat.jid == identity => Some(CannotAdd::OwnChat),
                ExternalChatKind::Direct => None,
                // Listed by WhatsApp but not in the account's groups any more.
                ExternalChatKind::Group => Some(CannotAdd::NotInGroup),
            };
            let open = added.is_none() && shared.is_none();
            chats.push(Chat {
                name: if chat.jid == identity {
                    "You".to_owned()
                } else {
                    name
                },
                phone_number: super::jid::phone_number(&chat.jid),
                jid: chat.jid,
                kind: chat.kind,
                last_activity_at: chat.last_activity_at,
                archived: chat.archived,
                pinned: chat.pinned,
                can_add: open && reason.is_none(),
                cannot_add_reason: reason.filter(|_| open),
                added,
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
                        kind: ExternalChatKind::Group,
                        name: String::new(),
                        phone_number: None,
                        last_activity_at: None,
                        archived: false,
                        pinned: false,
                        added: None,
                        shared: None,
                        can_add: false,
                        cannot_add_reason: None,
                        community: None,
                    });
                    chats.len() - 1
                }
            };
            let chat = &mut chats[index];
            chat.kind = ExternalChatKind::Group;
            chat.name = info.display_name(&identity);
            (chat.added, chat.shared) = adoption_of(user, &adoptions, &info.jid);
            chat.community = info.community(
                info.community_jid
                    .as_ref()
                    .and_then(|parent| roster.iter().find(|group| &group.jid == parent)),
            );
            let reason = if info.community_parent {
                Some(CannotAdd::Community)
            } else if info.participant(&identity).is_none() {
                Some(CannotAdd::NotInGroup)
            } else {
                None
            };
            let open = chat.added.is_none() && chat.shared.is_none();
            chat.can_add = open && reason.is_none();
            chat.cannot_add_reason = reason.filter(|_| open);
        }
        chats.sort_by(|a, b| {
            b.last_activity_at
                .cmp(&a.last_activity_at)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        tracing::Span::current().record("count", chats.len());
        Ok(ChatList { chats })
    }

    /// Ask whether a phone number has a WhatsApp account, to start a direct
    /// chat with someone not in the chat list. Only on the owner's explicit
    /// action (a human session): WhatsApp bans accounts that query many
    /// numbers, so lookups are also limited per account.
    #[tracing::instrument(
        name = "whatsapp.linked.lookup",
        skip_all,
        err,
        fields(lookup_id, account_id)
    )]
    pub async fn lookup(
        &self,
        user: &MacroUserIdStr<'_>,
        phone_number: &str,
        authority: SendAuthority,
    ) -> ExternalChatResult<Lookup> {
        human(authority)?;
        let phone = PhoneNumber::parse(phone_number).ok_or(ExternalChatError::Invalid(
            "enter the phone number with its country code, starting with +",
        ))?;
        let (account, _) = connected(self.accounts.as_ref(), user).await?;
        let lookup = self.accounts.begin_lookup(&account, &phone).await?;
        let span = tracing::Span::current();
        span.record("lookup_id", tracing::field::display(lookup.id));
        span.record("account_id", tracing::field::display(account.id));
        Ok(lookup)
    }

    /// Poll the owner's lookup.
    pub async fn lookup_state(
        &self,
        user: &MacroUserIdStr<'_>,
        lookup: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<Lookup> {
        human(authority)?;
        let account = self
            .accounts
            .owned_account(user)
            .await?
            .ok_or(ExternalChatError::NotFound)?;
        self.accounts.lookup(account.id, lookup).await
    }

    /// Delete old participant receipts, old consumed pairings and lookups.
    pub async fn expire_retained(&self) -> ExternalChatResult<u64> {
        self.accounts.expire_retained().await
    }

    /// The Macro user who linked this account.
    pub async fn account_owner(&self, account: Uuid) -> ExternalChatResult<Option<String>> {
        self.accounts.account_owner(account).await
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

/// The person's connected account and its verified identity.
pub(crate) async fn connected(
    accounts: &dyn AccountRepository,
    user: &MacroUserIdStr<'_>,
) -> ExternalChatResult<(Account, String)> {
    let account = accounts
        .owned_account(user)
        .await?
        .filter(|a| a.state == AccountState::Connected)
        .ok_or(ExternalChatError::Disconnected)?;
    let identity = account
        .identity_jid
        .clone()
        .ok_or(ExternalChatError::Disconnected)?;
    Ok((account, identity))
}

/// The caller's own external chat for a WhatsApp chat, else someone else's
/// external chat for it that was shared with them.
fn adoption_of(
    user: &MacroUserIdStr<'_>,
    adoptions: &[VisibleAdoption],
    jid: &str,
) -> (Option<ChatReference>, Option<SharedChatReference>) {
    let mine = adoptions
        .iter()
        .find(|adoption| adoption.remote_id == jid && adoption.owner_id == user.as_ref())
        .map(|adoption| ChatReference {
            id: adoption.id,
            name: adoption.name.clone(),
        });
    let shared = mine.is_none().then(|| {
        adoptions
            .iter()
            .find(|adoption| adoption.remote_id == jid && adoption.owner_id != user.as_ref())
            .map(|adoption| SharedChatReference {
                id: adoption.id,
                name: adoption.name.clone(),
                owner_id: adoption.owner_id.clone(),
            })
    });
    (mine, shared.flatten())
}

/// A chat WhatsApp gave no name: a direct chat by its phone number.
pub(crate) fn chat_fallback_name(jid: &str, kind: ExternalChatKind, identity: &str) -> String {
    match kind {
        ExternalChatKind::Group => "WhatsApp group".to_owned(),
        ExternalChatKind::Direct if jid == identity => "You".to_owned(),
        ExternalChatKind::Direct => {
            super::jid::phone_number(jid).unwrap_or_else(|| "WhatsApp contact".to_owned())
        }
    }
}
