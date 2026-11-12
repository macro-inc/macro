//! Owner-bound sign-in, accounts and the Slack Connect catalogue, as served by
//! DSS. DSS never calls Slack: it records inputs and the session service
//! acts on them. Added chats are `external_chat`'s; [`super::provider`] adds
//! and sends.

use super::{models::*, ports::*};
use external_chat::domain::{models::*, ports::ExternalChatResult};
use macro_user_id::user_id::MacroUserIdStr;
use std::{collections::BTreeMap, sync::Arc};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// DSS use cases for a person's Slack sessions.
#[derive(Clone)]
pub struct SlackService {
    logins: Arc<dyn LoginRepository>,
    accounts: Arc<dyn AccountRepository>,
    catalogue: Arc<dyn CatalogueRepository>,
    sealer: Arc<dyn LoginInputSealer>,
}

impl SlackService {
    /// Wire adapters at the composition root.
    pub fn new<Repository, Sealer>(repository: Arc<Repository>, sealer: Arc<Sealer>) -> Self
    where
        Repository: LoginRepository + AccountRepository + CatalogueRepository + 'static,
        Sealer: LoginInputSealer + 'static,
    {
        Self {
            logins: repository.clone(),
            accounts: repository.clone(),
            catalogue: repository,
            sealer,
        }
    }

    /// Start an email sign-in; a replica asks Slack to email a code.
    #[tracing::instrument(name = "slack.linked.login.start", skip_all, err, fields(login_id))]
    pub async fn start_email_login(
        &self,
        user: &MacroUserIdStr<'_>,
        email: &str,
        authority: SendAuthority,
    ) -> ExternalChatResult<Login> {
        human(authority)?;
        let email = email.trim();
        if !lazy_regex::regex_is_match!(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) || email.len() > 320 {
            return Err(ExternalChatError::Invalid("enter a valid email address").into());
        }
        let login = self
            .logins
            .begin_login(
                user,
                LoginStart::Email {
                    email: email.to_owned(),
                },
            )
            .await?;
        tracing::Span::current().record("login_id", tracing::field::display(login.id));
        Ok(login)
    }

    /// Start from a pasted or desktop-captured session, sealed here at once;
    /// a replica checks each token with Slack.
    #[tracing::instrument(
        name = "slack.linked.login.session",
        skip_all,
        err,
        fields(login_id, source = ?submission.source, tokens = submission.tokens.len())
    )]
    pub async fn submit_session(
        &self,
        user: &MacroUserIdStr<'_>,
        submission: &SessionSubmission,
        authority: SendAuthority,
    ) -> ExternalChatResult<Login> {
        human(authority)?;
        validate_submission(submission)?;
        let attempt = Uuid::now_v7();
        let sealed = self.sealer.seal(user, attempt, submission).await?;
        let login = self
            .logins
            .begin_login(
                user,
                LoginStart::Session {
                    attempt,
                    source: submission.source,
                    sealed,
                },
            )
            .await?;
        tracing::Span::current().record("login_id", tracing::field::display(login.id));
        Ok(login)
    }

    /// Poll the person's attempt.
    pub async fn login(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<Login> {
        human(authority)?;
        self.logins.login(user, attempt).await
    }

    /// Answer the step the attempt waits in.
    #[tracing::instrument(
        name = "slack.linked.login.input",
        skip_all,
        err,
        fields(login_id = %attempt, step = <&'static str>::from(expected))
    )]
    pub async fn submit_login_input(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        expected: LoginStepName,
        input: LoginInput,
        authority: SendAuthority,
    ) -> ExternalChatResult<Login> {
        human(authority)?;
        let input = validate_input(expected, input)?;
        self.logins
            .submit_login_input(user, attempt, expected, input)
            .await
    }

    /// Cancel the person's attempt.
    #[tracing::instrument(name = "slack.linked.login.cancel", skip_all, err, fields(login_id = %attempt))]
    pub async fn cancel_login(
        &self,
        user: &MacroUserIdStr<'_>,
        attempt: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<Login> {
        human(authority)?;
        self.logins.cancel_login(user, attempt).await
    }

    /// Accounts Slack logged out whose owner hasn't been told yet.
    pub async fn ended_accounts(&self, limit: i64) -> ExternalChatResult<Vec<EndedAccount>> {
        self.accounts.ended_accounts(limit).await
    }

    /// The owner was told this generation ended.
    pub async fn ended_notified(&self, account: Uuid, generation: i64) -> ExternalChatResult<()> {
        self.accounts.ended_notified(account, generation).await
    }

    /// The person's accounts, in any state.
    pub async fn accounts(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<AccountList> {
        Ok(AccountList {
            accounts: self.accounts.accounts(user).await?,
        })
    }

    /// End consent for one account. History and established access remain.
    #[tracing::instrument(
        name = "slack.linked.disconnect",
        skip_all,
        err,
        fields(account_id = %account, generation, sign_out)
    )]
    pub async fn disconnect(
        &self,
        user: &MacroUserIdStr<'_>,
        account: Uuid,
        generation: i64,
        sign_out: bool,
        authority: SendAuthority,
    ) -> ExternalChatResult<bool> {
        human(authority)?;
        self.accounts
            .disconnect(user, account, generation, sign_out)
            .await
    }

    /// Import another page of a chat's earlier messages.
    #[tracing::instrument(
        name = "slack.linked.import_history",
        skip_all,
        err,
        fields(chat_id = %chat, started)
    )]
    pub async fn import_history(
        &self,
        user: &MacroUserIdStr<'_>,
        chat: Uuid,
        authority: SendAuthority,
    ) -> ExternalChatResult<HistoryImport> {
        human(authority)?;
        let started = self.accounts.import_history(user, chat).await?;
        tracing::Span::current().record("started", started);
        Ok(HistoryImport { started })
    }

    /// The person's Slack Connect conversations across their active
    /// accounts, one entry per conversation, newest activity first. Returns
    /// stored data and asks each account to refresh.
    #[tracing::instrument(
        name = "slack.linked.conversations",
        skip_all,
        err,
        fields(count, accounts)
    )]
    pub async fn conversations(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<ConversationList> {
        let accounts: Vec<Uuid> = self
            .accounts
            .accounts(user)
            .await?
            .into_iter()
            .filter(|account| account.state.is_active())
            .map(|account| account.id)
            .collect();
        tracing::Span::current().record("accounts", accounts.len());
        if accounts.is_empty() {
            return Err(ExternalChatError::Disconnected.into());
        }
        let refreshing = self.catalogue.request_catalogue_refresh(&accounts).await?;
        let entries = self.catalogue.catalogue(user).await?;
        let ids: Vec<String> = entries
            .iter()
            .map(|entry| entry.conversation_id.clone())
            .collect();
        let adoptions = self.catalogue.visible_adoptions(user, &ids).await?;
        let conversations = merge_catalogue(user, entries, &adoptions);
        tracing::Span::current().record("count", conversations.len());
        Ok(ConversationList {
            conversations,
            refreshing,
        })
    }
}

