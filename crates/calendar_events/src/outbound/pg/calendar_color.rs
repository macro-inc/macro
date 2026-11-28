//! A person's own color for a calendar, kept apart from the provider's
//! `calendars.color`, which every sync overwrites.
use super::*;
use crate::domain::calendar_color::{CalendarColor, CalendarColorWrite};

impl PgCalendarRepository {
    /// Store or clear `requester_id`'s color for a calendar visible to them
    /// (owned or delegated inbox), logging the calendar for its inbox when
    /// the stored color changed, so open caches reread it.
    pub(super) async fn write_calendar_color(
        &self,
        requester_id: &str,
        calendar_id: Uuid,
        color: Option<&CalendarColor>,
    ) -> Result<CalendarColorWrite, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let email_link_id = sqlx::query_scalar!(
            r#"
            SELECT link.id
            FROM calendars calendar
            JOIN calendar_accounts account ON account.id = calendar.account_id
            JOIN email_links link ON link.id = account.email_link_id
            WHERE calendar.id = $2
              AND NOT calendar.is_deleted
              AND account.sync_status <> 'disabled'
              AND (
                    link.macro_id = $1
                    OR EXISTS (
                        SELECT 1
                        FROM macro_user_links delegation
                        WHERE delegation.link_id = link.id
                          AND delegation.primary_macro_id = $1
                    )
              )
            "#,
            requester_id,
            calendar_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(report)?;
        let Some(email_link_id) = email_link_id else {
            return Ok(CalendarColorWrite::NotVisible);
        };

        let written = match color {
            Some(color) => sqlx::query!(
                r#"
                INSERT INTO calendar_color_preferences (user_id, calendar_id, color)
                VALUES ($1, $2, $3)
                ON CONFLICT (user_id, calendar_id) DO UPDATE
                SET color = EXCLUDED.color, updated_at = now()
                WHERE calendar_color_preferences.color <> EXCLUDED.color
                "#,
                requester_id,
                calendar_id,
                color.as_str(),
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?,
            None => sqlx::query!(
                r#"
                DELETE FROM calendar_color_preferences
                WHERE user_id = $1 AND calendar_id = $2
                "#,
                requester_id,
                calendar_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?,
        };
        if written.rows_affected() == 0 {
            return Ok(CalendarColorWrite::Unchanged);
        }

        let mut log = ChangeLogBatch::default();
        log.record(email_link_id, CalendarChangeOp::UpsertCalendar(calendar_id));
        log.commit(tx).await?;
        Ok(CalendarColorWrite::Changed { email_link_id })
    }
}
