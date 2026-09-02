//! Postgres bot repository.

#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        Agent, AgentChannelScope, AuthenticatedBot, Bot, BotChannel, BotChannelType, BotId,
        BotKind, BotOwner, BotToken, BotTokenCandidate, CreateAgentRequest, CreateBotRequest,
        CreateBotTokenRequest, CreateChannelScopedBotRequest, HarnessId, HarnessOwner,
        PatchBotRequest, UpdateAgentRequest,
    },
    ports::BotRepo,
};
use anyhow::Context;
use bot_token::{HashedBotToken, hash_token};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Postgres implementation of [`BotRepo`].
#[derive(Debug, Clone)]
pub struct PgBotsRepo {
    pool: PgPool,
}

impl PgBotsRepo {
    /// Create a Postgres bot repository.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

fn principal_id(bot_id: BotId) -> String {
    bot_id.into_storage_id().to_string()
}

fn owner_columns(owner: BotOwner) -> (Option<String>, Option<Uuid>) {
    match owner {
        BotOwner::User { user_id } => (Some(user_id), None),
        BotOwner::Team { team_id } => (None, Some(team_id)),
    }
}

#[derive(Debug)]
struct BotRow {
    id: Uuid,
    kind: String,
    owner_user_id: Option<String>,
    team_id: Option<Uuid>,
    name: String,
    handle: String,
    description: Option<String>,
    avatar_url: Option<String>,
    created_by: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    has_agent: bool,
}

impl TryFrom<BotRow> for Bot {
    type Error = anyhow::Error;

    fn try_from(row: BotRow) -> Result<Self, Self::Error> {
        let kind = row
            .kind
            .parse()
            .map_err(|err: String| anyhow::anyhow!(err))?;
        let owner = match (row.owner_user_id, row.team_id) {
            (Some(user_id), None) => Some(BotOwner::User { user_id }),
            (None, Some(team_id)) => Some(BotOwner::Team { team_id }),
            _ => None,
        };

        Ok(Self {
            id: BotId::new_from_uuid(row.id),
            kind,
            owner,
            name: row.name,
            handle: row.handle,
            description: row.description,
            avatar_url: row.avatar_url,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            has_agent: row.has_agent,
        })
    }
}

#[derive(Debug)]
struct AgentRow {
    id: Uuid,
    kind: String,
    owner_user_id: Option<String>,
    team_id: Option<Uuid>,
    name: String,
    handle: String,
    description: Option<String>,
    avatar_url: Option<String>,
    created_by: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    deleted_at: Option<DateTime<Utc>>,
    has_agent: bool,
    instructions: String,
    harness: String,
    harness_id: Option<Uuid>,
    default_model: String,
    channel_scope: String,
    channel_ids: Vec<Uuid>,
}

impl TryFrom<AgentRow> for Agent {
    type Error = anyhow::Error;

    fn try_from(row: AgentRow) -> Result<Self, Self::Error> {
        let channel_scope = row
            .channel_scope
            .parse::<AgentChannelScope>()
            .map_err(anyhow::Error::msg)?;
        let bot = BotRow {
            id: row.id,
            kind: row.kind,
            owner_user_id: row.owner_user_id,
            team_id: row.team_id,
            name: row.name,
            handle: row.handle,
            description: row.description,
            avatar_url: row.avatar_url,
            created_by: row.created_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            has_agent: row.has_agent,
        }
        .try_into()?;

        Ok(Self {
            bot,
            instructions: row.instructions,
            harness: row.harness,
            harness_id: row.harness_id.map(HarnessId::new_from_uuid),
            default_model: row.default_model,
            channel_scope,
            channel_ids: row.channel_ids,
        })
    }
}

#[derive(Debug)]
struct BotChannelRow {
    channel_id: Uuid,
    name: Option<String>,
    channel_type: String,
    joined_at: DateTime<Utc>,
}

impl TryFrom<BotChannelRow> for BotChannel {
    type Error = anyhow::Error;

