//! Read-only mailbox projection for an authenticated human viewing a teammate.

use std::future::Future;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, EntityPermission, EntityType, TeamRole,
};
use feature_flags::FeatureFlags;
use macro_authorization::{CredentialAttribution, MacroUserAuthentication};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::inbox::{AGENT_INBOXES_FLAG, AgentInboxState, InboxRecord};
use super::ports::AgentAccounts;
use super::service::AGENT_TEAMMATES_FLAG;

#[cfg(test)]
mod test;

const MAX_PAGE_SIZE: u8 = 50;

/// The selected agent's actual mailbox binding, including the mailbox generation.
#[derive(Clone, PartialEq, Eq)]
pub struct MailboxIdentity {
    /// Owning team.
    pub team_id: Uuid,
    /// Owning agent account.
    pub agent: MacroUserIdStr<'static>,
    /// Macro mailbox ID.
    pub mailbox_id: Uuid,
}

/// An active mailbox and its provisioned address from the mailbox-owning service.
pub struct ActiveMailbox {
    /// Canonical binding.
    pub identity: MailboxIdentity,
    /// Exact provisioned address.
    pub address: String,
}

/// Address state for an authorized viewer.
#[derive(Debug, PartialEq, Eq)]
pub enum MailboxAddress {
    /// The active mailbox's bound address.
    Provisioned(String),
    /// The agent's inbox is being provisioned.
    InProgress,
    /// No readable address.
    Unavailable,
}

/// A normalized, case-insensitive subject and sender substring filter.
#[derive(Clone, Default, PartialEq, Eq)]
pub struct InboxFilter {
    subject: Option<String>,
    from: Option<String>,
}

impl InboxFilter {
    /// Normalize two optional terms. Whitespace-only terms are omitted.
    pub fn new(subject: Option<&str>, from: Option<&str>) -> Self {
        fn term(value: Option<&str>) -> Option<String> {
            value
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_lowercase)
        }

        Self {
            subject: term(subject),
            from: term(from),
        }
    }

    /// Whether an already scoped message matches both terms.
    pub fn matches(&self, message: &InboxMessage) -> bool {
        self.subject
            .as_ref()
            .is_none_or(|term| message.subject.to_lowercase().contains(term))
            && self
                .from
                .as_ref()
                .is_none_or(|term| message.from.to_lowercase().contains(term))
    }
}

/// A viewer's list item. The reference identifiers are local to the mailbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxMessage {
    /// Stable message reference and tie-breaker for paging.
    pub id: Uuid,
    /// Stable reference to the thread.
    pub thread_id: Uuid,
    /// Sender as recorded on the message.
    pub from: String,
    /// Subject as recorded on the message.
    pub subject: String,
    /// Time the message was recorded.
    pub received_at: DateTime<Utc>,
}

impl InboxMessage {
    /// Position in newest-first order, including the message-ID tie-breaker.
    pub fn position(&self) -> (DateTime<Utc>, Uuid) {
        (self.received_at, self.id)
    }
}

/// A source row, before checking its mailbox, direction and requested scope.
pub struct MailboxMessage {
    /// Canonical binding reported by the source.
    pub mailbox: MailboxIdentity,
    /// Whether the message was received by the selected mailbox.
    pub inbound: bool,
    /// Visible list fields once scoped.
    pub summary: InboxMessage,
    /// Untrusted plain text. List sources can omit it.
    pub text: Option<String>,
}

/// A checked thread message.
pub struct ThreadMessage {
    /// Display fields.
    pub summary: InboxMessage,
    /// Untrusted plain text, when available.
    pub text: Option<String>,
}

/// In-process continuation, usable only by the same viewer and query.
pub struct InboxCursor {
    viewer: MacroUserIdStr<'static>,
    mailbox: MailboxIdentity,
    filter: InboxFilter,
    after: (DateTime<Utc>, Uuid),
}

/// A page of visible inbox messages.
pub struct InboxPage {
    /// Visible rows, newest first. Its length counts only the visible page.
    pub items: Vec<InboxMessage>,
    /// Continuation when another visible row exists.
    pub next: Option<InboxCursor>,
}

/// A refused, stale or unavailable read. The error carries no mailbox metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("mailbox unavailable")]
pub struct MailboxUnavailable;

