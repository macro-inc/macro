//! A dedicated local Brain Email fixture. Postgres owns identity and access;
//! the fixed synthetic content is served in process.

use std::sync::Arc;

use account_manager::{
    domain::ports::AccountManagerRepo, outbound::pg_account_manager_repo::PgAccountManagerRepo,
};
use agent_mailbox::{domain::models::AgentMailboxId, outbound::pg::PgAgentMailboxRepository};
use chrono::{DateTime, Utc};
use entity_access::domain::{models::TeamRole, ports::EntityAccessService};
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_authorization::MacroAuthorizationState;
use macro_env::Environment;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::{PgPool, postgres::PgConnectOptions};
use team_agents::{
    domain::{
        inbox::{AGENT_INBOXES_FLAG, AgentInboxRepository, InboxRecord},
        mailbox_read::{
            ActiveMailbox, InboxFilter, InboxMessage, MailboxIdentity, MailboxMessage,
            MailboxReadSource, MailboxReader, MailboxUnavailable,
        },
        service::AGENT_TEAMMATES_FLAG,
    },
    inbound::brain_mailbox::BrainMailboxRouterState,
    outbound::{pg_agent_inboxes::PgAgentInboxes, pg_team_agents_repo::PgTeamAgentsRepo},
};
use uuid::Uuid;

use crate::api::context::{AuthorizationService, EntityAccessServiceType};

const DATABASE: &str = "macro_brain_email_fixture";
const OWNER: &str = "macro|brain-owner@example.com";
const ADMIN: &str = "macro|brain-admin@example.com";
const AGENT: &str = "macro|brain-teammate@example.com";
const TEAM: Uuid = uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900001");
const MAILBOX: Uuid = uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900002");
const THREAD: Uuid = uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900003");

pub(crate) type BrainMailboxState = BrainMailboxRouterState<
    LocalBrainMailboxSource,
    PgTeamAgentsRepo,
    LocalBrainMailboxFlags,
    EntityAccessServiceType,
    AuthorizationService,
>;

/// The local build and the dedicated database must both be selected.
fn enabled(environment: Environment, database: &PgConnectOptions) -> bool {
    cfg!(feature = "local")
        && matches!(environment, Environment::Local)
        && database.get_database() == Some(DATABASE)
        && matches!(database.get_host(), "127.0.0.1" | "::1")
        && database.get_socket().is_none()
}

pub(crate) fn configure(
    environment: Environment,
    pool: &PgPool,
    access: Arc<EntityAccessServiceType>,
    authorization: MacroAuthorizationState<AuthorizationService>,
) -> Option<BrainMailboxState> {
    if !enabled(environment, &pool.connect_options()) {
        return None;
    }
    let reader = MailboxReader::new(
        LocalBrainMailboxSource {
            accounts: PgAccountManagerRepo::new(pool.clone()),
            inboxes: PgAgentInboxes::new(pool.clone()),
            mailboxes: PgAgentMailboxRepository::new(pool.clone()),
            access: access.clone(),
        },
        PgTeamAgentsRepo::new(pool.clone()),
        LocalBrainMailboxFlags,
    );
    Some(BrainMailboxRouterState::new(reader, access, authorization))
}

pub(crate) struct LocalBrainMailboxFlags;

impl FeatureFlags for LocalBrainMailboxFlags {
    async fn load(&self, viewer: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let enabled = matches!(viewer.as_ref(), OWNER | ADMIN);
        Ok(FlagSnapshot::new([
            (AGENT_TEAMMATES_FLAG.to_owned(), FlagValue::Boolean(enabled)),
            (AGENT_INBOXES_FLAG.to_owned(), FlagValue::Boolean(enabled)),
        ]))
    }
}

pub(crate) struct LocalBrainMailboxSource {
    accounts: PgAccountManagerRepo,
    inboxes: PgAgentInboxes,
    mailboxes: PgAgentMailboxRepository,
    access: Arc<EntityAccessServiceType>,
}

fn fixture_messages(mailbox: &MailboxIdentity) -> Result<[MailboxMessage; 2], MailboxUnavailable> {
    if mailbox.agent.as_ref() != AGENT || mailbox.team_id != TEAM || mailbox.mailbox_id != MAILBOX {
        return Err(MailboxUnavailable);
    }
    let message = |id, subject: &str, from: &str, time, body: &str| MailboxMessage {
        mailbox: mailbox.clone(),
        inbound: true,
        summary: InboxMessage {
            id,
            thread_id: THREAD,
            from: from.to_owned(),
            subject: subject.to_owned(),
            received_at: time,
        },
        text: Some(body.to_owned()),
    };
    Ok([
        message(
            uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900005"),
            "Fixture status update",
            "sender@example.org",
            DateTime::UNIX_EPOCH + chrono::TimeDelta::minutes(1),
            "The local review fixture is ready.",
        ),
        message(
            uuid::uuid!("63e74f20-5f3a-4d94-98c9-bb35cb900004"),
            "Fixture status",
            "sender@example.org",
            DateTime::UNIX_EPOCH,
            "An earlier synthetic message in the same thread.",
        ),
    ])
}

impl MailboxReadSource for LocalBrainMailboxSource {
    async fn human_role(
        &self,
        viewer: &MacroUserIdStr<'_>,
        team: Uuid,
    ) -> Result<Option<TeamRole>, MailboxUnavailable> {
        if team != TEAM {
            return Ok(None);
        }
        if self
            .accounts
            .is_agent(viewer)
            .await
            .map_err(|_| MailboxUnavailable)?
            != Some(false)
        {
            return Ok(None);
        }
        let membership = self
            .access
            .get_user_team(viewer)
            .await
            .map_err(|_| MailboxUnavailable)?;
        Ok(membership
            .filter(|member| member.team_id == team)
            .map(|member| member.role))
    }

    async fn inbox_record(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<InboxRecord>, MailboxUnavailable> {
        if agent.as_ref() != AGENT {
            return Ok(None);
        }
        let record = self
            .inboxes
            .get(agent)
            .await
            .map_err(|_| MailboxUnavailable)?;
        Ok(record.filter(|inbox| inbox.fake_provider))
    }

    async fn active_mailbox(
        &self,
        identity: &MailboxIdentity,
    ) -> Result<Option<ActiveMailbox>, MailboxUnavailable> {
        let record = self
            .mailboxes
            .active_address(AgentMailboxId(identity.mailbox_id))
            .await
            .map_err(|_| MailboxUnavailable)?;
        Ok(record.map(|record| ActiveMailbox {
            identity: MailboxIdentity {
                team_id: record.team.0,
                agent: record.agent,
                mailbox_id: record.id.0,
            },
            address: record.address,
        }))
    }

    async fn list(
        &self,
        mailbox: &MailboxIdentity,
        filter: &InboxFilter,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: u8,
    ) -> Result<Vec<MailboxMessage>, MailboxUnavailable> {
        Ok(fixture_messages(mailbox)?
            .into_iter()
            .filter(|row| {
                filter.matches(&row.summary)
                    && after.is_none_or(|after| row.summary.position() < after)
            })
            .take(usize::from(limit))
            .collect())
    }

    async fn thread(
        &self,
        mailbox: &MailboxIdentity,
        thread: Uuid,
    ) -> Result<Vec<MailboxMessage>, MailboxUnavailable> {
        if thread != THREAD {
            return Ok(Vec::new());
        }
        Ok(fixture_messages(mailbox)?.into_iter().rev().collect())
    }
}

#[cfg(all(test, feature = "local"))]
mod test;