    fn try_from(row: BotChannelRow) -> Result<Self, Self::Error> {
        let channel_type = row
            .channel_type
            .parse::<BotChannelType>()
            .map_err(|err| anyhow::anyhow!(err))?;

        Ok(Self {
            channel_id: row.channel_id,
            name: row.name,
            channel_type,
            joined_at: row.joined_at,
        })
    }
}

#[derive(Debug)]
struct BotTokenRow {
    id: Uuid,
    bot_id: Uuid,
    token_prefix: String,
    label: Option<String>,
    last_used_at: Option<DateTime<Utc>>,
    expires_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

impl From<BotTokenRow> for BotToken {
    fn from(row: BotTokenRow) -> Self {
        Self {
            id: row.id,
            bot_id: BotId::new_from_uuid(row.bot_id),
            token_prefix: row.token_prefix,
            label: row.label,
            last_used_at: row.last_used_at,
            expires_at: row.expires_at,
            revoked_at: row.revoked_at,
            created_at: row.created_at,
        }
    }
}

#[derive(Debug)]
struct TokenCandidateRow {
    token_id: Uuid,
    bot_id: Uuid,
    token_prefix: String,
    label: Option<String>,
    last_used_at: Option<DateTime<Utc>>,
    expires_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    kind: String,
}

impl TokenCandidateRow {
    fn into_candidate(self) -> anyhow::Result<BotTokenCandidate> {
        let bot_id = BotId::new_from_uuid(self.bot_id);
        let kind = self
            .kind
            .parse::<BotKind>()
            .map_err(|err| anyhow::anyhow!(err))?;
        let token = BotToken {
            id: self.token_id,
            bot_id,
            token_prefix: self.token_prefix,
            label: self.label,
            last_used_at: self.last_used_at,
            expires_at: self.expires_at,
            revoked_at: self.revoked_at,
            created_at: self.created_at,
        };

        Ok(BotTokenCandidate {
            token,
            bot: AuthenticatedBot { bot_id, kind },
        })
    }
}

fn map_bot_row(row: BotRow) -> anyhow::Result<Bot> {
    row.try_into()
}

fn map_bot_channel_row(row: BotChannelRow) -> anyhow::Result<BotChannel> {
    row.try_into()
}

fn map_token_row(row: BotTokenRow) -> BotToken {
    row.into()
}

impl BotRepo for PgBotsRepo {
    type Err = anyhow::Error;

