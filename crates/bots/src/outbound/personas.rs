//! Postgres queries for personas: agent-backed, team-scoped system bots and
//! their `bot_agent_config` rows.
//!
//! Free functions over a pool rather than a second repository type: they are
//! part of [`BotRepo`](crate::domain::ports::BotRepo)'s surface, but keeping
//! them out of `pg_bots_repo.rs` keeps that file from outgrowing a reviewer.

#[cfg(test)]
mod test;

use anyhow::Context;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    AgentConfig, AgentModel, Bot, BotId, BotKind, BotOwner, CreatePersonaRequest, Harness,
    MentionableBot, PatchPersonaRequest, Persona,
};

/// A persona row: the bot identity joined to its agent configuration.
#[derive(Debug)]
struct PersonaRow {
    id: Uuid,
    team_id: Option<Uuid>,
    name: String,
    handle: String,
    description: Option<String>,
    avatar_url: Option<String>,
    created_by: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    harness: String,
    model: String,
    system_prompt: Option<String>,
    repo_url: Option<String>,
}

impl TryFrom<PersonaRow> for Persona {
    type Error = anyhow::Error;

    fn try_from(row: PersonaRow) -> Result<Self, Self::Error> {
        let harness = row
            .harness
            .parse::<Harness>()
            .map_err(|err| anyhow::anyhow!(err))?;
        let model = row
            .model
            .parse::<AgentModel>()
            .map_err(|err| anyhow::anyhow!(err))?;

        Ok(Self {
            bot: Bot {
                id: BotId::new_from_uuid(row.id),
                kind: BotKind::System,
                owner: row.team_id.map(|team_id| BotOwner::Team { team_id }),
                name: row.name,
                handle: row.handle,
                description: row.description,
                avatar_url: row.avatar_url,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: None,
                has_agent: true,
            },
            agent: AgentConfig {
                harness,
                model,
                system_prompt: row.system_prompt,
                repo_url: row.repo_url,
            },
        })
    }
}

/// Create the bot row and its config together: a persona without config would
/// be an agent-backed bot the harness cannot launch.
pub(super) async fn create_persona(
    pool: &PgPool,
    created_by: MacroUserIdStr<'static>,
    req: CreatePersonaRequest,
) -> Result<Persona, anyhow::Error> {
    let bot_id = macro_uuid::generate_uuid_v7();
    let mut tx = pool.begin().await.context("failed to begin transaction")?;

    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, team_id, name, handle, description, avatar_url, created_by, has_agent)
        VALUES ($1, 'system', $2, $3, $4, $5, $6, $7, true)
        "#,
        bot_id,
        req.team_id,
        req.name,
        req.handle,
        req.description,
        req.avatar_url,
        created_by.as_ref(),
    )
    .execute(&mut *tx)
    .await
    .context("failed to create persona bot")?;

    sqlx::query!(
        r#"
        INSERT INTO bot_agent_config (bot_id, harness, model, system_prompt, repo_url)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        bot_id,
        req.agent.harness.as_str(),
        req.agent.model.as_str(),
        req.agent.system_prompt,
        req.agent.repo_url,
    )
    .execute(&mut *tx)
    .await
    .context("failed to create persona agent config")?;

    tx.commit().await.context("failed to commit persona")?;

    get_persona(pool, BotId::new_from_uuid(bot_id))
        .await?
        .context("persona vanished immediately after creation")
}

pub(super) async fn list_personas(
    pool: &PgPool,
    caller: MacroUserIdStr<'static>,
) -> Result<Vec<Persona>, anyhow::Error> {
    let rows = sqlx::query_as!(
        PersonaRow,
        r#"
        SELECT
            b.id,
            b.team_id,
            b.name,
            b.handle,
            b.description,
            b.avatar_url,
            b.created_by,
            b.created_at,
            b.updated_at,
            c.harness,
            c.model,
            c.system_prompt,
            c.repo_url
        FROM bots b
        JOIN bot_agent_config c ON c.bot_id = b.id
        WHERE b.kind = 'system'
          AND b.deleted_at IS NULL
          AND b.team_id IN (SELECT team_id FROM team_user WHERE user_id = $1)
        ORDER BY b.created_at ASC, b.id ASC
        "#,
        caller.as_ref(),
    )
    .fetch_all(pool)
    .await
    .context("failed to list personas")?;

    rows.into_iter().map(Persona::try_from).collect()
}

