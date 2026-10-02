//! Transaction-aware source binding for import composition roots.

use crate::domain::models::{ImportSourceBinding, SlackWorkspaceId};
use crate::domain::ports::{ImportError, Result};
use sqlx::PgExecutor;
use uuid::Uuid;

/// Bind the team's single Slack source on the caller's transaction/connection.
/// Known bindings are immutable; unknown bindings can be refined to a known source.
/// This helper lets archive job creation and provenance commit or roll back together.
pub async fn bind_source<'e>(
    executor: impl PgExecutor<'e>,
    team_id: Uuid,
    workspace_id: Option<&SlackWorkspaceId>,
    confirmed_unknown: bool,
) -> Result<ImportSourceBinding> {
    if workspace_id.is_none() && !confirmed_unknown {
        return Err(ImportError::SourceConfirmationRequired);
    }
    let row = sqlx::query!(
        r#"
        INSERT INTO import_source_binding (team_id, slack_workspace_id, confirmed_unknown_at)
        VALUES ($1, $2, CASE WHEN $2::text IS NULL AND $3 THEN now() END)
        ON CONFLICT (team_id) DO UPDATE
        SET slack_workspace_id = COALESCE(import_source_binding.slack_workspace_id, EXCLUDED.slack_workspace_id),
            confirmed_unknown_at = COALESCE(import_source_binding.confirmed_unknown_at, EXCLUDED.confirmed_unknown_at)
        WHERE import_source_binding.slack_workspace_id IS NULL
           OR EXCLUDED.slack_workspace_id IS NULL
           OR import_source_binding.slack_workspace_id = EXCLUDED.slack_workspace_id
        RETURNING slack_workspace_id, confirmed_unknown_at
        "#,
        team_id,
        workspace_id.map(SlackWorkspaceId::as_str),
        confirmed_unknown,
    )
    .fetch_optional(executor)
    .await?
    .ok_or(ImportError::SourceMismatch)?;
    Ok(ImportSourceBinding {
        workspace_id: row
            .slack_workspace_id
            .map(|id| SlackWorkspaceId::new(&id).ok_or(ImportError::SourceMismatch))
            .transpose()?,
        confirmed_unknown_at: row.confirmed_unknown_at,
    })
}
