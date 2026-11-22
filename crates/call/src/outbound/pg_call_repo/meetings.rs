//! Persistence for durable invitations and standalone RTC sessions.

use super::*;
use crate::domain::meetings::{GuestId, Meeting, MeetingCallAllocation, MeetingToken};

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

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn fetch_active_meetings(
        &self,
        user_id: &str,
    ) -> Result<Vec<Meeting>, CallError> {
        let rows = sqlx::query!(
            r#"SELECT m.id, m.share_token, m.user_id, m.title, m.scheduled_start,
                      m.scheduled_end, m.channel_id, m.channel_call_id, m.active_call_id
               FROM call_meetings m
               JOIN calls c ON c.id = m.active_call_id
               WHERE m.cancelled_at IS NULL
                 AND m.channel_id IS NULL
                 AND m.scheduled_start IS NULL AND m.scheduled_end IS NULL
                 AND (m.user_id = $1 OR EXISTS (
                     SELECT 1 FROM call_participants p
                     WHERE p.call_id = c.id AND p.user_id = $1
                 ) OR EXISTS (
                     SELECT 1 FROM call_invitees i
                     WHERE i.call_id = c.id AND i.user_id = $1
                 ))
                 AND (EXISTS (
                     SELECT 1 FROM call_participants p
                     WHERE p.call_id = c.id AND p.left_at IS NULL
                 ) OR EXISTS (
                     SELECT 1 FROM call_guests g
                     WHERE g.call_id = c.id AND g.left_at IS NULL
                 ))
               ORDER BY m.created_at DESC, m.id DESC"#,
            user_id,
        )
        .fetch_all(&self.pool)
        .await?;
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

    #[tracing::instrument(err, skip(self, users))]
    pub(super) async fn persist_meeting_invitees(
        &self,
        meeting_id: &Uuid,
        call_id: &Uuid,
        users: &[MacroUserIdStr<'_>],
    ) -> Result<(), CallError> {
        let mut tx = self.pool.begin().await?;
        // Match archival's lock order: call first, then meeting. Keep the session
        // alive until its invitees commit without ever creating participation.
        lifecycle::lock_active_call(&mut tx, call_id)
            .await
            .map_err(|error| match error {
                sqlx::Error::RowNotFound => CallError::NotFound("This call has ended".to_string()),
                error => error.into(),
            })?;
        sqlx::query_scalar!(
            r#"SELECT id FROM call_meetings
               WHERE id = $1 AND active_call_id = $2 AND cancelled_at IS NULL
               FOR SHARE"#,
            meeting_id,
            call_id,
        )
        .fetch_optional(tx.as_mut())
        .await?
        .ok_or_else(|| CallError::NotFound("This call has ended".to_string()))?;
        let user_ids: Vec<String> = users.iter().map(ToString::to_string).collect();
        sqlx::query!(
            r#"INSERT INTO call_invitees (call_id, user_id)
               SELECT $1, unnest($2::text[])
               ON CONFLICT (call_id, user_id) DO NOTHING"#,
            call_id,
            &user_ids,
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
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
        resume_allowed: bool,
    ) -> Result<MeetingCallAllocation, CallError> {
        let mut tx = self.pool.begin().await?;
        // Lock order: meeting, then the ended call record. Archival locks the
        // live call before the meeting, but it never meets this path: with a
        // live call the join returns below without touching `call_records`.
        let row = sqlx::query!(
            r#"SELECT id, share_token, user_id, title, scheduled_start, scheduled_end, channel_id, channel_call_id, active_call_id
               FROM call_meetings WHERE id = $1 AND cancelled_at IS NULL FOR UPDATE"#,
            meeting_id,
        ).fetch_optional(tx.as_mut()).await?.ok_or_else(|| CallError::NotFound("meeting".to_string()))?;
        let meeting = Meeting {
            id: row.id,
            share_token: MeetingToken::try_from(row.share_token)?,
            user_id: row.user_id,
            title: row.title,
            scheduled_start: row.scheduled_start,
            scheduled_end: row.scheduled_end,
            channel_id: row.channel_id,
            channel_call_id: row.channel_call_id,
            call_id: row.active_call_id,
        };
        if let Some(call_id) = meeting.call_id
            && let Some(call) = sqlx::query!(
                "SELECT id, channel_id, room_name, created_by, created_at, egress_id FROM calls WHERE id = $1",
                call_id,
            ).fetch_optional(tx.as_mut()).await? {
                tx.commit().await?;
                return Ok(MeetingCallAllocation::Joined(Call { id: call.id, channel_id: call.channel_id, room_name: call.room_name, created_by: call.created_by, created_at: call.created_at, egress_id: call.egress_id }));
        }
        if meeting.channel_call_id.is_some() {
            return Err(CallError::NotFound("This call has ended".to_string()));
        }

        // The candidate's room hosts the new session either way. A resumed
        // call keeps its id, owner and sharing; only the room is new.
        let room_name = candidate_call_id.to_string();
        let resumed = if resume_allowed {
            resumable_call(&mut tx, &meeting).await?
        } else {
            None
        };
        let (call_id, created_by, share_permission_id, share_with_team) = match &resumed {
            Some(ended) => (
                ended.id,
                ended.created_by.clone(),
                ended.share_permission_id.clone(),
                ended.shared_with_team,
            ),
            None => {
                let call_id = *candidate_call_id;
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
                (call_id, meeting.user_id.clone(), share_permission_id, false)
            }
        };
        let call = sqlx::query!(
            r#"INSERT INTO calls (id, channel_id, room_name, created_by, share_permission_id, share_with_team, meeting_id)
               VALUES ($1, NULL, $2, $3, $4, $5, $6)
               RETURNING id, channel_id, room_name, created_by, created_at, egress_id"#,
            call_id, room_name, created_by, share_permission_id, share_with_team, meeting_id,
        ).fetch_one(tx.as_mut()).await?;
        sqlx::query!(
            "UPDATE call_meetings SET active_call_id = $1 WHERE id = $2",
            call_id,
            meeting_id
        )
        .execute(tx.as_mut())
        .await?;
        sqlx::query!(
            "DELETE FROM call_meeting_preparations WHERE meeting_id = $1",
            meeting_id
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        let call = Call {
            id: call.id,
            channel_id: call.channel_id,
            room_name: call.room_name,
            created_by: call.created_by,
            created_at: call.created_at,
            egress_id: call.egress_id,
        };
        Ok(match resumed {
            Some(_) => MeetingCallAllocation::Resumed(call),
            None => MeetingCallAllocation::Started(call),
        })
    }

    #[tracing::instrument(err, skip(self))]
    pub(super) async fn persist_guest(
        &self,
        call_id: &Uuid,
        guest_id: GuestId,
        name: &str,
    ) -> Result<(), CallError> {
        let mut tx = self.pool.begin().await?;
        // Serialize with archival so the guest is counted before the emptiness
        // check or rejected after the call is deleted.
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

/// The ended call a join of `meeting` resumes.
struct ResumableCall {
    id: Uuid,
    created_by: String,
    share_permission_id: String,
    shared_with_team: bool,
}

/// The meeting's latest archived call, locked, when a join now resumes it.
async fn resumable_call(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    meeting: &Meeting,
) -> Result<Option<ResumableCall>, CallError> {
    // `call_records.meeting_id` has no index; the meeting's calls are found
    // through their entities.
    let latest = sqlx::query!(
        r#"SELECT cr.id, cr.created_by, cr.share_permission_id, cr.ended_at,
                  sp.team_share_access_level IS NOT NULL AS "shared_with_team!"
           FROM call_entities ce
           JOIN call_records cr ON cr.id = ce.id
           JOIN "SharePermission" sp ON sp.id = cr.share_permission_id
           WHERE ce.meeting_id = $1 AND ce.created_via = 'native'
           ORDER BY cr.ended_at DESC
           LIMIT 1
           FOR UPDATE OF cr"#,
        meeting.id,
    )
    .fetch_optional(tx.as_mut())
    .await?;
    Ok(latest
        .filter(|row| meeting.resumes_call(row.ended_at, Utc::now()))
        .map(|row| ResumableCall {
            id: row.id,
            created_by: row.created_by,
            share_permission_id: row.share_permission_id,
            shared_with_team: row.shared_with_team,
        }))
}

#[cfg(test)]
mod test;
