use super::*;
use crate::domain::meetings::MeetingPreparation;

impl PgCallRepo {
    pub(super) async fn persist_preparation(
        &self,
        actor: &str,
        preparation: &MeetingPreparation,
    ) -> Result<(), CallError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("DELETE FROM call_meeting_preparations WHERE expires_at <= now()")
            .execute(tx.as_mut())
            .await?;
        sqlx::query!(
            "INSERT INTO call_meeting_preparations (id, user_id, expires_at) VALUES ($1, $2, $3)",
            preparation.id,
            actor,
            preparation.expires_at
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub(super) async fn claim_preparation(
        &self,
        id: &Uuid,
        actor: &str,
        meeting_id: &Uuid,
    ) -> Result<(), CallError> {
        // UPDATE and cancellation's DELETE serialize on the same row. If
        // cancellation won, or the room expired, the meeting simply starts cold.
        sqlx::query!(
            r#"UPDATE call_meeting_preparations SET meeting_id = $3
               WHERE id = $1 AND user_id = $2 AND meeting_id IS NULL AND expires_at > now()
               AND EXISTS (SELECT 1 FROM call_meetings WHERE id = $3 AND user_id = $2 AND cancelled_at IS NULL)"#,
            id, actor, meeting_id
        ).execute(&self.pool).await?;
        Ok(())
    }

    pub(super) async fn discard_preparation(
        &self,
        id: &Uuid,
        actor: &str,
    ) -> Result<bool, CallError> {
        Ok(sqlx::query!(
            "DELETE FROM call_meeting_preparations WHERE id = $1 AND user_id = $2 AND meeting_id IS NULL",
            id, actor
        ).execute(&self.pool).await?.rows_affected() > 0)
    }

    pub(super) async fn fetch_preparation(
        &self,
        meeting_id: &Uuid,
    ) -> Result<Option<MeetingPreparation>, CallError> {
        Ok(sqlx::query_as!(MeetingPreparation,
            "SELECT id, expires_at FROM call_meeting_preparations WHERE meeting_id = $1 AND expires_at > now()",
            meeting_id
        ).fetch_optional(&self.pool).await?)
    }
}
