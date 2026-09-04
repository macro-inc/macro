//! Postgres persistence for product-provisioned personas.

use crate::domain::provisioning::ProvisionedAgent;
use anyhow::Context;
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgConnection;

/// Ensure that a user has the requested private provisioned persona.
///
/// Existing personas are never rewritten, so user edits survive credential
/// rotation and reconnects. The database uniqueness constraint makes retries
/// and concurrent requests converge on one persona. Reconnecting restores a
/// previously deleted provisioned persona with its edits intact.
///
/// # Errors
/// Returns an error when the persona or its agent configuration cannot be
/// persisted.
pub async fn ensure_private_provisioned_agent(
    connection: &mut PgConnection,
    owner: &MacroUserIdStr<'static>,
    provisioned: &ProvisionedAgent,
) -> anyhow::Result<BotId> {
    sqlx::query("SELECT set_config('macro.cursor_persona_lifecycle', 'enabled', true)")
        .execute(&mut *connection)
        .await?;
    let proposed_id = macro_uuid::generate_uuid_v7();
    let bot_id = sqlx::query_scalar!(
        r#"
        INSERT INTO bots (
            id, kind, owner_user_id, name, handle, description, created_by,
            has_agent, provisioning_key
        )
        VALUES ($1, 'owned', $2, $3, $4, $5, $2, true, $6)
        ON CONFLICT (owner_user_id, provisioning_key)
            WHERE provisioning_key IS NOT NULL
        DO UPDATE SET deleted_at = NULL, updated_at = NOW()
        RETURNING id
        "#,
        proposed_id,
        owner.as_ref(),
        provisioned.name,
        provisioned.handle,
        provisioned.description,
        provisioned.key,
    )
    .fetch_one(&mut *connection)
    .await
    .context("failed to ensure provisioned persona")?;

    sqlx::query!(
        r#"
        INSERT INTO agent_configs (
            bot_id, instructions, harness, default_model, channel_scope
        )
        VALUES ($1, '', $2, $3, 'all')
        ON CONFLICT (bot_id) DO NOTHING
        "#,
        bot_id,
        provisioned.harness,
        provisioned.default_model,
    )
    .execute(&mut *connection)
    .await
    .context("failed to ensure provisioned agent config")?;

    Ok(BotId::new_from_uuid(bot_id))
}

/// Deactivate a user's provisioned persona without deleting its identity or edits.
///
/// # Errors
/// Returns an error when the persona cannot be deactivated.
pub async fn deactivate_private_provisioned_agent(
    connection: &mut PgConnection,
    owner: &MacroUserIdStr<'static>,
    provisioning_key: &str,
) -> anyhow::Result<bool> {
    sqlx::query("SELECT set_config('macro.cursor_persona_lifecycle', 'enabled', true)")
        .execute(&mut *connection)
        .await?;
    let result = sqlx::query!(
        r#"
        UPDATE bots
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE owner_user_id = $1
          AND provisioning_key = $2
          AND deleted_at IS NULL
        "#,
        owner.as_ref(),
        provisioning_key,
    )
    .execute(connection)
    .await
    .context("failed to deactivate provisioned persona")?;
    Ok(result.rows_affected() > 0)
}