    async fn create_agent(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateAgentRequest,
    ) -> Result<Agent, Self::Err> {
        let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
        let (owner_user_id, team_id) = owner_columns(owner);
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to begin agent creation transaction")?;

        let bot_row = sqlx::query_as!(
            BotRow,
            r#"
            INSERT INTO bots (
                id, kind, owner_user_id, team_id, name, handle, description, avatar_url,
                created_by, has_agent
            )
            VALUES ($1, 'owned', $2, $3, $4, $5, $6, $7, $8, true)
            RETURNING
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            "#,
            bot_id.as_uuid(),
            owner_user_id,
            team_id,
            &req.name,
            &req.handle,
            req.description.as_deref(),
            req.avatar_url.as_deref(),
            created_by.as_ref(),
        )
        .fetch_one(&mut *tx)
        .await
        .context("failed to create agent bot")?;

        sqlx::query!(
            r#"
            INSERT INTO agent_configs (
                bot_id, instructions, harness, harness_id, default_model, channel_scope
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            bot_id.as_uuid(),
            &req.instructions,
            &req.harness,
            req.harness_id.map(HarnessId::as_uuid),
            &req.default_model,
            req.channel_scope.as_str(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to create agent config")?;

        if !req.channel_ids.is_empty() {
            let bot_principal = principal_id(bot_id);
            sqlx::query!(
                r#"
                INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
                SELECT channel_id, $2, 'member'::comms_participant_role, NULL
                FROM UNNEST($1::uuid[]) AS channel_id
                "#,
                &req.channel_ids,
                bot_principal,
            )
            .execute(&mut *tx)
            .await
            .context("failed to add agent to selected channels")?;
        }

        tx.commit()
            .await
            .context("failed to commit agent creation transaction")?;

        Ok(Agent {
            bot: map_bot_row(bot_row)?,
            instructions: req.instructions,
            harness: req.harness,
            harness_id: req.harness_id,
            default_model: req.default_model,
            channel_scope: req.channel_scope,
            channel_ids: req.channel_ids,
        })
    }

    async fn update_agent(
        &self,
        bot_id: BotId,
        owner: BotOwner,
        req: UpdateAgentRequest,
    ) -> Result<Option<Agent>, Self::Err> {
        let (owner_user_id, team_id) = owner_columns(owner);
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to begin agent update transaction")?;

        let Some(bot_row) = sqlx::query_as!(
            BotRow,
            r#"
            UPDATE bots
            SET owner_user_id = $2,
                team_id = $3,
                name = $4,
                handle = $5,
                description = $6,
                avatar_url = $7,
                updated_at = now()
            WHERE id = $1
              AND deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM agent_configs WHERE bot_id = $1)
            RETURNING
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            "#,
            bot_id.as_uuid(),
            owner_user_id,
            team_id,
            &req.name,
            &req.handle,
            req.description.as_deref(),
            req.avatar_url.as_deref(),
        )
        .fetch_optional(&mut *tx)
        .await
        .context("failed to update agent bot")?
        else {
            tx.rollback().await?;
            return Ok(None);
        };

        sqlx::query!(
            r#"
            UPDATE agent_configs
            SET instructions = $2,
                harness = $3,
                harness_id = $4,
                default_model = $5,
                channel_scope = $6,
                updated_at = now()
            WHERE bot_id = $1
            "#,
            bot_id.as_uuid(),
            &req.instructions,
            &req.harness,
            req.harness_id.map(HarnessId::as_uuid),
            &req.default_model,
            req.channel_scope.as_str(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to update agent config")?;

        let bot_principal = principal_id(bot_id);
        sqlx::query!(
            r#"
            UPDATE comms_channel_participants
            SET left_at = now()
            WHERE user_id = $1
              AND left_at IS NULL
            "#,
            &bot_principal,
        )
        .execute(&mut *tx)
        .await
        .context("failed to clear the agent's previous channels")?;

        if !req.channel_ids.is_empty() {
            sqlx::query!(
                r#"
                INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
                SELECT channel_id, $2, 'member'::comms_participant_role, NULL
                FROM UNNEST($1::uuid[]) AS channel_id
                ON CONFLICT (channel_id, user_id)
                DO UPDATE SET role = 'member'::comms_participant_role,
                              left_at = NULL,
                              joined_at = now()
                "#,
                &req.channel_ids,
                &bot_principal,
            )
            .execute(&mut *tx)
            .await
            .context("failed to replace the agent's selected channels")?;
        }

        tx.commit()
            .await
            .context("failed to commit agent update transaction")?;

        Ok(Some(Agent {
            bot: map_bot_row(bot_row)?,
            instructions: req.instructions,
            harness: req.harness,
            harness_id: req.harness_id,
            default_model: req.default_model,
            channel_scope: req.channel_scope,
            channel_ids: req.channel_ids,
        }))
    }

    async fn list_manageable_agents(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Agent>, Self::Err> {
        let rows = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT
                b.id,
                b.kind,
                b.owner_user_id,
                b.team_id,
                b.name,
                b.handle,
                b.description,
                b.avatar_url,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                b.has_agent,
                a.instructions,
                a.harness,
                a.harness_id,
                a.default_model,
                a.channel_scope,
                ARRAY(
                    SELECT p.channel_id
                    FROM comms_channel_participants p
                    WHERE p.user_id = 'bot|' || b.id::text
                      AND p.left_at IS NULL
                    ORDER BY p.channel_id
                ) AS "channel_ids!"
            FROM bots b
            INNER JOIN agent_configs a ON a.bot_id = b.id
            WHERE b.kind = 'owned'
              AND b.deleted_at IS NULL
              AND (
                b.owner_user_id = $1
                OR b.team_id IN (
                    SELECT team_id FROM team_user WHERE user_id = $1
                )
              )
            ORDER BY b.created_at ASC, b.id ASC
            "#,
            caller.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list manageable agents")?;

        rows.into_iter().map(Agent::try_from).collect()
    }

    async fn user_has_channels(
        &self,
        caller: MacroUserIdStr<'static>,
        channel_ids: &[Uuid],
    ) -> Result<bool, Self::Err> {
        sqlx::query_scalar!(
            r#"
            SELECT COUNT(DISTINCT channel_id) = CARDINALITY($2::uuid[]) AS "has_channels!"
            FROM comms_channel_participants
            WHERE user_id = $1
              AND channel_id = ANY($2::uuid[])
              AND left_at IS NULL
            "#,
            caller.as_ref(),
            channel_ids,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check agent channel membership")
    }

    async fn create_owned_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> Result<Bot, Self::Err> {
        let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
        let (owner_user_id, team_id) = owner_columns(owner);
        let row = sqlx::query_as!(
            BotRow,
            r#"
            INSERT INTO bots (
                id, kind, owner_user_id, team_id, name, handle, description, avatar_url,
                created_by, has_agent
            )
            VALUES ($1, 'owned', $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false))
            RETURNING
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            "#,
            bot_id.as_uuid(),
            owner_user_id,
            team_id,
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
            created_by.as_ref(),
            req.has_agent,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to create bot")?;

        map_bot_row(row)
    }

    async fn create_channel_scoped_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        channel_id: Uuid,
        token: HashedBotToken,
        req: CreateChannelScopedBotRequest,
    ) -> Result<(Bot, BotToken), Self::Err> {
        let bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
        let token_id = macro_uuid::generate_uuid_v7();
        let (owner_user_id, team_id) = owner_columns(owner);
        let mut tx = self
            .pool
            .begin()
            .await
            .context("failed to begin channel-scoped bot transaction")?;

        let bot_row = sqlx::query_as!(
            BotRow,
            r#"
            INSERT INTO bots (
                id, kind, owner_user_id, team_id, name, handle, description, avatar_url,
                created_by, has_agent
            )
            VALUES ($1, 'owned', $2, $3, $4, $5, $6, $7, $8, COALESCE($9, false))
            RETURNING
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            "#,
            bot_id.as_uuid(),
            owner_user_id,
            team_id,
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
            created_by.as_ref(),
            req.has_agent,
        )
        .fetch_one(&mut *tx)
        .await
        .context("failed to create channel-scoped bot")?;

        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
            VALUES ($1, $2, 'member'::comms_participant_role, NULL)
            "#,
            channel_id,
            principal_id(bot_id),
        )
        .execute(&mut *tx)
        .await
        .context("failed to add channel-scoped bot to channel")?;

        let token_row = sqlx::query_as!(
            BotTokenRow,
            r#"
            INSERT INTO bot_tokens (
                id, bot_id, token_hash, token_prefix, label, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, bot_id, token_prefix, label, last_used_at, expires_at, revoked_at, created_at
            "#,
            token_id,
            bot_id.as_uuid(),
            &token.hash[..],
            token.prefix,
            req.token_label,
            req.token_expires_at,
        )
        .fetch_one(&mut *tx)
        .await
        .context("failed to create channel-scoped bot token")?;

        let bot = map_bot_row(bot_row)?;
        let token = map_token_row(token_row);
        tx.commit()
            .await
            .context("failed to commit channel-scoped bot transaction")?;

        Ok((bot, token))
    }

    async fn list_manageable_bots(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<Vec<Bot>, Self::Err> {
        let rows = sqlx::query_as!(
            BotRow,
            r#"
            SELECT
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            FROM bots
            WHERE kind = 'owned'
              AND deleted_at IS NULL
              AND (
                owner_user_id = $1
                OR team_id IN (
                    SELECT team_id FROM team_user WHERE user_id = $1
                )
              )
            ORDER BY created_at ASC, id ASC
            "#,
            caller.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list manageable bots")?;
        rows.into_iter().map(map_bot_row).collect()
    }

    async fn get_bot(&self, bot_id: BotId) -> Result<Option<Bot>, Self::Err> {
        // First-party bots are compile-time constants with no row, so they are
        // answered from the registry rather than looked up and missed.
        if let Some(system) = bot_id::system_bot(bot_id) {
            return Ok(Some(Bot::system(system)));
        }
        let row = sqlx::query_as!(
            BotRow,
            r#"
            SELECT
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            FROM bots
            WHERE id = $1
              AND deleted_at IS NULL
            "#,
            bot_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to get bot")?;
        row.map(map_bot_row).transpose()
    }

    async fn get_agent(&self, bot_id: BotId) -> Result<Option<Agent>, Self::Err> {
        let row = sqlx::query_as!(
            AgentRow,
            r#"
            SELECT
                b.id,
                b.kind,
                b.owner_user_id,
                b.team_id,
                b.name,
                b.handle,
                b.description,
                b.avatar_url,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                b.has_agent,
                a.instructions,
                a.harness,
                a.harness_id,
                a.default_model,
                a.channel_scope,
                ARRAY(
                    SELECT p.channel_id
                    FROM comms_channel_participants p
                    WHERE p.user_id = 'bot|' || b.id::text
                      AND p.left_at IS NULL
                    ORDER BY p.channel_id
                ) AS "channel_ids!"
            FROM bots b
            INNER JOIN agent_configs a ON a.bot_id = b.id
            WHERE b.id = $1
              AND b.kind = 'owned'
              AND b.deleted_at IS NULL
            "#,
            bot_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to get agent")?;

        row.map(Agent::try_from).transpose()
    }

    async fn get_harness_owner(
        &self,
        harness_id: HarnessId,
    ) -> Result<Option<HarnessOwner>, Self::Err> {
        let row = sqlx::query!(
            r#"
            SELECT owner_user_id, team_id
            FROM harnesses
            WHERE id = $1 AND deleted_at IS NULL
            "#,
            harness_id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to fetch harness owner")?;

        row.map(|row| match (row.owner_user_id, row.team_id) {
            (Some(user_id), None) => Ok(HarnessOwner::User { user_id }),
            (None, Some(team_id)) => Ok(HarnessOwner::Team { team_id }),
            // Unreachable: harnesses_owner_check enforces exactly one owner.
            _ => Err(anyhow::anyhow!("harness {harness_id} violates owner xor")),
        })
        .transpose()
    }

    async fn user_has_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let has_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1 AND team_id = $2
            ) AS "has_team!"
            "#,
            caller.as_ref(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check team membership")?;
        Ok(has_team)
    }

    async fn bot_active_in_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<bool, Self::Err> {
        let is_active = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM comms_channel_participants
                WHERE channel_id = $1
                  AND user_id = $2
                  AND left_at IS NULL
            ) AS "is_active!"
            "#,
            channel_id,
            principal_id(bot_id),
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check bot channel membership")?;

        Ok(is_active)
    }

    async fn user_can_administer_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let can_administer = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1
                  AND team_id = $2
                  AND team_role IN ('admin'::team_role, 'owner'::team_role)
            ) AS "can_administer!"
            "#,
            caller.as_ref(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check team administration permission")?;
        Ok(can_administer)
    }

    async fn user_owns_team(
        &self,
        caller: MacroUserIdStr<'static>,
        team_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let owns_team = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM team_user
                WHERE user_id = $1
                  AND team_id = $2
                  AND team_role = 'owner'::team_role
            ) AS "owns_team!"
            "#,
            caller.as_ref(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to check team ownership")?;
        Ok(owns_team)
    }

    async fn patch_bot(
        &self,
        bot_id: BotId,
        req: PatchBotRequest,
    ) -> Result<Option<Bot>, Self::Err> {
        let row = sqlx::query_as!(
            BotRow,
            r#"
            UPDATE bots
            SET name = COALESCE($2, name),
                handle = COALESCE($3, handle),
                description = COALESCE($4, description),
                avatar_url = COALESCE($5, avatar_url),
                has_agent = COALESCE($6, has_agent),
                updated_at = now()
            WHERE id = $1
              AND deleted_at IS NULL
            RETURNING
                id,
                kind,
                owner_user_id,
                team_id,
                name,
                handle,
                description,
                avatar_url,
                created_by,
                created_at,
                updated_at,
                deleted_at,
                has_agent
            "#,
            bot_id.as_uuid(),
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
            req.has_agent,
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to patch bot")?;
        row.map(map_bot_row).transpose()
    }

    async fn delete_bot(&self, bot_id: BotId) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query!(
            r#"
            UPDATE bots
            SET deleted_at = now(), updated_at = now()
            WHERE id = $1
              AND deleted_at IS NULL
            "#,
            bot_id.as_uuid(),
        )
        .execute(&mut *tx)
        .await
        .context("failed to soft-delete bot")?;

        if result.rows_affected() > 0 {
            sqlx::query!(
                r#"
                UPDATE comms_channel_participants
                SET left_at = now()
                WHERE user_id = $1
                  AND left_at IS NULL
                "#,
                principal_id(bot_id),
            )
            .execute(&mut *tx)
            .await
            .context("failed to remove deleted bot from channels")?;
        }

        tx.commit().await?;
        Ok(result.rows_affected() > 0)
    }

    async fn add_bot_to_channel(&self, channel_id: Uuid, bot_id: BotId) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
            VALUES ($1, $2, 'member'::comms_participant_role, NULL)
            ON CONFLICT (channel_id, user_id)
            DO UPDATE SET role = 'member'::comms_participant_role,
                          left_at = NULL,
                          joined_at = now()
            "#,
            channel_id,
            principal_id(bot_id),
        )
        .execute(&self.pool)
        .await
        .context("failed to add bot to channel")?;
        Ok(())
    }

    async fn remove_bot_from_channel(
        &self,
        channel_id: Uuid,
        bot_id: BotId,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE comms_channel_participants
            SET left_at = now()
            WHERE channel_id = $1
              AND user_id = $2
              AND left_at IS NULL
            "#,
            channel_id,
            principal_id(bot_id),
        )
        .execute(&self.pool)
        .await
        .context("failed to remove bot from channel")?;
        Ok(result.rows_affected() > 0)
    }

    async fn list_bot_channels(&self, bot_id: BotId) -> Result<Vec<BotChannel>, Self::Err> {
        let rows = sqlx::query_as!(
            BotChannelRow,
            r#"
            SELECT
                c.id AS channel_id,
                c.name,
                c.channel_type::text AS "channel_type!",
                cp.joined_at
            FROM comms_channel_participants cp
            JOIN comms_channels c ON c.id = cp.channel_id
            WHERE cp.user_id = $1
              AND cp.left_at IS NULL
            ORDER BY cp.joined_at ASC, c.id ASC
            "#,
            principal_id(bot_id),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list bot channels")?;
        rows.into_iter().map(map_bot_channel_row).collect()
    }

    async fn list_channel_bots(&self, channel_id: Uuid) -> Result<Vec<Bot>, Self::Err> {
        let rows = sqlx::query_as!(
            BotRow,
            r#"
            SELECT
                b.id,
                b.kind,
                b.owner_user_id,
                b.team_id,
                b.name,
                b.handle,
                b.description,
                b.avatar_url,
                b.created_by,
                b.created_at,
                b.updated_at,
                b.deleted_at,
                b.has_agent
            FROM bots b
            JOIN comms_channel_participants cp
              ON cp.user_id = ('bot|' || b.id::text)
            WHERE cp.channel_id = $1
              AND cp.left_at IS NULL
              AND b.deleted_at IS NULL
            ORDER BY b.created_at ASC, b.id ASC
            "#,
            channel_id,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list channel bots")?;
        rows.into_iter().map(map_bot_row).collect()
    }

    async fn create_token(
        &self,
        bot_id: BotId,
        token: HashedBotToken,
        req: CreateBotTokenRequest,
    ) -> Result<BotToken, Self::Err> {
        let token_id = macro_uuid::generate_uuid_v7();
        let row = sqlx::query_as!(
            BotTokenRow,
            r#"
            INSERT INTO bot_tokens (
                id, bot_id, token_hash, token_prefix, label, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, bot_id, token_prefix, label, last_used_at, expires_at, revoked_at, created_at
            "#,
            token_id,
            bot_id.as_uuid(),
            &token.hash[..],
            token.prefix,
            req.label,
            req.expires_at,
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to create bot token")?;
        Ok(map_token_row(row))
    }

    async fn list_tokens(&self, bot_id: BotId) -> Result<Vec<BotToken>, Self::Err> {
        let rows = sqlx::query_as!(
            BotTokenRow,
            r#"
            SELECT id, bot_id, token_prefix, label, last_used_at, expires_at, revoked_at, created_at
            FROM bot_tokens
            WHERE bot_id = $1
              AND revoked_at IS NULL
            ORDER BY created_at DESC, id DESC
            "#,
            bot_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to list bot tokens")?;
        Ok(rows.into_iter().map(map_token_row).collect())
    }

    async fn revoke_token(&self, bot_id: BotId, token_id: Uuid) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"
            UPDATE bot_tokens
            SET revoked_at = now()
            WHERE id = $1
              AND bot_id = $2
              AND revoked_at IS NULL
            "#,
            token_id,
            bot_id.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .context("failed to revoke bot token")?;
        Ok(result.rows_affected() > 0)
    }

    async fn token_candidate(&self, token: &str) -> Result<Option<BotTokenCandidate>, Self::Err> {
        let token_hash = hash_token(token);
        let row = sqlx::query_as!(
            TokenCandidateRow,
            r#"
            SELECT
                bt.id AS token_id,
                bt.bot_id,
                bt.token_prefix,
                bt.label,
                bt.last_used_at,
                bt.expires_at,
                bt.revoked_at,
                bt.created_at,
                b.kind
            FROM bot_tokens bt
            JOIN bots b ON b.id = bt.bot_id
            WHERE bt.token_hash = $1
              AND b.deleted_at IS NULL
            "#,
            &token_hash[..],
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to lookup bot token candidate")?;

        row.map(TokenCandidateRow::into_candidate).transpose()
    }

    async fn channel_token_candidate(
        &self,
        channel_id: Uuid,
        token: &str,
    ) -> Result<Option<BotTokenCandidate>, Self::Err> {
        let token_hash = hash_token(token);
        let row = sqlx::query_as!(
            TokenCandidateRow,
            r#"
            SELECT
                bt.id AS token_id,
                bt.bot_id,
                bt.token_prefix,
                bt.label,
                bt.last_used_at,
                bt.expires_at,
                bt.revoked_at,
                bt.created_at,
                b.kind
            FROM bot_tokens bt
            JOIN bots b ON b.id = bt.bot_id
            JOIN comms_channel_participants cp
              ON cp.channel_id = $1
             AND cp.user_id = ('bot|' || b.id::text)
             AND cp.left_at IS NULL
            WHERE bt.token_hash = $2
              AND b.deleted_at IS NULL
            "#,
            channel_id,
            &token_hash[..],
        )
        .fetch_optional(&self.pool)
        .await
        .context("failed to lookup channel bot token candidate")?;

        row.map(TokenCandidateRow::into_candidate).transpose()
    }

    async fn mark_token_used(&self, token_id: Uuid) -> Result<(), Self::Err> {
        sqlx::query!(
            r#"
            UPDATE bot_tokens
            SET last_used_at = now()
            WHERE id = $1
            "#,
            token_id,
        )
        .execute(&self.pool)
        .await
        .context("failed to mark bot token used")?;
        Ok(())
    }
}
