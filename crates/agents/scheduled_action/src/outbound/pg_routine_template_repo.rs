use anyhow::Result;
use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use model_owner::Owner;
use serde_json::Value;
use sqlx::PgPool;

use crate::domain::ports::RoutineTemplateRepo;
use crate::domain::templates::{RoutineTemplate, TemplateSnapshot};

#[cfg(test)]
mod test;

/// PostgreSQL store for templates shared from routines. A template is deleted
/// with its source routine.
pub struct PgRoutineTemplateRepo {
    pool: PgPool,
}

impl PgRoutineTemplateRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct TemplateRow {
    action_id: Uuid,
    owner: String,
    name: String,
    description: String,
    trigger_config: Value,
    task: Value,
    variables: Value,
    active_count: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<TemplateRow> for RoutineTemplate {
    type Error = anyhow::Error;

    fn try_from(row: TemplateRow) -> Result<Self> {
        Ok(Self {
            id: row.action_id,
            author: Owner::from_principal_str(&row.owner)?,
            name: row.name,
            description: row.description,
            trigger: serde_json::from_value(row.trigger_config)?,
            task: row.task,
            variables: serde_json::from_value(row.variables)?,
            active_count: u32::try_from(row.active_count)?,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl RoutineTemplateRepo for PgRoutineTemplateRepo {
    async fn upsert_template(&self, snapshot: TemplateSnapshot) -> Result<RoutineTemplate> {
        sqlx::query!(
            r#"
            INSERT INTO scheduled_action_template
                (action_id, name, description, trigger_config, task, variables)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (action_id) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                trigger_config = EXCLUDED.trigger_config,
                task = EXCLUDED.task,
                variables = EXCLUDED.variables,
                updated_at = now()
            "#,
            snapshot.action_id,
            snapshot.name,
            snapshot.description,
            serde_json::to_value(&snapshot.trigger)?,
            snapshot.task,
            serde_json::to_value(&snapshot.variables)?,
        )
        .execute(&self.pool)
        .await?;
        self.get_template(&snapshot.action_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("template disappeared after it was shared"))
    }

    async fn delete_template(&self, id: &Uuid) -> Result<()> {
        sqlx::query!(
            "DELETE FROM scheduled_action_template WHERE action_id = $1",
            *id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_template(&self, id: &Uuid) -> Result<Option<RoutineTemplate>> {
        sqlx::query_as!(
            TemplateRow,
            r#"
            SELECT t.action_id, a.owner, t.name, t.description, t.trigger_config, t.task,
                   t.variables, t.created_at, t.updated_at,
                   (SELECT count(*) FROM scheduled_action s WHERE s.template_id = t.action_id)
                       AS "active_count!"
            FROM scheduled_action_template t
            JOIN scheduled_action a ON a.id = t.action_id
            WHERE t.action_id = $1
            "#,
            *id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(RoutineTemplate::try_from)
        .transpose()
    }
}
