//! PostgreSQL implementation of the [`ChannelLabelsRepo`] port.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::{
    ChannelLabel, ChannelLabelRule, ChannelLabelsScope, LabelWriteOutcome, SetChannelLabelOutcome,
    SmartTagChannelMatch, SmartTagPreview,
};
use crate::domain::ports::ChannelLabelsRepo;

/// Postgres-backed channel labels repository.
#[derive(Debug, Clone)]
pub struct PgChannelLabelsRepo {
    pool: PgPool,
}

impl PgChannelLabelsRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres channel labels repository.
#[derive(Debug, thiserror::Error)]
pub enum ChannelLabelsRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Postgres unique-violation SQLSTATE.
const UNIQUE_VIOLATION: &str = "23505";

fn is_unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|db| db.code())
        .is_some_and(|code| code == UNIQUE_VIOLATION)
}

struct LabelRow {
    id: Uuid,
    team_id: Option<Uuid>,
    name: String,
    name_contains: Option<String>,
    sort_order: f64,
    channel_ids: Vec<Uuid>,
    channel_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<LabelRow> for ChannelLabel {
    fn from(row: LabelRow) -> Self {
        ChannelLabel {
            id: row.id,
            team_id: row.team_id,
            name: row.name,
            rule: row
                .name_contains
                .map(|contains| ChannelLabelRule::Name { contains }),
            sort_order: row.sort_order,
            channel_ids: row.channel_ids,
            channel_count: row.channel_count,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl PgChannelLabelsRepo {
    /// Labels of `scope` (optionally just `label_id`) with the channels
    /// `viewer` participates in, in manual order.
    async fn load_labels(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Option<Uuid>,
        viewer: &MacroUserIdStr<'_>,
    ) -> Result<Vec<ChannelLabel>, ChannelLabelsRepoErr> {
        let scope_key = scope.key();
        // Visible channels are those the viewer currently participates in;
        // channel names of anything else never leave the database. Channels
        // come back A→Z so every member sees the same order inside a label.
        let rows = sqlx::query_as!(
            LabelRow,
            r#"
            WITH labels AS (
                SELECT l.*, ARRAY(
                    SELECT c.id
                    FROM comms_channels c
                    JOIN comms_channel_participants p
                        ON p.channel_id = c.id AND p.user_id = $3 AND p.left_at IS NULL
                    WHERE c.channel_type = 'team'
                    AND (l.team_id IS NULL OR c.team_id = l.team_id)
                    AND ((
                        l.name_contains IS NULL AND EXISTS (
                            SELECT 1 FROM channel_label_channel lc
                            WHERE lc.label_id = l.id AND lc.channel_id = c.id
                        )
                    ) OR (
                        l.name_contains IS NOT NULL
                        AND strpos(lower(c.name), lower(l.name_contains)) > 0
                    ))
                    ORDER BY lower(c.name), c.id
                ) AS visible_ids
                FROM channel_label l
                WHERE l.scope_key = $1 AND ($2::uuid IS NULL OR l.id = $2)
            )
            SELECT
                l.id as "id!",
                l.team_id as "team_id?",
                l.name as "name!",
                l.name_contains as "name_contains?",
                l.sort_order as "sort_order!",
                l.created_at as "created_at!",
                l.updated_at as "updated_at!",
                l.visible_ids as "channel_ids!: Vec<Uuid>",
                CASE WHEN l.name_contains IS NULL THEN
                    (SELECT COUNT(*) FROM channel_label_channel lc
                     JOIN comms_channels c ON c.id = lc.channel_id
                     WHERE lc.label_id = l.id AND c.channel_type = 'team'
                         AND (l.team_id IS NULL OR c.team_id = l.team_id))
                    ELSE cardinality(l.visible_ids)::bigint END as "channel_count!"
            FROM labels l
            ORDER BY l.sort_order, l.created_at, l.id
            "#,
            scope_key,
            label_id,
            viewer.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(ChannelLabel::from).collect())
    }
}

impl ChannelLabelsRepo for PgChannelLabelsRepo {
    type Err = ChannelLabelsRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn list_labels(
        &self,
        scope: &ChannelLabelsScope,
        viewer: &MacroUserIdStr<'_>,
    ) -> Result<Vec<ChannelLabel>, Self::Err> {
        self.load_labels(scope, None, viewer).await
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        viewer: &MacroUserIdStr<'_>,
    ) -> Result<Option<ChannelLabel>, Self::Err> {
        Ok(self.load_labels(scope, Some(label_id), viewer).await?.pop())
    }

    #[tracing::instrument(err, skip(self))]
    async fn create_label(
        &self,
        scope: &ChannelLabelsScope,
        name: &str,
        channel_ids: &[Uuid],
        viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> Result<LabelWriteOutcome, Self::Err> {
        let scope_key = scope.key();
        let team_id = scope.team_id();
        let user_id = scope.owner_id();
        let name_contains = rule.map(ChannelLabelRule::name_contains);
        let mut tx = self.pool.begin().await?;
        let validity = validate_channels(&mut tx, channel_ids, viewer, Some(scope)).await?;
        if validity != SetChannelLabelOutcome::Updated {
            return Ok(LabelWriteOutcome::InvalidChannel(validity));
        }
        let new_id = Uuid::now_v7();
        let id = sqlx::query_scalar!(
            r#"
            INSERT INTO channel_label (id, team_id, user_id, name, name_contains, sort_order)
            VALUES ($1, $2, $3, $4, $6,
                COALESCE((SELECT MAX(sort_order) + 1 FROM channel_label WHERE scope_key = $5), 0))
            ON CONFLICT DO NOTHING
            RETURNING id
            "#,
            new_id,
            team_id,
            user_id,
            name,
            scope_key,
            name_contains,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(id) = id else {
            return Ok(LabelWriteOutcome::NameTaken);
        };
        sqlx::query!(
            r#"INSERT INTO channel_label_channel (scope_key, channel_id, label_id)
               SELECT $1, channel_id, $2 FROM unnest($3::uuid[]) AS channel_id
               ON CONFLICT (scope_key, channel_id) DO UPDATE SET label_id = EXCLUDED.label_id"#,
            scope_key,
            id,
            channel_ids,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        match self.get_label(scope, id, viewer).await? {
            Some(label) => Ok(LabelWriteOutcome::Written(label)),
            None => Ok(LabelWriteOutcome::NotFound),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn rename_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        name: &str,
        viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> Result<LabelWriteOutcome, Self::Err> {
        let scope_key = scope.key();
        let name_contains = rule.map(ChannelLabelRule::name_contains);
        let result = sqlx::query!(
            r#"
            UPDATE channel_label
            SET name = $3, name_contains = COALESCE($4, name_contains), updated_at = now()
            WHERE id = $2 AND scope_key = $1
            "#,
            scope_key,
            label_id,
            name,
            name_contains,
        )
        .execute(&self.pool)
        .await;
        match result {
            Ok(done) if done.rows_affected() == 0 => return Ok(LabelWriteOutcome::NotFound),
            Ok(_) => {}
            Err(error) if is_unique_violation(&error) => {
                return Ok(LabelWriteOutcome::NameTaken);
            }
            Err(error) => return Err(error.into()),
        }
        match self.get_label(scope, label_id, viewer).await? {
            Some(label) => Ok(LabelWriteOutcome::Written(label)),
            None => Ok(LabelWriteOutcome::NotFound),
        }
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
    ) -> Result<bool, Self::Err> {
        let scope_key = scope.key();
        // Assignments cascade; channels and other scopes are unaffected.
        let done = sqlx::query!(
            r#"DELETE FROM channel_label WHERE id = $2 AND scope_key = $1"#,
            scope_key,
            label_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self))]
    async fn set_channel_label(
        &self,
        scope: &ChannelLabelsScope,
        channel_id: Uuid,
        label_id: Option<Uuid>,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<SetChannelLabelOutcome, Self::Err> {
        let scope_key = scope.key();
        let mut tx = self.pool.begin().await?;
        if let Some(label_id) = label_id {
            let label = sqlx::query!(
                "SELECT id, name_contains FROM channel_label WHERE id = $2 AND scope_key = $1 FOR KEY SHARE",
                scope_key,
                label_id,
            )
            .fetch_optional(&mut *tx)
            .await?;
            let Some(label) = label else {
                return Ok(SetChannelLabelOutcome::LabelNotFound);
            };
            if label.name_contains.is_some() {
                return Ok(SetChannelLabelOutcome::SmartTagReadOnly);
            }
        }
        let validity =
            validate_channels(&mut tx, &[channel_id], actor, label_id.map(|_| scope)).await?;
        if validity != SetChannelLabelOutcome::Updated {
            return Ok(validity);
        }
        if let Some(label_id) = label_id {
            sqlx::query!(
                r#"INSERT INTO channel_label_channel (scope_key, channel_id, label_id)
                   VALUES ($1, $2, $3)
                   ON CONFLICT (scope_key, channel_id) DO UPDATE SET label_id = EXCLUDED.label_id"#,
                scope_key,
                channel_id,
                label_id,
            )
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query!(
                "DELETE FROM channel_label_channel WHERE scope_key = $1 AND channel_id = $2",
                scope_key,
                channel_id,
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(SetChannelLabelOutcome::Updated)
    }

    #[tracing::instrument(err, skip(self))]
    async fn preview_smart_tag(
        &self,
        scope: &ChannelLabelsScope,
        viewer: &MacroUserIdStr<'_>,
        rule: &ChannelLabelRule,
        limit: u16,
    ) -> Result<SmartTagPreview, Self::Err> {
        let name_contains = rule.name_contains();
        let team_id = scope.team_id();
        let rows = sqlx::query!(
            r#"SELECT c.id, c.name as "name!", COUNT(*) OVER () as "total_count!"
               FROM comms_channels c
               JOIN comms_channel_participants p ON p.channel_id = c.id
               WHERE p.user_id = $1 AND p.left_at IS NULL
                   AND c.channel_type = 'team'
                   AND ($4::uuid IS NULL OR c.team_id = $4)
                   AND strpos(lower(c.name), lower($2)) > 0
               ORDER BY lower(c.name), c.id
               LIMIT $3"#,
            viewer.as_ref(),
            name_contains,
            i64::from(limit),
            team_id,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(SmartTagPreview {
            total_count: rows.first().map_or(0, |row| row.total_count),
            channels: rows
                .into_iter()
                .map(|row| SmartTagChannelMatch {
                    id: row.id,
                    name: row.name,
                })
                .collect(),
        })
    }
}

/// Lock active memberships and channel attributes until assignments commit.
/// Apply the domain's eligibility policy for additions, while allowing removals
/// to clear historical assignments regardless of the channel's current team.
async fn validate_channels(
    tx: &mut Transaction<'_, Postgres>,
    channel_ids: &[Uuid],
    actor: &MacroUserIdStr<'_>,
    assignment_scope: Option<&ChannelLabelsScope>,
) -> Result<SetChannelLabelOutcome, ChannelLabelsRepoErr> {
    // The valid_team_channel constraint makes team_id present exactly when the
    // channel type is 'team', so it supplies the domain's eligibility fact.
    let channels = sqlx::query!(
        r#"SELECT c.id, c.team_id
           FROM comms_channels c
           JOIN comms_channel_participants p ON p.channel_id = c.id
           WHERE c.id = ANY($1) AND p.user_id = $2 AND p.left_at IS NULL
           ORDER BY c.id FOR SHARE OF c, p"#,
        channel_ids,
        actor.as_ref(),
    )
    .fetch_all(&mut **tx)
    .await?;
    if channels.len() != channel_ids.len() {
        return Ok(SetChannelLabelOutcome::ChannelNotFound);
    }
    if assignment_scope
        .is_some_and(|scope| channels.iter().any(|c| !scope.can_label_channel(c.team_id)))
    {
        return Ok(SetChannelLabelOutcome::ChannelNotLabelable);
    }
    Ok(SetChannelLabelOutcome::Updated)
}
