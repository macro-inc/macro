//! Persistence for durable invitations and standalone RTC sessions.

use super::*;
use crate::domain::meetings::{GuestId, Meeting, MeetingToken};

impl PgCallRepo {
    #[tracing::instrument(err, skip(self, meeting))]
    pub(super) async fn persist_meeting(&self, meeting: Meeting) -> Result<Meeting, CallError> {
        let row = sqlx::query!(
            r#"INSERT INTO call_meetings
                (id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
               ON CONFLICT (channel_call_id) DO UPDATE SET channel_call_id = EXCLUDED.channel_call_id
               RETURNING id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id"#,
            meeting.id, meeting.share_token.as_str(), meeting.user_id, meeting.title,
            meeting.scheduled_start, meeting.scheduled_end, meeting.channel_id,
            meeting.channel_call_id, meeting.call_id,
        ).fetch_one(&self.pool).await?;
        Ok(Meeting {
            id: row.id,
            share_token: MeetingToken::try_from(row.share_token)?,
            user_id: row.user_id,
            title: row.title,
            scheduled_start: row.scheduled_start,
            scheduled_end: row.scheduled_end,
            channel_id: row.channel_id,
            channel_call_id: row.channel_call_id,
            call_id: row.active_call_id,
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn fetch_meeting(
        &self,
        token: &MeetingToken,
    ) -> Result<Option<Meeting>, CallError> {
        let row = sqlx::query!(
            r#"SELECT id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id
               FROM call_meetings WHERE share_token = $1 AND cancelled_at IS NULL"#,
            token.as_str(),
        ).fetch_optional(&self.pool).await?;
        row.map(|row| {
            Ok(Meeting {
                id: row.id,
                share_token: MeetingToken::try_from(row.share_token)?,
                user_id: row.user_id,
                title: row.title,
                scheduled_start: row.scheduled_start,
                scheduled_end: row.scheduled_end,
                channel_id: row.channel_id,
                channel_call_id: row.channel_call_id,
                call_id: row.active_call_id,
            })
        })
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn fetch_meeting_for_call(
        &self,
        call_id: &Uuid,
        include_cancelled: bool,
    ) -> Result<Option<Meeting>, CallError> {
        let row = sqlx::query!(
            r#"SELECT id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id
               FROM call_meetings
               WHERE (active_call_id = $1 OR id = (SELECT meeting_id FROM call_records WHERE id = $1))
                 AND ($2 OR cancelled_at IS NULL)
               ORDER BY created_at DESC
               LIMIT 1"#,
            call_id,
            include_cancelled,
        ).fetch_optional(&self.pool).await?;
        row.map(|row| {
            Ok(Meeting {
                id: row.id,
                share_token: MeetingToken::try_from(row.share_token)?,
                user_id: row.user_id,
                title: row.title,
                scheduled_start: row.scheduled_start,
                scheduled_end: row.scheduled_end,
                channel_id: row.channel_id,
                channel_call_id: row.channel_call_id,
                call_id: row.active_call_id,
            })
        })
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn fetch_meetings(&self, user_id: &str) -> Result<Vec<Meeting>, CallError> {
        let rows = sqlx::query!(
            r#"SELECT id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id
               FROM call_meetings WHERE user_id = $1 AND cancelled_at IS NULL AND channel_id IS NULL
               ORDER BY created_at DESC LIMIT 100"#,
            user_id,
        ).fetch_all(&self.pool).await?;
        rows.into_iter()
            .map(|row| {
                Ok(Meeting {
                    id: row.id,
                    share_token: MeetingToken::try_from(row.share_token)?,
                    user_id: row.user_id,
                    title: row.title,
                    scheduled_start: row.scheduled_start,
                    scheduled_end: row.scheduled_end,
                    channel_id: row.channel_id,
                    channel_call_id: row.channel_call_id,
                    call_id: row.active_call_id,
                })
            })
            .collect()
    }

    #[tracing::instrument(err, skip(self, request))]
    pub(super) async fn update_owned_meeting(
        &self,
        meeting_id: &Uuid,
        user_id: &str,
        request: UpdateMeetingRequest,
    ) -> Result<Option<Meeting>, CallError> {
        let row = sqlx::query!(
            "UPDATE call_meetings SET title = COALESCE($3, title), scheduled_start = CASE WHEN $6 THEN NULL ELSE COALESCE($4, scheduled_start) END, scheduled_end = CASE WHEN $6 THEN NULL ELSE COALESCE($5, scheduled_end) END WHERE id = $1 AND user_id = $2 AND cancelled_at IS NULL RETURNING id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id",
            meeting_id, user_id, request.title, request.scheduled_start, request.scheduled_end, request.clear_schedule,
        ).fetch_optional(&self.pool).await?;
        row.map(|row| {
            Ok(Meeting {
                id: row.id,
                share_token: MeetingToken::try_from(row.share_token)?,
                user_id: row.user_id,
                title: row.title,
                scheduled_start: row.scheduled_start,
                scheduled_end: row.scheduled_end,
                channel_id: row.channel_id,
                channel_call_id: row.channel_call_id,
                call_id: row.active_call_id,
            })
        })
        .transpose()
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn cancel_owned_meeting(
        &self,
        meeting_id: &Uuid,
        user_id: &str,
    ) -> Result<bool, CallError> {
        Ok(sqlx::query!(
            "UPDATE call_meetings SET cancelled_at = COALESCE(cancelled_at, now()) WHERE id = $1 AND user_id = $2",
            meeting_id, user_id,
        ).execute(&self.pool).await?.rows_affected() > 0)
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn allocate_meeting_call(
        &self,
        meeting_id: &Uuid,
        candidate_call_id: &Uuid,
    ) -> Result<(Call, bool), CallError> {
        let mut tx = self.pool.begin().await?;
        let meeting = sqlx::query!(
            "SELECT id, user_id, active_call_id, channel_call_id FROM call_meetings WHERE id = $1 AND cancelled_at IS NULL FOR UPDATE",
            meeting_id,
        ).fetch_optional(tx.as_mut()).await?.ok_or_else(|| CallError::NotFound("meeting".to_string()))?;
        if let Some(call_id) = meeting.active_call_id
            && let Some(call) = sqlx::query!(
                "SELECT id, channel_id, room_name, created_by, created_at, egress_id FROM calls WHERE id = $1",
                call_id,
            ).fetch_optional(tx.as_mut()).await? {
                tx.commit().await?;
                return Ok((Call { id: call.id, channel_id: call.channel_id, room_name: call.room_name, created_by: call.created_by, created_at: call.created_at, egress_id: call.egress_id }, false));
        }
        if meeting.channel_call_id.is_some() {
            return Err(CallError::NotFound("This call has ended".to_string()));
        }
        let call_id = *candidate_call_id;
        let room_name = call_id.to_string();
        let share_permission_id = Uuid::now_v7().to_string();
        sqlx::query!(
            r#"INSERT INTO "SharePermission" (id, "linkShare", "linkShareAccessLevel", "createdAt", "updatedAt")
               VALUES ($1, NULL, NULL, NOW(), NOW())"#, share_permission_id,
        ).execute(tx.as_mut()).await?;
        entity_access_db_utils::insert_entity_access_row(
            &mut tx,
            &call_id,
            entity_access_db_utils::EntityType::Call,
            &meeting.user_id,
            entity_access_db_utils::EntityAccessSourceType::User,
            entity_access_db_utils::AccessLevel::Owner,
        )
        .await?;
        let call = sqlx::query!(
            r#"INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id, share_with_team, meeting_id)
               VALUES ($1, NULL, $2, $3, $4, FALSE, $5)
               RETURNING id, channel_id, room_name, created_by, created_at, egress_id"#,
            call_id, room_name, meeting.user_id, share_permission_id, meeting_id,
        ).fetch_one(tx.as_mut()).await?;
        sqlx::query!(
            "UPDATE call_meetings SET active_call_id = $1 WHERE id = $2",
            call_id,
            meeting_id
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok((
            Call {
                id: call.id,
                channel_id: call.channel_id,
                room_name: call.room_name,
                created_by: call.created_by,
                created_at: call.created_at,
                egress_id: call.egress_id,
            },
            true,
        ))
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn persist_guest(
        &self,
        call_id: &Uuid,
        guest_id: GuestId,
        name: &str,
    ) -> Result<(), CallError> {
        let mut tx = self.pool.begin().await?;
        // Serialize against archival: `archive_session` locks the calls row,
        // so a guest join racing the last leave either lands before the
        // emptiness check or fails here with NotFound instead of inserting a
        // row for a call that no longer exists.
        lifecycle::lock_active_call(&mut tx, call_id).await?;
        sqlx::query!(
            "INSERT INTO call_guests (id, call_id, display_name) VALUES ($1, $2, $3)",
            guest_id.as_uuid(),
            call_id,
            name,
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn update_guest(
        &self,
        call_id: &Uuid,
        guest_id: GuestId,
        joined: bool,
    ) -> Result<(), CallError> {
        let mut tx = self.pool.begin().await?;
        lifecycle::lock_active_call(&mut tx, call_id).await?;
        sqlx::query!(
            "UPDATE call_guests SET left_at = CASE WHEN $3 THEN NULL ELSE now() END WHERE call_id = $1 AND id = $2",
            call_id,
            guest_id.as_uuid(),
            joined,
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