pub(super) async fn get_persona(
    pool: &PgPool,
    bot_id: BotId,
) -> Result<Option<Persona>, anyhow::Error> {
    let row = sqlx::query_as!(
        PersonaRow,
        r#"
        SELECT
            b.id,
            b.team_id,
            b.name,
            b.handle,
            b.description,
            b.avatar_url,
            b.created_by,
            b.created_at,
            b.updated_at,
            c.harness,
            c.model,
            c.system_prompt,
            c.repo_url
        FROM bots b
        JOIN bot_agent_config c ON c.bot_id = b.id
        WHERE b.id = $1
          AND b.deleted_at IS NULL
        "#,
        bot_id.as_uuid(),
    )
    .fetch_optional(pool)
    .await
    .context("failed to get persona")?;

    row.map(Persona::try_from).transpose()
}

/// Patch identity fields, and replace the agent config wholesale when one is
/// supplied. Absent profile fields keep their current value; an absent `agent`
/// leaves the configuration untouched.
pub(super) async fn patch_persona(
    pool: &PgPool,
    bot_id: BotId,
    req: PatchPersonaRequest,
) -> Result<Option<Persona>, anyhow::Error> {
    let mut tx = pool.begin().await.context("failed to begin transaction")?;

    let updated = sqlx::query_scalar!(
        r#"
        UPDATE bots
        SET name = COALESCE($2, name),
            handle = COALESCE($3, handle),
            description = COALESCE($4, description),
            avatar_url = COALESCE($5, avatar_url),
            updated_at = now()
        WHERE id = $1
          AND kind = 'system'
          AND deleted_at IS NULL
        RETURNING id
        "#,
        bot_id.as_uuid(),
        req.name,
        req.handle,
        req.description,
        req.avatar_url,
    )
    .fetch_optional(&mut *tx)
    .await
    .context("failed to patch persona bot")?;

    if updated.is_none() {
        return Ok(None);
    }

    if let Some(agent) = req.agent {
        sqlx::query!(
            r#"
            UPDATE bot_agent_config
            SET harness = $2,
                model = $3,
                system_prompt = $4,
                repo_url = $5,
                updated_at = now()
            WHERE bot_id = $1
            "#,
            bot_id.as_uuid(),
            agent.harness.as_str(),
            agent.model.as_str(),
            agent.system_prompt,
            agent.repo_url,
        )
        .execute(&mut *tx)
        .await
        .context("failed to patch persona agent config")?;
    }

    tx.commit()
        .await
        .context("failed to commit persona patch")?;

    get_persona(pool, bot_id).await
}

pub(super) async fn agent_config(
    pool: &PgPool,
    bot_id: BotId,
) -> Result<Option<AgentConfig>, anyhow::Error> {
    let row = sqlx::query!(
        r#"
        SELECT c.harness, c.model, c.system_prompt, c.repo_url
        FROM bot_agent_config c
        JOIN bots b ON b.id = c.bot_id
        WHERE c.bot_id = $1
          AND b.deleted_at IS NULL
        "#,
        bot_id.as_uuid(),
    )
    .fetch_optional(pool)
    .await
    .context("failed to read agent config")?;

    row.map(|row| {
        Ok(AgentConfig {
            harness: row
                .harness
                .parse::<Harness>()
                .map_err(|err| anyhow::anyhow!(err))?,
            model: row
                .model
                .parse::<AgentModel>()
                .map_err(|err| anyhow::anyhow!(err))?,
            system_prompt: row.system_prompt,
            repo_url: row.repo_url,
        })
    })
    .transpose()
}

/// The ownerless first-party system bots plus the personas of every team the
/// caller belongs to. Membership, not administration: mentioning a persona is
/// not managing it.
pub(super) async fn list_mentionable_bots(
    pool: &PgPool,
    caller: MacroUserIdStr<'static>,
) -> Result<Vec<MentionableBot>, anyhow::Error> {
    let rows = sqlx::query!(
        r#"
        SELECT id, name, handle, avatar_url
        FROM bots
        WHERE kind = 'system'
          AND deleted_at IS NULL
          AND (
            team_id IS NULL
            OR team_id IN (SELECT team_id FROM team_user WHERE user_id = $1)
          )
        ORDER BY name ASC, id ASC
        "#,
        caller.as_ref(),
    )
    .fetch_all(pool)
    .await
    .context("failed to list mentionable bots")?;

    Ok(rows
        .into_iter()
        .map(|row| MentionableBot {
            id: BotId::new_from_uuid(row.id),
            name: row.name,
            handle: row.handle,
            avatar_url: row.avatar_url,
        })
        .collect())
}