/// Direct human-session credentials paired with the same user's team receipt.
pub struct MailboxViewer {
    receipt: EntityAccessReceipt<AdminTeamRole>,
}

impl MailboxViewer {
    /// Verify the credential provenance and bind the receipt to its direct user.
    pub fn new(
        authentication: &MacroUserAuthentication,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Self, MailboxUnavailable> {
        if !authentication.is_human_session()
            || authentication.attribution() != CredentialAttribution::Person
            || receipt.get_authenticated_user().ok() != Some(&authentication.macro_user_id)
            || receipt.entity().entity_type != EntityType::Team
        {
            return Err(MailboxUnavailable);
        }
        Ok(Self { receipt })
    }
}

/// Read dependencies for the viewer projection.
pub trait MailboxReadSource: Send + Sync {
    /// Current role of a real human account on the exact team. Returns none
    /// for an agent account, missing account or absent membership.
    fn human_role(
        &self,
        viewer: &MacroUserIdStr<'_>,
        team: Uuid,
    ) -> impl Future<Output = Result<Option<TeamRole>, MailboxUnavailable>> + Send;

    /// Current mirror record, read without triggering lifecycle refresh.
    fn inbox_record(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<InboxRecord>, MailboxUnavailable>> + Send;

    /// Current canonical active mailbox and actual provisioned address for this binding.
    fn active_mailbox(
        &self,
        mailbox: &MailboxIdentity,
    ) -> impl Future<Output = Result<Option<ActiveMailbox>, MailboxUnavailable>> + Send;

    /// Return at most `limit` matching inbound rows of this mailbox, strictly
    /// newest first, after the given position (when present). Filter before
    /// applying the limit so only a visible lookahead can signal another page.
    fn list(
        &self,
        mailbox: &MailboxIdentity,
        filter: &InboxFilter,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: u8,
    ) -> impl Future<Output = Result<Vec<MailboxMessage>, MailboxUnavailable>> + Send;

    /// Return inbound messages of the exact thread in the selected mailbox.
    fn thread(
        &self,
        mailbox: &MailboxIdentity,
        thread: Uuid,
    ) -> impl Future<Output = Result<Vec<MailboxMessage>, MailboxUnavailable>> + Send;
}

enum MailboxState {
    Active(ActiveMailbox),
    InProgress,
    Unavailable,
}

impl MailboxState {
    fn active(self) -> Result<MailboxIdentity, MailboxUnavailable> {
        match self {
            Self::Active(mailbox) => Ok(mailbox.identity),
            Self::InProgress | Self::Unavailable => Err(MailboxUnavailable),
        }
    }
}

/// Authorizes and projects the selected teammate's mailbox for a human viewer.
pub struct MailboxReader<Source, Accounts, Flags> {
    source: Source,
    accounts: Accounts,
    flags: Flags,
}

impl<Source: MailboxReadSource, Accounts: AgentAccounts, Flags: FeatureFlags>
    MailboxReader<Source, Accounts, Flags>
{
    /// Compose the reader over read-only ports.
    pub fn new(source: Source, accounts: Accounts, flags: Flags) -> Self {
        Self {
            source,
            accounts,
            flags,
        }
    }

    async fn authorize<'a>(
        &self,
        viewer: &'a MailboxViewer,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(&'a MacroUserIdStr<'static>, Uuid), MailboxUnavailable> {
        let receipt = &viewer.receipt;
        let viewer = receipt
            .get_authenticated_user()
            .map_err(|_| MailboxUnavailable)?;
        let team = Uuid::parse_str(&receipt.entity().entity_id).map_err(|_| MailboxUnavailable)?;
        let role = self
            .source
            .human_role(viewer, team)
            .await?
            .ok_or(MailboxUnavailable)?;
        if !(EntityPermission::TeamRole { role }).satisfies::<AdminTeamRole>() {
            return Err(MailboxUnavailable);
        }

        let flags = self
            .flags
            .load(viewer)
            .await
            .map_err(|_| MailboxUnavailable)?;
        if !flags.is_enabled(AGENT_TEAMMATES_FLAG) || !flags.is_enabled(AGENT_INBOXES_FLAG) {
            return Err(MailboxUnavailable);
        }
        let account = self
            .accounts
            .account_facts(agent)
            .await
            .map_err(|_| MailboxUnavailable)?;
        if !account.is_some_and(|a| a.team_id == team && a.is_agent && a.member) {
            return Err(MailboxUnavailable);
        }

        Ok((viewer, team))
    }

