//! Sub-routines: the routines a routine's runs created.

use super::*;

#[cfg(test)]
mod test;

/// Most finished one-time sub-routines a parent's list holds: the newest.
const MAX_FINISHED_LISTED: i64 = 200;

/// Admit one more sub-routine under `parent`, or refuse at the cap. Locks
/// the parent row until the transaction ends, so racing creates count each
/// other; the lock doesn't block the key-share lock an insert's foreign key
/// takes.
pub(super) async fn admit_child(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    parent: Uuid,
) -> Result<()> {
    let locked = sqlx::query_scalar!(
        r#"
        SELECT id FROM scheduled_action WHERE id = $1 AND parent_id IS NULL
        FOR NO KEY UPDATE
        "#,
        parent,
    )
    .fetch_optional(&mut **tx)
    .await?;
    if locked.is_none() {
        return Err(ActionPolicyError::NotFound.into());
    }
    // Finished one-time sub-routines have nothing left to run. The
    // predicate is the active-children index's, so they are never read.
    let active = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "active!" FROM scheduled_action
        WHERE parent_id = $1 AND parent_id IS NOT NULL
          AND NOT (trigger_type = 'once' AND next_run_at IS NULL)
        "#,
        parent,
    )
    .fetch_one(&mut **tx)
    .await?;
    if active >= MAX_ACTIVE_SUB_ROUTINES {
        return Err(ActionPolicyError::TooManySubRoutines.into());
    }
    Ok(())
}

/// A create that lost a race for its parent's key: the caller reads the
/// winner and updates it instead.
pub(super) fn key_taken(error: sqlx::Error) -> anyhow::Error {
    let taken = error
        .as_database_error()
        .is_some_and(|error| error.constraint() == Some("scheduled_action_parent_child_key_idx"));
    if taken {
        return ActionPolicyError::UpdateConflict.into();
    }
    error.into()
}

