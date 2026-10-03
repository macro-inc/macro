//! Persistence for explicit routine audiences, independent of scheduling state.
use super::pg_scheduled_action_repo::ActionRow;
use crate::domain::sharing::{RoutineSharingRepo, SharedRoutine};
use anyhow::Result;
use macro_uuid::Uuid;
use sqlx::PgPool;

pub struct PgRoutineSharingRepo {
    pool: PgPool,
}
impl PgRoutineSharingRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}
impl RoutineSharingRepo for PgRoutineSharingRepo {
    async fn get(&self, id: Uuid) -> Result<Option<SharedRoutine>> {
        let row = sqlx::query!(
            r#"
            SELECT to_jsonb(a) AS "action!", s.team_id AS "team_id?"
            FROM scheduled_action a LEFT JOIN routine_team_share s ON s.action_id = a.id
            WHERE a.id = $1
        "#,
            id
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(SharedRoutine {
                action: serde_json::from_value::<ActionRow>(row.action)?.try_into()?,
                team_id: row.team_id,
            })
        })
        .transpose()
    }
    async fn list(&self, teams: Vec<Uuid>) -> Result<Vec<SharedRoutine>> {
        let rows = sqlx::query!(
            r#"
            SELECT to_jsonb(a) AS "action!", s.team_id
            FROM routine_team_share s JOIN scheduled_action a ON a.id = s.action_id
            WHERE s.team_id = ANY($1) ORDER BY a.created_at DESC, a.id DESC
        "#,
            &teams
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(SharedRoutine {
                    action: serde_json::from_value::<ActionRow>(row.action)?.try_into()?,
                    team_id: Some(row.team_id),
                })
            })
            .collect()
    }
    async fn share(&self, id: Uuid, team: Option<Uuid>) -> Result<()> {
        if let Some(team) = team {
            sqlx::query!("INSERT INTO routine_team_share (action_id, team_id) VALUES ($1, $2) ON CONFLICT (action_id) DO UPDATE SET team_id = EXCLUDED.team_id", id, team).execute(&self.pool).await?;
        } else {
            sqlx::query!("DELETE FROM routine_team_share WHERE action_id = $1", id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }
}