    async fn binding(
        &self,
        team: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<MailboxState, MailboxUnavailable> {
        let Some(record) = self.source.inbox_record(agent).await? else {
            return Ok(MailboxState::Unavailable);
        };
        if record.team_id != team || &record.agent != agent {
            return Err(MailboxUnavailable);
        }
        if record.state == AgentInboxState::Provisioning {
            return Ok(MailboxState::InProgress);
        }
        let (AgentInboxState::Active, Some(mailbox_id), Some(address)) =
            (record.state, record.mailbox_id, record.address)
        else {
            return Ok(MailboxState::Unavailable);
        };
        let identity = MailboxIdentity {
            team_id: team,
            agent: record.agent,
            mailbox_id,
        };
        let active = self.source.active_mailbox(&identity).await?;
        Ok(match active {
            Some(active)
                if active.identity == identity
                    && !active.address.trim().is_empty()
                    && active.address == address =>
            {
                MailboxState::Active(active)
            }
            _ => MailboxState::Unavailable,
        })
    }

    /// Read the visible address state of the selected teammate.
    pub async fn address(
        &self,
        viewer: &MailboxViewer,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<MailboxAddress, MailboxUnavailable> {
        let (_, team) = self.authorize(viewer, agent).await?;
        Ok(match self.binding(team, agent).await? {
            MailboxState::Active(active) => MailboxAddress::Provisioned(active.address),
            MailboxState::InProgress => MailboxAddress::InProgress,
            MailboxState::Unavailable => MailboxAddress::Unavailable,
        })
    }

    /// Read one scoped inbox page, with a continuation derived from visible rows.
    pub async fn list(
        &self,
        viewer: &MailboxViewer,
        agent: &MacroUserIdStr<'_>,
        filter: InboxFilter,
        cursor: Option<&InboxCursor>,
        limit: u8,
    ) -> Result<InboxPage, MailboxUnavailable> {
        let (viewer, team) = self.authorize(viewer, agent).await?;
        let mailbox = self.binding(team, agent).await?.active()?;
        if !(1..=MAX_PAGE_SIZE).contains(&limit) {
            return Err(MailboxUnavailable);
        }
        if cursor.is_some_and(|c| &c.viewer != viewer || c.mailbox != mailbox || c.filter != filter)
        {
            return Err(MailboxUnavailable);
        }

        let after = cursor.map(|cursor| cursor.after);
        let rows = self
            .source
            .list(&mailbox, &filter, after, limit + 1)
            .await?;
        if rows.len() > usize::from(limit + 1) {
            return Err(MailboxUnavailable);
        }

        let mut previous = after;
        for row in &rows {
            let position = row.summary.position();
            if row.mailbox != mailbox
                || !row.inbound
                || !filter.matches(&row.summary)
                || previous.is_some_and(|previous| position >= previous)
            {
                return Err(MailboxUnavailable);
            }
            previous = Some(position);
        }

        let has_more = rows.len() > usize::from(limit);
        let items: Vec<_> = rows
            .into_iter()
            .take(usize::from(limit))
            .map(|row| row.summary)
            .collect();
        let next = items.last().filter(|_| has_more).map(|last| InboxCursor {
            viewer: viewer.clone(),
            mailbox,
            filter,
            after: last.position(),
        });
        Ok(InboxPage { items, next })
    }

    /// Read one thread under its own current authorization and exact mailbox.
    pub async fn thread(
        &self,
        viewer: &MailboxViewer,
        agent: &MacroUserIdStr<'_>,
        thread: Uuid,
    ) -> Result<Vec<ThreadMessage>, MailboxUnavailable> {
        let (_, team) = self.authorize(viewer, agent).await?;
        let mailbox = self.binding(team, agent).await?.active()?;
        let rows = self.source.thread(&mailbox, thread).await?;
        if rows.is_empty()
            || rows.iter().any(|row| {
                row.mailbox != mailbox || !row.inbound || row.summary.thread_id != thread
            })
        {
            return Err(MailboxUnavailable);
        }

        Ok(rows
            .into_iter()
            .map(|row| ThreadMessage {
                summary: row.summary,
                text: row.text,
            })
            .collect())
    }
}