impl<B: BotFacts + 'static> SubRoutines for PgScheduledActionRepo<B> {
    async fn running_run(&self, routine: &Uuid) -> Result<Option<RunningRun>> {
        let row = sqlx::query!(
            r#"
            SELECT id, parent_id, owner, claim_token AS "run_id!"
            FROM scheduled_action
            WHERE id = $1 AND claim_token IS NOT NULL AND claimed >= $2
            "#,
            *routine,
            Utc::now() - MAX_ACTION_TIME,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(RunningRun {
                routine_id: row.id,
                parent_id: row.parent_id,
                owner: Owner::from_principal_str(&row.owner)?,
                run_id: row.run_id,
            })
        })
        .transpose()
    }

    async fn running_run_of_session(&self, session: &Uuid) -> Result<Option<RunningRun>> {
        let row = sqlx::query!(
            r#"
            SELECT id, parent_id, owner, claim_token AS "run_id!"
            FROM scheduled_action
            WHERE claim_token = $1 AND claimed >= $2
            "#,
            *session,
            Utc::now() - MAX_ACTION_TIME,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(RunningRun {
                routine_id: row.id,
                parent_id: row.parent_id,
                owner: Owner::from_principal_str(&row.owner)?,
                run_id: row.run_id,
            })
        })
        .transpose()
    }

    async fn children(&self, parent: &Uuid) -> Result<Vec<ScheduledAction>> {
        // Finished ones accumulate, so only the newest are read: run ids
        // are UUIDv7, so the parent index walks them newest first.
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            (SELECT id AS "id!", owner AS "owner!", name AS "name!", schedule, kind AS "kind!",
                    timezone, task AS "task!", claimed, created_at AS "created_at!",
                    updated_at AS "updated_at!", next_run_at, enabled AS "enabled!",
                    trigger_type AS "trigger_type!", event_filters,
                    configuration_revision AS "configuration_revision!", event_activated_at,
                    trigger_config, run_visibility AS "run_visibility!", template_id, appearance AS "appearance: _",
                    suggestion_id, description AS "description!", parent_id,
                    created_by_run_id, child_key, paused_by_parent AS "paused_by_parent!"
             FROM scheduled_action
             WHERE parent_id = $1 AND parent_id IS NOT NULL
               AND NOT (trigger_type = 'once' AND next_run_at IS NULL))
            UNION ALL
            (SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                    updated_at, next_run_at, enabled, trigger_type, event_filters,
                    configuration_revision, event_activated_at, trigger_config, run_visibility,
                    template_id, appearance, suggestion_id, description, parent_id, created_by_run_id,
                    child_key, paused_by_parent
             FROM scheduled_action
             WHERE parent_id = $1 AND trigger_type = 'once' AND next_run_at IS NULL
             ORDER BY created_by_run_id DESC
             LIMIT $2)
            "#,
            *parent,
            MAX_FINISHED_LISTED,
        )
        .fetch_all(&self.pool)
        .await?;
        let mut children: Vec<ScheduledAction> = rows
            .into_iter()
            .map(ScheduledAction::try_from)
            .collect::<Result<_>>()?;
        children.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then(left.id.cmp(&right.id))
        });
        Ok(children)
    }

    async fn active_children(&self, parents: &[Uuid]) -> Result<Vec<ScheduledAction>> {
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at, trigger_config, run_visibility, template_id, appearance AS "appearance: _", suggestion_id,
                   description, parent_id, created_by_run_id, child_key, paused_by_parent
            FROM scheduled_action
            WHERE parent_id = ANY($1) AND parent_id IS NOT NULL
              AND NOT (trigger_type = 'once' AND next_run_at IS NULL)
            ORDER BY created_at, id
            "#,
            parents,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ScheduledAction::try_from).collect()
    }

    async fn top_level_by_ids(&self, ids: &[Uuid]) -> Result<Vec<ScheduledAction>> {
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at, trigger_config, run_visibility, template_id, appearance AS "appearance: _", suggestion_id,
                   description, parent_id, created_by_run_id, child_key, paused_by_parent
            FROM scheduled_action
            WHERE id = ANY($1) AND parent_id IS NULL
            "#,
            ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ScheduledAction::try_from).collect()
    }

    async fn child_by_key(
        &self,
        parent: &Uuid,
        key: &SubRoutineKey,
    ) -> Result<Option<ScheduledAction>> {
        sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                   updated_at, next_run_at, enabled, trigger_type, event_filters,
                   configuration_revision, event_activated_at, trigger_config, run_visibility, template_id, appearance AS "appearance: _", suggestion_id,
                   description, parent_id, created_by_run_id, child_key, paused_by_parent
            FROM scheduled_action
            WHERE parent_id = $1 AND child_key = $2
            "#,
            *parent,
            key.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ScheduledAction::try_from)
        .transpose()
    }

    async fn detach(&self, id: &Uuid) -> Result<Option<ScheduledAction>> {
        sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE scheduled_action
            SET parent_id = NULL, created_by_run_id = NULL, child_key = NULL,
                paused_by_parent = FALSE, updated_at = now()
            WHERE id = $1 AND parent_id IS NOT NULL
            RETURNING id, owner, name, schedule, kind, timezone, task, claimed, created_at,
                      updated_at, next_run_at, enabled, trigger_type, event_filters,
                      configuration_revision, event_activated_at, trigger_config, run_visibility, template_id, appearance AS "appearance: _", suggestion_id,
                      description, parent_id, created_by_run_id, child_key, paused_by_parent
            "#,
            *id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ScheduledAction::try_from)
        .transpose()
    }

    async fn created_by_runs(
        &self,
        parent: &Uuid,
        runs: &[Uuid],
    ) -> Result<Vec<(Uuid, CreatedRoutine)>> {
        let rows = sqlx::query!(
            r#"
            SELECT id, name, created_by_run_id AS "run_id!"
            FROM scheduled_action
            WHERE parent_id = $1 AND created_by_run_id = ANY($2)
            ORDER BY created_at, id
            "#,
            *parent,
            runs,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let created = CreatedRoutine {
                    id: row.id,
                    name: row.name,
                };
                (row.run_id, created)
            })
            .collect())
    }
}
