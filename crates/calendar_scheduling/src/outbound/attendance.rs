//! Maps authorized booking snapshots to the call domain's attendance reader.

use std::collections::BTreeMap;

use call::domain::{
    attendance::{MeetingAttendanceReader, MeetingAttendanceRequest},
    meetings::MeetingToken,
};
use uuid::Uuid;

use crate::domain::{
    attendance::{AttendanceFuture, AttendanceSource, ObservedParticipants},
    models::{Booking, Error},
};

/// Reads participation from the exact Macro meeting URL saved on each booking.
pub struct MacroCallAttendance<R> {
    reader: R,
    app_origin: reqwest::Url,
}

impl<R> MacroCallAttendance<R> {
    /// Compose the call domain's reader without accessing call-owned storage here.
    pub fn new(reader: R, app_origin: reqwest::Url) -> Self {
        Self { reader, app_origin }
    }
}

impl<R: MeetingAttendanceReader> MacroCallAttendance<R> {
    #[tracing::instrument(skip_all, err, fields(booking_count = bookings.len() as i64))]
    async fn observe(
        &self,
        bookings: &[Booking],
    ) -> Result<BTreeMap<Uuid, ObservedParticipants>, Error> {
        let mut ids = Vec::new();
        let mut requests = Vec::new();
        for booking in bookings {
            let Some(token) = meeting_token(&booking.location, &self.app_origin) else {
                continue;
            };
            ids.push(booking.id);
            requests.push(MeetingAttendanceRequest {
                token,
                starts_at: booking.starts_at,
                ends_at: booking.ends_at,
            });
        }
        if requests.is_empty() {
            return Ok(BTreeMap::new());
        }
        let observations = self.reader.read(&requests).await.map_err(|error| {
            tracing::error!(error = ?error, "reading booking call attendance failed");
            Error::Unavailable
        })?;
        if observations.len() != ids.len() {
            return Err(Error::Unavailable);
        }
        Ok(ids
            .into_iter()
            .zip(observations)
            .filter_map(|(id, observation)| {
                observation.map(|people| {
                    (
                        id,
                        ObservedParticipants {
                            user_ids: people
                                .user_ids
                                .into_iter()
                                .map(|id| id.to_string())
                                .collect(),
                            guest_present: people.guest_present,
                        },
                    )
                })
            })
            .collect())
    }
}

impl<R: MeetingAttendanceReader> AttendanceSource for MacroCallAttendance<R> {
    fn observed_participants<'a>(&'a self, bookings: &'a [Booking]) -> AttendanceFuture<'a> {
        Box::pin(self.observe(bookings))
    }
}

fn meeting_token(location: &str, app_origin: &reqwest::Url) -> Option<MeetingToken> {
    let url = reqwest::Url::parse(location).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.origin() != app_origin.origin()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let token = url.path().strip_prefix("/app/meet/join/")?;
    MeetingToken::try_from(token.to_owned()).ok()
}

#[cfg(test)]
mod test;
