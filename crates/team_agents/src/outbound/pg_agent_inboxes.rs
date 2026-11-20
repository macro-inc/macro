//! Postgres adapter for agents' inbox records (`team_agent_inboxes`).

use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::inbox::{
    AgentInboxFailure, AgentInboxRepository, AgentInboxState, InboxRecord, InboxUpdate,
};

#[cfg(test)]
mod test;

/// Errors from the inbox record store.
#[derive(Debug, thiserror::Error)]
pub enum PgAgentInboxesError {
    /// A query failed.
    #[error(transparent)]
    Sqlx(#[from] sqlx::Error),
    /// A stored row doesn't parse; the value is not repeated.
    #[error("a stored inbox row is malformed")]
    Malformed,
    /// The agent has no record to update.
    #[error("the agent has no inbox record")]
    Missing,
}

/// Agents' inbox records in MacroDB.
#[derive(Clone)]
pub struct PgAgentInboxes {
    pool: PgPool,
}

impl PgAgentInboxes {
    /// Build the store on a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct InboxRow {
    agent_user_id: String,
    team_id: Uuid,
    request_id: Uuid,
    mailbox_id: Option<Uuid>,
    address: Option<String>,
    state: String,
    last_error: Option<String>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<InboxRow> for InboxRecord {
    type Error = PgAgentInboxesError;

    fn try_from(row: InboxRow) -> Result<Self, Self::Error> {
        Ok(InboxRecord {
            agent: MacroUserIdStr::parse_from_str(&row.agent_user_id)
                .map(MacroUserIdStr::into_owned)
                .map_err(|_| PgAgentInboxesError::Malformed)?,
            team_id: row.team_id,
            request_id: row.request_id,
            mailbox_id: row.mailbox_id,
            address: row.address,
            state: row
                .state
                .parse::<AgentInboxState>()
                .map_err(|_| PgAgentInboxesError::Malformed)?,
            last_error: row
                .last_error
                .map(|error| error.parse::<AgentInboxFailure>())
                .transpose()
                .map_err(|_| PgAgentInboxesError::Malformed)?,
            updated_at: row.updated_at,
        })
    }
}

impl AgentInboxRepository for PgAgentInboxes {
    type Err = PgAgentInboxesError;

    #[tracing::instrument(skip_all, err)]
    async fn reserve(
        &self,
        agent: &MacroUserIdStr<'_>,
        team_id: Uuid,
        request_id: Uuid,
    ) -> Result<InboxRecord, Self::Err> {
        // The no-op update makes the conflicting row come back, so a racing
        // second reserve reads the first one's request id.
        let row = sqlx::query_as!(
            InboxRow,
            r#"
            INSERT INTO team_agent_inboxes (agent_user_id, team_id, request_id, state)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (agent_user_id) DO UPDATE SET agent_user_id = EXCLUDED.agent_user_id
            RETURNING agent_user_id, team_id, request_id, mailbox_id, address, state,
                      last_error, updated_at
            "#,
            agent.as_ref(),
            team_id,
            request_id,
            AgentInboxState::Provisioning.as_ref(),
        )
        .fetch_one(&self.pool)
        .await?;

        row.try_into()
    }

    #[tracing::instrument(skip_all, err)]
    async fn get(&self, agent: &MacroUserIdStr<'_>) -> Result<Option<InboxRecord>, Self::Err> {
        let row = sqlx::query_as!(
            InboxRow,
            r#"
            SELECT agent_user_id, team_id, request_id, mailbox_id, address, state,
                   last_error, updated_at
            FROM team_agent_inboxes
            WHERE agent_user_id = $1
            "#,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(InboxRecord::try_from).transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn list_for_team(&self, team_id: Uuid) -> Result<Vec<InboxRecord>, Self::Err> {
        let rows = sqlx::query_as!(
            InboxRow,
            r#"
            SELECT agent_user_id, team_id, request_id, mailbox_id, address, state,
                   last_error, updated_at
            FROM team_agent_inboxes
            WHERE team_id = $1
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(InboxRecord::try_from).collect()
    }

    #[tracing::instrument(skip_all, err)]
    async fn update(
        &self,
        agent: &MacroUserIdStr<'_>,
        update: &InboxUpdate,
    ) -> Result<InboxRecord, Self::Err> {
        let row = sqlx::query_as!(
            InboxRow,
            r#"
            UPDATE team_agent_inboxes
            SET mailbox_id = COALESCE($2, mailbox_id),
                address = COALESCE($3, address),
                state = $4,
                last_error = $5,
                updated_at = now()
            WHERE agent_user_id = $1
            RETURNING agent_user_id, team_id, request_id, mailbox_id, address, state,
                      last_error, updated_at
            "#,
            agent.as_ref(),
            update.mailbox_id,
            update.address,
            update.state.as_ref(),
            update.last_error.map(|error| error.as_ref().to_owned()),
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PgAgentInboxesError::Missing)?;

        row.try_into()
    }
}
