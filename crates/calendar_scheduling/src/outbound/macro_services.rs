//! Reuses calendar writes, sync projections, and current team membership.
use crate::domain::{
    models::*,
    ports::{Calendars, Directory},
};
use calendar_events::domain::{
    meeting_links::create_event_with_macro_call,
    models::{
        CalendarAttendeeInput, CalendarEventDraft, CalendarSyncStatus, ConferenceChange, EventTime,
        EventTransparency, OccurrenceRange,
    },
    ports::{
        CalendarCreationRecoveryService, CalendarDeletionScope, CalendarOccurrenceService,
        MeetingLinkProvider, UnavailableMeetingLinks,
    },
};
use chrono::{DateTime, Duration, Utc};
use std::sync::Arc;
use teams::domain::{model::TeamRole, team_repo::TeamRepository};
use uuid::Uuid;

/// Adapter composed from existing domain services, never their outbound implementations.
pub struct MacroCalendars<O, M, L = UnavailableMeetingLinks> {
    occurrences: Arc<O>,
    mutations: Arc<M>,
    meeting_links: Arc<L>,
    management_origin: Option<String>,
}
impl<O, M> MacroCalendars<O, M, UnavailableMeetingLinks> {
    /// Wire the host's calendar domain capabilities without Macro call creation.
    pub fn new(occurrences: Arc<O>, mutations: Arc<M>, management_origin: Option<String>) -> Self {
        Self::with_meeting_links(
            occurrences,
            mutations,
            Arc::new(UnavailableMeetingLinks),
            management_origin,
        )
    }
}
impl<O, M, L> MacroCalendars<O, M, L> {
    /// Wire calendar capabilities and the meeting service that mints Macro calls.
    pub fn with_meeting_links(
        occurrences: Arc<O>,
        mutations: Arc<M>,
        meeting_links: Arc<L>,
        management_origin: Option<String>,
    ) -> Self {
        Self {
            occurrences,
            mutations,
            meeting_links,
            management_origin,
        }
    }
}
impl<O, M, L> MacroCalendars<O, M, L>
where
    O: CalendarOccurrenceService,
    M: CalendarCreationRecoveryService,
    L: MeetingLinkProvider,
{
    async fn create_macro_call(
        &self,
        organizer: &str,
        calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<(Uuid, String), Error> {
        let created = create_event_with_macro_call(
            &*self.mutations,
            &*self.meeting_links,
            organizer,
            None,
            calendar_id,
            draft,
        )
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "scheduling macro call creation failed");
            Error::CalendarUnavailable
        })?;
        let minted = created.meeting_link.url;
        if carries_url(
            created.event.location.as_deref(),
            created.event.description.as_deref(),
            &minted,
        ) {
            return Ok((created.event.id, minted));
        }
        // An idempotent replay returned the event written earlier. Drop the
        // meeting minted for this attempt and keep the link already on it.
        if let Err(error) = self
            .meeting_links
            .cancel_meeting_link(organizer, created.meeting_link.id)
            .await
        {
            tracing::warn!(
                error = ?error,
                meeting_id = %created.meeting_link.id,
                "failed to cancel a macro call minted for an existing booking event"
            );
        }
        let url = first_macro_call_url(
            created.event.location.as_deref(),
            created.event.description.as_deref(),
        )
        .or(created.event.conference_url)
        .or(created.event.location)
        .unwrap_or_default();
        Ok((created.event.id, url))
    }
}
impl<O: CalendarOccurrenceService, M: CalendarCreationRecoveryService, L: MeetingLinkProvider>
    Calendars for MacroCalendars<O, M, L>
{
    async fn creation_calendar(&self, host: &str) -> Result<Uuid, Error> {
        self.mutations
            .list_visible_calendars(host)
            .await
            .map_err(|_| Error::CalendarUnavailable)?
            .into_iter()
            .find(|c| c.is_primary && c.is_writable && c.sync_error.is_none())
            .map(|c| c.id)
            .ok_or(Error::CalendarUnavailable)
    }
    async fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude_event: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        let mut events = vec![];
        for host in hosts {
            let calendars = self
                .mutations
                .list_visible_calendars(host)
                .await
                .map_err(|_| Error::CalendarUnavailable)?;
            if calendars.iter().any(|c| c.sync_error.is_some())
                || !calendars
                    .iter()
                    .any(|c| c.is_primary && c.is_writable && c.sync_error.is_none())
                || self
                    .occurrences
                    .sync_status(host)
                    .await
                    .map_err(|_| Error::CalendarUnavailable)?
                    != CalendarSyncStatus::Ready
            {
                return Err(Error::CalendarUnavailable);
            }
            let range = OccurrenceRange {
                starts_at: start,
                ends_at: end,
                start_date: (start - Duration::days(1)).date_naive(),
                end_date: (end + Duration::days(1)).date_naive(),
            };
            let rows = self
                .occurrences
                .list_occurrences(host, range, None, 2001)
                .await
                .map_err(|_| Error::CalendarUnavailable)?;
            // Never treat a truncated occurrence result as free time.
            if rows.len() > 2000 {
                return Err(Error::CalendarUnavailable);
            }
            events.extend(rows.into_iter().map(|listing| {
                let (event, occurrence) = listing.into_occurrence_event();
                (host.clone(), event, occurrence)
            }));
        }
        let excluded_uid = events
            .iter()
            .find(|(_, event, _)| Some(event.id) == exclude_event)
            .map(|(_, event, _)| event.ical_uid.clone());
        let mut busy = vec![];
        for (host, event, occurrence) in events {
            let mut owned = event.attendees.iter().filter(|a| a.is_self).peekable();
            let declined = owned.peek().is_some()
                && owned.all(|a| {
                    a.response_status
                        == calendar_events::domain::models::AttendeeResponseStatus::Declined
                });
            if occurrence.is_cancelled
                || Some(event.id) == exclude_event
                || excluded_uid
                    .as_ref()
                    .is_some_and(|uid| !uid.is_empty() && *uid == event.ical_uid)
                || event.transparency == EventTransparency::Transparent
                || declined
            {
                continue;
            }
            if !occurrence.time.is_valid() {
                return Err(Error::CalendarUnavailable);
            }
            if !occurrence.time.has_positive_duration() {
                continue;
            }
            let (start, end) = match occurrence.time {
                EventTime::Timed {
                    starts_at, ends_at, ..
                } => (starts_at, ends_at),
                // All-day dates lack a source zone; conservatively cover every UTC offset.
                EventTime::AllDay {
                    start_date,
                    end_date,
                } => (
                    start_date
                        .and_hms_opt(0, 0, 0)
                        .ok_or(Error::CalendarUnavailable)?
                        .and_utc()
                        - Duration::hours(14),
                    end_date
                        .and_hms_opt(0, 0, 0)
                        .ok_or(Error::CalendarUnavailable)?
                        .and_utc()
                        + Duration::hours(12),
                ),
            };
            busy.push(BusyRange { host, start, end });
        }
        Ok(busy)
    }
    async fn create(
        &self,
        record: &BookingRecord,
        event: &EventType,
    ) -> Result<(Uuid, String), Error> {
        let organizer = record
            .booking
            .hosts
            .first()
            .ok_or(Error::CalendarUnavailable)?;
        let mut emails = vec![record.booking.email.clone()];
        for host in record.booking.hosts.iter().skip(1) {
            let user: macro_user_id::user_id::MacroUserIdStr<'_> = host
                .as_str()
                .try_into()
                .map_err(|_| Error::CalendarUnavailable)?;
            emails.push(user.email_part().as_ref().to_owned());
        }
        let answers = event
            .questions
            .iter()
            .filter_map(|q| {
                record
                    .booking
                    .answers
                    .get(&q.id)
                    .map(|a| format!("{}: {}", q.label, a))
            })
            .collect::<Vec<_>>()
            .join("\n");
        let management = self
            .management_origin
            .as_ref()
            .map(|origin| {
                format!(
                    "\n\nManage this booking: {}/app/booking/{}#{}",
                    origin.trim_end_matches('/'),
                    record.booking.id,
                    record.token
                )
            })
            .unwrap_or_default();
        let draft = CalendarEventDraft {
            idempotency_key: Some(record.booking.id),
            title: format!("{} — {}", record.booking.title, record.booking.name),
            description: Some(format!(
                "{}\n\n{}{}",
                event.description, answers, management
            )),
            location: (!event.location.is_empty()).then(|| event.location.clone()),
            time: EventTime::Timed {
                starts_at: record.booking.starts_at,
                ends_at: record.booking.ends_at,
                time_zone: Some(record.booking.time_zone.to_string()),
            },
            attendees: emails
                .into_iter()
                .map(|email| CalendarAttendeeInput {
                    email,
                    is_optional: false,
                    response_status: None,
                })
                .collect(),
            recurrence_lines: vec![],
            visibility: None,
            transparency: None,
            reminders: None,
            conference: (!event.macro_call && event.google_meet)
                .then_some(ConferenceChange::GoogleMeet),
            out_of_office: None,
        };
        if event.macro_call {
            if event.google_meet {
                tracing::error!("booking link requested both a Macro call and Google Meet");
                return Err(Error::CalendarUnavailable);
            }
            return self
                .create_macro_call(organizer, record.calendar_id, draft)
                .await;
        }
        let result = self
            .mutations
            .create_event(organizer, None, record.calendar_id, draft)
            .await
            .map_err(|error| {
                tracing::error!(error=?error,"scheduling calendar creation failed");
                Error::CalendarUnavailable
            })?;
        if event.google_meet
            && result
                .conference_url
                .as_ref()
                .is_none_or(|url| url.is_empty())
        {
            return Err(Error::CalendarUnavailable);
        }
        Ok((
            result.id,
            result
                .conference_url
                .or(result.location)
                .unwrap_or_default(),
        ))
    }
    async fn cancel(&self, record: &BookingRecord) -> Result<(), Error> {
        if let Some(calendar_id) = record.calendar_id {
            return self
                .mutations
                .delete_created_event(
                    record
                        .booking
                        .hosts
                        .first()
                        .ok_or(Error::CalendarUnavailable)?,
                    calendar_id,
                    record.booking.id,
                )
                .await
                .map_err(|_| Error::CalendarUnavailable);
        }
        if let Some(id) = record.calendar_event_id {
            self.mutations
                .delete_event(
                    record
                        .booking
                        .hosts
                        .first()
                        .ok_or(Error::CalendarUnavailable)?,
                    id,
                    None,
                    CalendarDeletionScope::All,
                )
                .await
                .map_err(|_| Error::CalendarUnavailable)?;
        }
        Ok(())
    }
    async fn reschedule(&self, record: &BookingRecord) -> Result<(), Error> {
        if let Some(id) = record.calendar_event_id {
            self.mutations
                .update_event(
                    record
                        .booking
                        .hosts
                        .first()
                        .ok_or(Error::CalendarUnavailable)?,
                    id,
                    None,
                    calendar_events::domain::models::CalendarEventPatch {
                        time: Some(EventTime::Timed {
                            starts_at: record.booking.starts_at,
                            ends_at: record.booking.ends_at,
                            time_zone: Some(record.booking.time_zone.to_string()),
                        }),
                        ..Default::default()
                    },
                    calendar_events::domain::ports::CalendarUpdateScope::All,
                )
                .await
                .map_err(|_| Error::CalendarUnavailable)?;
        }
        Ok(())
    }
}
/// Membership adapter over the owning teams repository port.
pub struct MacroDirectory<T>(pub T);
impl<T: TeamRepository> Directory for MacroDirectory<T> {
    async fn user_teams(&self, user: &str) -> Result<Vec<Uuid>, Error> {
        let user = user.try_into().map_err(|_| Error::Forbidden)?;
        self.0
            .get_user_teams(&user)
            .await
            .map(|teams| teams.into_iter().map(|team| *team.id()).collect())
            .map_err(|_| Error::Unavailable)
    }
    async fn members(&self, team: Uuid) -> Result<Vec<TeamMember>, Error> {
        Ok(self
            .0
            .get_all_team_members(&team)
            .await
            .map_err(|_| Error::Forbidden)?
            .into_iter()
            .map(|m| TeamMember {
                user_id: m.user_id.to_string(),
                admin: matches!(m.role, TeamRole::Owner | TeamRole::Admin),
            })
            .collect())
    }
}