/// One entry per conversation: the accounts that see it, and the facts of
/// the newest-active one.
fn merge_catalogue(
    user: &MacroUserIdStr<'_>,
    entries: Vec<CatalogueEntry>,
    adoptions: &[VisibleAdoption],
) -> Vec<Conversation> {
    let mut by_id: BTreeMap<String, Vec<CatalogueEntry>> = BTreeMap::new();
    for entry in entries {
        by_id
            .entry(entry.conversation_id.clone())
            .or_default()
            .push(entry);
    }
    let mut conversations: Vec<Conversation> = by_id
        .into_iter()
        .filter_map(|(id, mut seen)| {
            seen.sort_by(|a, b| {
                b.is_member
                    .cmp(&a.is_member)
                    .then_with(|| b.last_activity_at.cmp(&a.last_activity_at))
            });
            let accounts = seen.iter().map(|entry| entry.account_id).collect();
            let unread_count = seen
                .iter()
                .map(|entry| entry.unread_count)
                .max()
                .unwrap_or(0);
            let entry = seen.into_iter().next()?;
            let (added, shared) = adoption_of(user, adoptions, &id);
            let reason = if entry.frozen_reason.is_some() {
                Some(CannotAddReason::Frozen)
            } else if entry.is_archived {
                Some(CannotAddReason::Archived)
            } else if !entry.is_member {
                Some(CannotAddReason::NotMember)
            } else {
                None
            };
            let open = added.is_none() && shared.is_none();
            Some(Conversation {
                name: display_name(&entry),
                remote_id: id,
                kind: entry.kind,
                topic: entry.topic,
                is_private: entry.is_private,
                is_archived: entry.is_archived,
                frozen: entry.frozen_reason.is_some(),
                connected_teams: entry.connected_teams,
                direct_person: entry.direct_person,
                accounts,
                last_activity_at: entry.last_activity_at,
                unread_count,
                can_add: open && reason.is_none(),
                cannot_add_reason: reason.filter(|_| open),
                added,
                shared,
            })
        })
        .collect();
    conversations.sort_by(|a, b| {
        b.last_activity_at
            .cmp(&a.last_activity_at)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    conversations
}

/// `#name` for a channel, the other person for a DM.
pub(crate) fn display_name(entry: &CatalogueEntry) -> String {
    match (&entry.direct_person, entry.kind) {
        (Some(person), ExternalChatKind::Direct) => person.name.clone(),
        _ if entry.name.is_empty() => "Slack conversation".to_owned(),
        (_, ExternalChatKind::Direct) => entry.name.clone(),
        (_, ExternalChatKind::Group) => format!("#{}", entry.name),
    }
}

/// The caller's own chat for a conversation, else someone else's shared with
/// them. A DM is the caller's own conversation: never shown as shared.
fn adoption_of(
    user: &MacroUserIdStr<'_>,
    adoptions: &[VisibleAdoption],
    conversation: &str,
) -> (Option<ChatReference>, Option<SharedChatReference>) {
    let mine = adoptions
        .iter()
        .find(|adoption| adoption.remote_id == conversation && adoption.owner_id == user.as_ref())
        .map(|adoption| ChatReference {
            id: adoption.id,
            name: adoption.name.clone(),
        });
    let shared = mine.is_none().then(|| {
        adoptions
            .iter()
            .filter(|_| !conversation.starts_with('D'))
            .find(|adoption| {
                adoption.remote_id == conversation && adoption.owner_id != user.as_ref()
            })
            .map(|adoption| SharedChatReference {
                id: adoption.id,
                name: adoption.name.clone(),
                owner_id: adoption.owner_id.clone(),
            })
    });
    (mine, shared.flatten())
}

/// Sign-in and account controls take the person's own session only.
pub(crate) fn human(authority: SendAuthority) -> ExternalChatResult<()> {
    match authority {
        SendAuthority::Human => Ok(()),
        SendAuthority::UserApiToken | SendAuthority::Automation => {
            Err(ExternalChatError::Forbidden.into())
        }
    }
}

fn validate_submission(submission: &SessionSubmission) -> ExternalChatResult<()> {
    if submission.tokens.is_empty() || submission.tokens.len() > LOGIN_WORKSPACE_LIMIT {
        return Err(ExternalChatError::Invalid("submit between 1 and 20 workspace tokens").into());
    }
    if submission
        .tokens
        .iter()
        .any(|token| !lazy_regex::regex_is_match!(r"^xox[cd]-[A-Za-z0-9-]{10,500}$", &token.token))
    {
        return Err(
            ExternalChatError::Invalid("a token is not a Slack xoxc- session token").into(),
        );
    }
    if submission.cookie.trim().is_empty() || submission.cookie.len() > 4096 {
        return Err(ExternalChatError::Invalid("the d cookie is missing").into());
    }
    if submission
        .tokens
        .iter()
        .filter_map(|token| token.team_id.as_deref())
        .any(|team| !lazy_regex::regex_is_match!(r"^[TE][A-Z0-9]{6,}$", team))
    {
        return Err(ExternalChatError::Invalid("a team id is not a Slack team id").into());
    }
    Ok(())
}

/// Check and normalize the input for the step it answers.
fn validate_input(expected: LoginStepName, input: LoginInput) -> ExternalChatResult<LoginInput> {
    let invalid = |message| Err(ExternalChatError::Invalid(message).into());
    match (expected, input) {
        (LoginStepName::Captcha, LoginInput::Captcha { solution }) => {
            let solution = solution.trim().to_owned();
            if solution.is_empty() || solution.len() > 8192 {
                return invalid("the captcha returned no solution");
            }
            Ok(LoginInput::Captcha { solution })
        }
        (LoginStepName::EmailCode, LoginInput::Code { code }) => {
            let code: String = code
                .trim()
                .chars()
                .filter(|character| *character != '-')
                .collect::<String>()
                .to_uppercase();
            if !lazy_regex::regex_is_match!(r"^[A-Z0-9]{6}$", &code) {
                return invalid("enter the six-character code Slack emailed you");
            }
            Ok(LoginInput::Code { code })
        }
        (LoginStepName::PickWorkspaces, LoginInput::Workspaces { mut team_ids }) => {
            team_ids.sort();
            team_ids.dedup();
            if team_ids.is_empty()
                || team_ids.len() > LOGIN_WORKSPACE_LIMIT
                || team_ids
                    .iter()
                    .any(|team| !lazy_regex::regex_is_match!(r"^[TE][A-Z0-9]{6,}$", team))
            {
                return invalid("choose between 1 and 20 workspaces");
            }
            Ok(LoginInput::Workspaces { team_ids })
        }
        (LoginStepName::TwoFactor, LoginInput::TwoFactor { code }) => {
            let code = code.trim().to_owned();
            if !lazy_regex::regex_is_match!(r"^[0-9]{6}$", &code) {
                return invalid("enter the six-digit code");
            }
            Ok(LoginInput::TwoFactor { code })
        }
        _ => Err(ExternalChatError::Conflict.into()),
    }
}
