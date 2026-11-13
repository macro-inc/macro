//! Bounded reads of actual RTC connections; token-issued participant rows are never evidence.

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

use crate::domain::{
    attendance::{
        MeetingAttendance, MeetingAttendanceFuture, MeetingAttendanceReader,
        MeetingAttendanceRequest,
    },
    models::CallError,
};

/// Call-owned reader that exposes participation facts without loading call contents.
pub struct PgMeetingAttendanceReader {
    pool: PgPool,
}

impl PgMeetingAttendanceReader {
    /// Reuse the host's MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    #[tracing::instrument(skip_all, err, fields(meeting_count = requests.len() as i64))]
    async fn read_meetings(
        &self,
        requests: &[MeetingAttendanceRequest],
    ) -> Result<Vec<Option<MeetingAttendance>>, CallError> {
        if requests.len() > 5000 || requests.iter().any(|r| r.ends_at <= r.starts_at) {
            return Err(CallError::InvalidRequest(
                "Invalid attendance range or batch size".into(),
            ));
        }
        if requests.is_empty() {
            return Ok(Vec::new());
        }
        let tokens: Vec<String> = requests
            .iter()
            .map(|r| r.token.as_str().to_owned())
            .collect();
        let starts: Vec<_> = requests.iter().map(|r| r.starts_at).collect();
        let ends: Vec<_> = requests.iter().map(|r| r.ends_at).collect();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|error| CallError::Internal(error.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(tx.as_mut())
            .await
            .map_err(|error| CallError::Internal(error.into()))?;
        let rows = sqlx::query_file!(
            "src/outbound/meeting_attendance/read.sql",
            &tokens,
            &starts,
            &ends,
        )
        .fetch_all(tx.as_mut())
        .await
        .map_err(|error| CallError::Internal(error.into()))?;
        tx.commit()
            .await
            .map_err(|error| CallError::Internal(error.into()))?;
        if rows.len() > 10000 {
            return Err(CallError::InvalidRequest(
                "Too much attendance evidence in this range".into(),
            ));
        }
        let mut complete = vec![true; requests.len()];
        let mut observed: Vec<_> = requests
            .iter()
            .map(|_| MeetingAttendance::default())
            .collect();
        for row in rows {
            let index = usize::try_from(row.ordinal - 1)
                .ok()
                .filter(|index| *index < requests.len())
                .ok_or_else(|| {
                    CallError::Internal(anyhow::anyhow!("invalid attendance response index"))
                })?;
            complete[index] &= row.tracked;
            if row.participant_sid.is_none() {
                continue;
            }
            if let Some(user_id) = row.user_id {
                let user_id = MacroUserIdStr::try_from(user_id)
                    .map_err(|error| CallError::Internal(error.into()))?;
                observed[index].user_ids.push(user_id);
            } else {
                observed[index].guest_present = true;
            }
        }
        Ok(observed
            .into_iter()
            .zip(complete)
            .map(|(mut people, complete)| {
                people.user_ids.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
                people.user_ids.dedup();
                complete.then_some(people)
            })
            .collect())
    }
}

impl MeetingAttendanceReader for PgMeetingAttendanceReader {
    fn read<'a>(&'a self, requests: &'a [MeetingAttendanceRequest]) -> MeetingAttendanceFuture<'a> {
        Box::pin(self.read_meetings(requests))
    }
}

#[cfg(feature = "outbound")]
#[tracing::instrument(skip_all, err)]
pub(super) async fn record(
    pool: &PgPool,
    event: &crate::domain::models::CallWebhookEvent,
) -> Result<(), CallError> {
    let Some(attendance) = &event.attendance else {
        return Ok(());
    };
    let Some(call_id) = event
        .room_name
        .as_deref()
        .and_then(|room| uuid::Uuid::parse_str(room).ok())
    else {
        return Ok(());
    };
    let user_id = event.participant_identity.as_ref().map(|id| id.as_ref());
    if user_id.is_none() && event.guest_identity.is_none() {
        return Ok(());
    }
    sqlx::query_file!(
        "src/outbound/meeting_attendance/record.sql",
        call_id,
        attendance.participant_sid,
        user_id,
        attendance.joined_at,
        attendance.left_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}
