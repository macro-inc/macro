//! Durable compare-and-set journal; no provider or confirmation policy here.
use super::PgCalendarRepository;
use crate::domain::{models::CalendarEvent, replacement::*};
use rootcause::Report;
use serde_json::Value;
use uuid::Uuid;

struct Row {
    id: Uuid,
    user_id: String,
    calendar_id: Uuid,
    event_id: Uuid,
    master_id: String,
    recurrence_id: Option<String>,
    snapshot: Value,
    next_step: i32,
    command: Option<Value>,
    replacement_provider_id: Option<String>,
    result: Option<Value>,
}
impl TryFrom<Row> for CalendarReplacement {
    type Error = Report;
    fn try_from(row: Row) -> Result<Self, Report> {
        Ok(Self {
            id: row.id,
            user_id: row.user_id,
            calendar_id: row.calendar_id,
            event_id: row.event_id,
            master_id: row.master_id,
            recurrence_id: row.recurrence_id,
            snapshot: serde_json::from_value(row.snapshot)?,
            next_step: row.next_step,
            command: row.command,
            replacement_provider_id: row.replacement_provider_id,
            result: row.result.map(serde_json::from_value).transpose()?,
        })
    }
}
impl CalendarReplacementRepository for PgCalendarRepository {
    async fn claim_pending_replacements(&self, limit: i64) -> Result<Vec<(String, Uuid)>, Report> {
        let rows = sqlx::query!(
            r#"WITH due AS (
            SELECT id FROM calendar_event_replacements WHERE result IS NULL
                AND (next_step>0 OR command IS NOT NULL) AND updated_at<now()-interval '30 seconds'
            ORDER BY updated_at,id LIMIT $1 FOR UPDATE SKIP LOCKED)
            UPDATE calendar_event_replacements operation SET updated_at=now() FROM due
            WHERE operation.id=due.id RETURNING operation.user_id,operation.id"#,
            limit
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| (r.user_id, r.id)).collect())
    }
    async fn active_replacement(
        &self,
        user_id: &str,
        calendar_id: Uuid,
        master_id: &str,
    ) -> Result<Option<CalendarReplacement>, Report> {
        sqlx::query_as!(
            Row,
            r#"SELECT id,user_id,calendar_id,event_id,master_id,
            recurrence_id,snapshot,next_step,command,replacement_provider_id,result
            FROM calendar_event_replacements
            WHERE user_id=$1 AND calendar_id=$2 AND master_id=$3 AND result IS NULL"#,
            user_id,
            calendar_id,
            master_id
        )
        .fetch_optional(&self.pool)
        .await?
        .map(TryInto::try_into)
        .transpose()
    }
    async fn prepare_replacement(
        &self,
        operation: CalendarReplacement,
    ) -> Result<CalendarReplacement, Report> {
        let snapshot = serde_json::to_value(&operation.snapshot)?;
        let row = sqlx::query_as!(
            Row,
            r#"INSERT INTO calendar_event_replacements
            (id,user_id,calendar_id,event_id,master_id,recurrence_id,snapshot)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (calendar_id,master_id) WHERE result IS NULL DO UPDATE
                SET updated_at=calendar_event_replacements.updated_at
                WHERE calendar_event_replacements.user_id=EXCLUDED.user_id
            RETURNING id,user_id,calendar_id,event_id,master_id,recurrence_id,snapshot,
                next_step,command,replacement_provider_id,result"#,
            operation.id,
            operation.user_id,
            operation.calendar_id,
            operation.event_id,
            operation.master_id,
            operation.recurrence_id,
            snapshot
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| {
            rootcause::report!("Another organizer action is already in progress for this series")
        })?;
        row.try_into()
    }
    async fn replacement(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> Result<Option<CalendarReplacement>, Report> {
        sqlx::query_as!(
            Row,
            r#"SELECT id,user_id,calendar_id,event_id,master_id,
            recurrence_id,snapshot,next_step,command,replacement_provider_id,result
            FROM calendar_event_replacements WHERE user_id=$1 AND id=$2"#,
            user_id,
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .map(TryInto::try_into)
        .transpose()
    }
    async fn start_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        command: &Value,
    ) -> Result<bool, Report> {
        Ok(sqlx::query!(
            r#"UPDATE calendar_event_replacements SET command=$3,updated_at=now()
            WHERE id=$1 AND next_step=$2 AND command IS NULL AND result IS NULL"#,
            id,
            step,
            command
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }
    async fn reject_replacement_create(&self, id: Uuid) -> Result<(), Report> {
        sqlx::query!("UPDATE calendar_event_replacements SET command=NULL,updated_at=now() WHERE id=$1 AND next_step=0 AND result IS NULL",id).execute(&self.pool).await?;
        Ok(())
    }
    async fn finish_replacement_step(
        &self,
        id: Uuid,
        step: i32,
        created_id: Option<&str>,
    ) -> Result<bool, Report> {
        Ok(sqlx::query!(
            r#"UPDATE calendar_event_replacements
            SET next_step=next_step+1,command=NULL,
                replacement_provider_id=COALESCE(replacement_provider_id,$3),updated_at=now()
            WHERE id=$1 AND next_step=$2 AND command IS NOT NULL AND result IS NULL"#,
            id,
            step,
            created_id
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }
    async fn complete_replacement(&self, id: Uuid, event: &CalendarEvent) -> Result<(), Report> {
        sqlx::query!(
            r#"UPDATE calendar_event_replacements SET result=$2,updated_at=now()
            WHERE id=$1 AND command IS NULL AND result IS NULL
            AND next_step=jsonb_array_length(snapshot->'occurrences')+2"#,
            id,
            serde_json::to_value(event)?
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    async fn discard_replacement(&self, user_id: &str, id: Uuid) -> Result<bool, Report> {
        Ok(sqlx::query!(
            r#"DELETE FROM calendar_event_replacements
            WHERE user_id=$1 AND id=$2 AND next_step=0 AND command IS NULL AND result IS NULL"#,
            user_id,
            id
        )
        .execute(&self.pool)
        .await?
        .rows_affected()
            == 1)
    }
}