impl<O, M, L> crate::domain::ports::AttachmentReadiness for MacroCalendars<O, M, L>
where
    O: CalendarOccurrenceService,
    M: calendar_events::domain::ports::CalendarMutationService,
    L: Send + Sync + 'static,
{
    async fn ready(&self, host: &str) -> Result<(), Error> {
        let calendars = self
            .mutations
            .list_visible_calendars(host)
            .await
            .map_err(|_| Error::CalendarUnavailable)?;
        if calendars.iter().any(|c| c.sync_error.is_some())
            || !calendars.iter().any(|c| c.is_primary && c.is_writable)
            || self
                .occurrences
                .sync_status(host)
                .await
                .map_err(|_| Error::CalendarUnavailable)?
                != CalendarSyncStatus::Ready
        {
            return Err(Error::CalendarUnavailable);
        }
        Ok(())
    }
}

fn carries_url(location: Option<&str>, description: Option<&str>, url: &str) -> bool {
    location.is_some_and(|value| value.contains(url))
        || description.is_some_and(|value| value.contains(url))
}

/// The join link already written into an event, including inside the
/// generated HTML paragraph.
fn first_macro_call_url(location: Option<&str>, description: Option<&str>) -> Option<String> {
    for text in [location, description].into_iter().flatten() {
        for token in text.split(|character: char| {
            character.is_whitespace() || matches!(character, '"' | '\'' | '<' | '>' | '&')
        }) {
            let token = token.trim_end_matches(|character: char| {
                matches!(character, '.' | ',' | ')' | ']' | ';')
            });
            if token.starts_with("http") && token.contains("/meet/join/") {
                return Some(token.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod test;
