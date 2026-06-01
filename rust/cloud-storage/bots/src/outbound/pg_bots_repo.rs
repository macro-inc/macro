//! Postgres bot repository.

#[cfg(test)]
mod tests;

use crate::domain::{
    models::{
        AuthenticatedBot, Bot, BotId, BotKind, BotOwner, BotToken, BotTokenCandidate,
        CreateBotRequest, CreateBotTokenRequest, PatchBotRequest,
    },
    ports::BotRepo,
};
use anyhow::Context;
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
    bot_id.to_storage_string()
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
            id: BotId::from_uuid(row.id),
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
            bot_id: BotId::from_uuid(row.bot_id),
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
    token_hash: Vec<u8>,
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
        let bot_id = BotId::from_uuid(self.bot_id);
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
            token_hash: self.token_hash,
            bot: AuthenticatedBot { bot_id, kind },
        })
    }
}

fn map_bot_row(row: BotRow) -> anyhow::Result<Bot> {
    row.try_into()
}

fn map_token_row(row: BotTokenRow) -> BotToken {
    row.into()
}

impl BotRepo for PgBotsRepo {
    type Err = anyhow::Error;

    async fn create_owned_bot(
        &self,
        owner: BotOwner,
        created_by: MacroUserIdStr<'static>,
        req: CreateBotRequest,
    ) -> Result<Bot, Self::Err> {
        let bot_id = BotId::from_uuid(macro_uuid::generate_uuid_v7());
        let (owner_user_id, team_id) = match owner {
            BotOwner::User { user_id } => (Some(user_id), None),
            BotOwner::Team { team_id } => (None, Some(team_id)),
        };
        let row = sqlx::query_as!(
            BotRow,
            r#"
            INSERT INTO bots (
                id, kind, owner_user_id, team_id, name, handle, description, avatar_url, created_by
            )
            VALUES ($1, 'owned', $2, $3, $4, $5, $6, $7, $8)
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
                deleted_at
            "#,
            bot_id.as_uuid(),
            owner_user_id,
            team_id,
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
            created_by.as_ref(),
        )
        .fetch_one(&self.pool)
        .await
        .context("failed to create bot")?;

        map_bot_row(row)
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
                deleted_at
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
                deleted_at
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
                deleted_at
            "#,
            bot_id.as_uuid(),
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
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
                b.deleted_at
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
        token_hash: Vec<u8>,
        token_prefix: String,
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
            token_hash,
            token_prefix,
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

    async fn token_candidates(
        &self,
        token_prefix: &str,
    ) -> Result<Vec<BotTokenCandidate>, Self::Err> {
        let rows = sqlx::query_as!(
            TokenCandidateRow,
            r#"
            SELECT
                bt.id AS token_id,
                bt.bot_id,
                bt.token_hash,
                bt.token_prefix,
                bt.label,
                bt.last_used_at,
                bt.expires_at,
                bt.revoked_at,
                bt.created_at,
                b.kind
            FROM bot_tokens bt
            JOIN bots b ON b.id = bt.bot_id
            WHERE bt.token_prefix = $1
              AND b.deleted_at IS NULL
            "#,
            token_prefix,
        )
        .fetch_all(&self.pool)
        .await
        .context("failed to lookup bot token candidates")?;

        rows.into_iter()
            .map(TokenCandidateRow::into_candidate)
            .collect()
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
