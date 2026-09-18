//! Scheduling use cases, authorization, and booking state transitions.
use super::{
    availability::{schedule_contains, slots_for_date, validate_profile},
    models::*,
    ports::*,
};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use uuid::Uuid;

/// Scheduling domain service with replaceable persistence, directory, and calendars.
pub struct Service<R, C, D> {
    pub(super) repository: R,
    pub(super) calendars: C,
    directory: D,
}
impl<R: Repository, C: Calendars, D: Directory> Service<R, C, D> {
    /// Construct the scheduling use-case service.
    pub fn new(repository: R, calendars: C, directory: D) -> Self {
        Self {
            repository,
            calendars,
            directory,
        }
    }
    /// Deterministic opaque identity for a personal or team scheduling profile.
    pub fn profile_id(user: &str, team: Option<Uuid>) -> Uuid {
        let scope = team.map_or_else(
            || format!("macro:scheduling:user:{user}"),
            |t| format!("macro:scheduling:team:{t}"),
        );
        Uuid::new_v5(&Uuid::NAMESPACE_URL, scope.as_bytes())
    }
    async fn authorize(&self, user: &str, owner: &OwnedProfile, write: bool) -> Result<(), Error> {
        if let Some(team) = owner.team_id {
            if self
                .directory
                .members(team)
                .await?
                .iter()
                .any(|m| m.user_id == user && (!write || m.admin))
            {
                return Ok(());
            }
        } else if owner.user_id.as_deref() == Some(user) {
            return Ok(());
        }
        Err(Error::Forbidden)
    }
    /// Read configuration, returning an unsaved default for a new profile.
    pub async fn settings(&self, user: &str, team: Option<Uuid>) -> Result<Profile, Error> {
        let id = Self::profile_id(user, team);
        let owner = self
            .repository
            .profile(id)
            .await?
            .unwrap_or_else(|| OwnedProfile {
                user_id: team.is_none().then(|| user.to_owned()),
                team_id: team,
                profile: Profile {
                    id,
                    name: "My calendar".into(),
                    description: String::new(),
                    schedules: vec![],
                    default_schedule_id: None,
                    event_types: vec![],
                    revision: 0,
                },
            });
        self.authorize(user, &owner, false).await?;
        Ok(owner.profile)
    }
    /// Save a validated, revision-protected profile. Only team admins may edit team links.
    pub async fn save(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: Profile,
    ) -> Result<Profile, Error> {
        if profile.id != Self::profile_id(user, team) {
            return Err(Error::Forbidden);
        }
        validate_profile(&profile, team.is_some())?;
        if profile
            .event_types
            .iter()
            .any(|event| event.requires_confirmation)
        {
            return Err(Error::Invalid(
                "Manual approval is not available yet. Use automatic confirmation.".into(),
            ));
        }
        let owner = OwnedProfile {
            user_id: team.is_none().then(|| user.to_owned()),
            team_id: team,
            profile,
        };
        self.authorize(user, &owner, true).await?;
        self.validate_hosts(&owner).await?;
        self.repository.save_profile(owner).await
    }
    async fn validate_hosts(&self, owner: &OwnedProfile) -> Result<(), Error> {
        let members = if let Some(team) = owner.team_id {
            self.directory
                .members(team)
                .await?
                .into_iter()
                .map(|m| m.user_id)
                .collect::<Vec<_>>()
        } else {
            vec![owner.user_id.clone().ok_or(Error::Forbidden)?]
        };
        if owner
            .profile
            .event_types
            .iter()
            .any(|e| e.hosts.iter().any(|h| !members.contains(h)))
        {
            return Err(Error::Invalid(
                "Every host must be a current member of this calendar's owner".into(),
            ));
        }
        Ok(())
    }
    async fn validate_booking_hosts(
        &self,
        owner: &OwnedProfile,
        hosts: &[String],
    ) -> Result<(), Error> {
        let members = if let Some(team) = owner.team_id {
            self.directory
                .members(team)
                .await?
                .into_iter()
                .map(|m| m.user_id)
                .collect::<Vec<_>>()
        } else {
            vec![owner.user_id.clone().ok_or(Error::Forbidden)?]
        };
        if hosts.iter().any(|h| !members.contains(h)) {
            return Err(Error::Forbidden);
        }
        Ok(())
    }
    /// Publish only enabled event types and public presentation fields.
    pub async fn public_profile(&self, id: Uuid) -> Result<PublicProfile, Error> {
        let owner = self.repository.profile(id).await?.ok_or(Error::NotFound)?;
        let p = owner.profile;
        Ok(PublicProfile {
            id: p.id,
            name: p.name,
            description: p.description,
            event_types: p
                .event_types
                .into_iter()
                .filter(|e| e.enabled)
                .map(|e| PublicEvent {
                    id: e.id,
                    title: e.title,
                    slug: e.slug,
                    description: e.description,
                    duration_minutes: e.duration_minutes,
                    location: e.location,
                    google_meet: e.google_meet,
                    questions: e.questions,
                    requires_confirmation: e.requires_confirmation,
                    mode: e.mode,
                })
                .collect(),
        })
    }
    /// Compute slots without exposing host identities or private event details.
    pub async fn slots(
        &self,
        profile_id: Uuid,
        event_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        let owner = self
            .repository
            .profile(profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        let event = owner
            .profile
            .event_types
            .iter()
            .find(|e| e.id == event_id && e.enabled)
            .ok_or(Error::NotFound)?;
        self.validate_booking_hosts(&owner, &event.hosts).await?;
        if event.requires_confirmation {
            return Err(Error::Invalid(
                "This booking link is paused until its host enables automatic confirmation.".into(),
            ));
        }
        let schedule = owner
            .profile
            .schedules
            .iter()
            .find(|s| s.id == event.schedule_id)
            .ok_or(Error::NotFound)?;
        let (start, end) = day_bounds(schedule, date)?;
        let now = Utc::now();
        if end < now || start > now + Duration::days(i64::from(event.horizon_days) + 1) {
            return Ok(vec![]);
        }
        let records = self.repository.bookings(profile_id, start, end).await?;
        let count = records
            .iter()
            .filter(|r| {
                r.booking.event_type_id == event_id && r.booking.status != BookingStatus::Cancelled
            })
            .count();
        if event.daily_limit.is_some_and(|n| count >= usize::from(n)) {
            return Ok(vec![]);
        }
        let busy_start = start - Duration::minutes(i64::from(event.before_minutes));
        let busy_end = end + Duration::minutes(i64::from(event.after_minutes));
        let mut busy = self
            .calendars
            .busy(&event.hosts, busy_start, busy_end, None)
            .await?;
        busy.extend(
            self.repository
                .busy(&event.hosts, busy_start, busy_end, None)
                .await?,
        );
        self.respect_host_hours(
            &owner,
            event,
            slots_for_date(event, schedule, date, now, &busy)?,
        )
        .await
    }
    async fn respect_host_hours(
        &self,
        owner: &OwnedProfile,
        event: &EventType,
        slots: Vec<Slot>,
    ) -> Result<Vec<Slot>, Error> {
        if owner.team_id.is_none() {
            return Ok(slots);
        }
        let mut schedules = vec![];
        for host in &event.hosts {
            if let Some(personal) = self
                .repository
                .profile(Self::profile_id(host, None))
                .await?
            {
                let schedule = personal
                    .profile
                    .default_schedule_id
                    .and_then(|id| personal.profile.schedules.iter().find(|s| s.id == id))
                    .or_else(|| personal.profile.schedules.first());
                if let Some(schedule) = schedule {
                    schedules.push((host, schedule.clone()));
                }
            }
        }
        let mut available = vec![];
        for mut slot in slots {
            let mut hosts = vec![];
            for host in &slot.hosts {
                let personal = schedules.iter().find(|(id, _)| *id == host);
                if let Some((_, schedule)) = personal
                    && !schedule_contains(schedule, slot.starts_at, slot.ends_at)?
                {
                    continue;
                }
                // Hosts who have not configured personal hours use the shared team schedule.
                hosts.push(host.clone());
            }
            let bookable = match event.mode {
                SchedulingMode::Individual | SchedulingMode::Collective => {
                    hosts.len() == event.hosts.len()
                }
                SchedulingMode::RoundRobin => !hosts.is_empty(),
            };
            if bookable {
                slot.hosts = hosts;
                available.push(slot);
            }
        }
        Ok(available)
    }
    /// Offer times on a booker's local date, across host time-zone boundaries.
    pub async fn slots_in_zone(
        &self,
        profile_id: Uuid,
        event_id: Uuid,
        date: NaiveDate,
        zone: chrono_tz::Tz,
    ) -> Result<Vec<Slot>, Error> {
        let owner = self
            .repository
            .profile(profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        self.repository
            .consume_budget(profile_id, PublicBudget::Availability)
            .await?;
        let event = owner
            .profile
            .event_types
            .iter()
            .find(|e| e.id == event_id)
            .ok_or(Error::NotFound)?;
        let schedule = owner
            .profile
            .schedules
            .iter()
            .find(|s| s.id == event.schedule_id)
            .ok_or(Error::NotFound)?;
        let viewer_schedule = Schedule {
            time_zone: zone,
            ..schedule.clone()
        };
        let (start, end) = day_bounds(&viewer_schedule, date)?;
        let mut host_date = start.with_timezone(&schedule.time_zone).date_naive();
        let last = (end - Duration::seconds(1))
            .with_timezone(&schedule.time_zone)
            .date_naive();
        let mut slots = vec![];
        while host_date <= last {
            slots.extend(
                self.slots(profile_id, event_id, host_date)
                    .await?
                    .into_iter()
                    .filter(|s| s.starts_at >= start && s.starts_at < end),
            );
            host_date = host_date.succ_opt().ok_or(Error::Conflict)?;
        }
        slots.sort_by_key(|s| s.starts_at);
        Ok(slots)
    }
    /// Reserve a slot and create the provider event, or hold it for confirmation.
    pub async fn book(
        &self,
        profile_id: Uuid,
        event_id: Uuid,
        request: BookingRequest,
    ) -> Result<BookingRecord, Error> {
        if let Some(existing) = self.repository.booking_request(request.request_id).await? {
            if existing.profile_id == profile_id
                && existing.booking.event_type_id == event_id
                && existing.booking.email == request.email.trim().to_lowercase()
                && existing.booking.starts_at == request.starts_at
            {
                return Ok(existing);
            }
            return Err(Error::Conflict);
        }
        let owner = self
            .repository
            .profile(profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        let event = owner
            .profile
            .event_types
            .iter()
            .find(|e| e.id == event_id && e.enabled)
            .ok_or(Error::NotFound)?;
        self.validate_booking_hosts(&owner, &event.hosts).await?;
        if event.requires_confirmation {
            return Err(Error::Invalid(
                "This booking link is paused until its host enables automatic confirmation.".into(),
            ));
        }
        if request.name.trim().is_empty()
            || request.name.len() > 200
            || request.email.len() > 254
            || request.email.contains(['\r', '\n', ' '])
            || !request.email.contains('@')
            || request.answers.len() > 20
            || request.answers.values().any(|a| a.len() > 4000)
        {
            return Err(Error::Invalid(
                "Provide a valid name, email, and booking answers".into(),
            ));
        }
        if event.questions.iter().any(|q| {
            q.required
                && request
                    .answers
                    .get(&q.id)
                    .is_none_or(|a| a.trim().is_empty())
        }) || request
            .answers
            .keys()
            .any(|id| !event.questions.iter().any(|q| q.id == *id))
        {
            return Err(Error::Invalid(
                "Complete the required booking questions".into(),
            ));
        }
        self.repository
            .consume_budget(profile_id, PublicBudget::Booking)
            .await?;
        let schedule = owner
            .profile
            .schedules
            .iter()
            .find(|s| s.id == event.schedule_id)
            .ok_or(Error::NotFound)?;
        let date = request
            .starts_at
            .with_timezone(&schedule.time_zone)
            .date_naive();
        let mut slot = self
            .slots(profile_id, event_id, date)
            .await?
            .into_iter()
            .find(|s| s.starts_at == request.starts_at)
            .ok_or(Error::Conflict)?;
        if event.mode == SchedulingMode::RoundRobin {
            let counts = self
                .repository
                .bookings(
                    profile_id,
                    Utc::now() - Duration::days(30),
                    Utc::now() + Duration::days(366),
                )
                .await?;
            slot.hosts.sort_by_key(|host| {
                (
                    counts
                        .iter()
                        .filter(|r| {
                            r.booking.status != BookingStatus::Cancelled
                                && r.booking.hosts.contains(host)
                        })
                        .count(),
                    host.clone(),
                )
            });
            slot.hosts.truncate(1);
        }
        let (day_start, day_end) = day_bounds(schedule, date)?;
        let record = BookingRecord {
            revision: 0,
            event: event.clone(),
            schedule: schedule.clone(),
            profile_id,
            token: Uuid::new_v4(),
            request_id: request.request_id,
            calendar_event_id: None,
            calendar_id: Some(
                self.calendars
                    .creation_calendar(slot.hosts.first().ok_or(Error::CalendarUnavailable)?)
                    .await?,
            ),
            operation: Some(CalendarOperation::new(CalendarOperationKind::Create)),
            busy_start: slot.starts_at - Duration::minutes(i64::from(event.before_minutes)),
            busy_end: slot.ends_at + Duration::minutes(i64::from(event.after_minutes)),
            booking: Booking {
                id: Uuid::now_v7(),
                event_type_id: event_id,
                title: event.title.clone(),
                name: request.name.trim().into(),
                email: request.email.trim().to_lowercase(),
                starts_at: slot.starts_at,
                ends_at: slot.ends_at,
                time_zone: request.time_zone,
                hosts: slot.hosts,
                status: BookingStatus::Processing,
                attendance: BookingAttendance::Unknown,
                reschedule_count: 0,
                rescheduled_at: None,
                location: event.location.clone(),
                answers: request.answers,
            },
        };
        let reservation_id = record.booking.id;
        let record = self
            .repository
            .reserve(record, event.daily_limit, day_start, day_end)
            .await?;
        if record.booking.id != reservation_id {
            return Ok(record);
        }
        self.finish_operation(record).await
    }
    /// Read bookings for a profile, with authorization and a bounded range.
    pub async fn bookings(&self, user: &str, team: Option<Uuid>) -> Result<Vec<Booking>, Error> {
        let now = Utc::now();
        self.bookings_in_range(
            user,
            team,
            now - Duration::days(365),
            now + Duration::days(366),
        )
        .await
    }
    /// Read a complete, authorized half-open range of booking start times.
    /// Oversized ranges or result sets fail explicitly rather than returning partial insights.
    pub async fn bookings_in_range(
        &self,
        user: &str,
        team: Option<Uuid>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<Booking>, Error> {
        if end <= start || end - start > Duration::days(733) {
            return Err(Error::Invalid(
                "Choose a booking date range of no more than 733 days".into(),
            ));
        }
        let id = Self::profile_id(user, team);
        let Some(owner) = self.repository.profile(id).await? else {
            self.settings(user, team).await?;
            return Ok(vec![]);
        };
        self.authorize(user, &owner, false).await?;
        Ok(self
            .repository
            .bookings(id, start, end)
            .await?
            .into_iter()
            .map(|r| r.booking)
            .collect())
    }
    /// Record attendance after a confirmed meeting, as its current host or an administrator.
    pub async fn set_attendance(
        &self,
        user: &str,
        id: Uuid,
        attendance: BookingAttendance,
    ) -> Result<Booking, Error> {
        let mut record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        let owner = self
            .repository
            .profile(record.profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        if record.booking.hosts.iter().any(|host| host == user) {
            self.authorize(user, &owner, false).await?;
        } else {
            self.authorize(user, &owner, true).await?;
        }
        if record.booking.status != BookingStatus::Confirmed || record.booking.ends_at > Utc::now()
        {
            return Err(Error::Invalid(
                "Attendance can be recorded after a confirmed meeting has ended".into(),
            ));
        }
        record.booking.attendance = attendance;
        self.repository
            .update_booking(record.clone(), BookingStatus::Confirmed)
            .await?;
        Ok(record.booking)
    }
    /// Approve a held booking, revalidating membership and calendar conflicts.
    pub async fn approve(&self, user: &str, id: Uuid) -> Result<Booking, Error> {
        let mut record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        let owner = self
            .repository
            .profile(record.profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        self.authorize(user, &owner, true).await?;
        self.validate_booking_hosts(&owner, &record.booking.hosts)
            .await?;
        if record.booking.status != BookingStatus::Pending || record.booking.starts_at <= Utc::now()
        {
            return Err(Error::Conflict);
        }
        if self
            .calendars
            .busy(
                &record.booking.hosts,
                record.busy_start,
                record.busy_end,
                None,
            )
            .await?
            .iter()
            .any(|b| b.start < record.busy_end && b.end > record.busy_start)
        {
            return Err(Error::Conflict);
        }
        record.booking.status = BookingStatus::Processing;
        record.calendar_id = Some(
            self.calendars
                .creation_calendar(
                    record
                        .booking
                        .hosts
                        .first()
                        .ok_or(Error::CalendarUnavailable)?,
                )
                .await?,
        );
        record.operation = Some(CalendarOperation::new(CalendarOperationKind::Create));
        record = self
            .repository
            .update_booking(record, BookingStatus::Pending)
            .await?;
        Ok(self.finish_operation(record).await?.booking)
    }
    /// Let a profile administrator open the booking's management page.
    pub async fn manage(&self, user: &str, id: Uuid) -> Result<BookingRecord, Error> {
        let record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        let owner = self
            .repository
            .profile(record.profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        self.authorize(user, &owner, true).await?;
        Ok(record)
    }
    /// Read a booking using its unguessable booker capability.
    pub async fn receipt(&self, id: Uuid, token: Uuid) -> Result<BookingRecord, Error> {
        let record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        if record.token != token {
            return Err(Error::NotFound);
        }
        Ok(record)
    }
    /// Return replacement slots while excluding this booking's own reservation and calendar event.
    pub async fn replacement_slots(
        &self,
        id: Uuid,
        token: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        let record = self.receipt(id, token).await?;
        self.repository
            .consume_budget(record.profile_id, PublicBudget::Availability)
            .await?;
        if !matches!(
            record.booking.status,
            BookingStatus::Pending | BookingStatus::Confirmed
        ) {
            return Err(Error::Conflict);
        }
        let owner = self
            .repository
            .profile(record.profile_id)
            .await?
            .ok_or(Error::NotFound)?;
        let mut event = record.event.clone();
        event.hosts = record.booking.hosts.clone();
        event.mode = if event.hosts.len() == 1 {
            SchedulingMode::Individual
        } else {
            SchedulingMode::Collective
        };
        // Current membership is authoritative even when the original link was removed.
        self.validate_booking_hosts(&owner, &event.hosts).await?;
        if event.requires_confirmation {
            return Err(Error::Invalid(
                "This booking link is paused until its host enables automatic confirmation.".into(),
            ));
        }
        let (start, end) = day_bounds(&record.schedule, date)?;
        if start > Utc::now() + Duration::days(i64::from(event.horizon_days) + 1)
            || end < Utc::now()
        {
            return Ok(vec![]);
        }
        let occupied_start = start - Duration::minutes(i64::from(event.before_minutes));
        let occupied_end = end + Duration::minutes(i64::from(event.after_minutes));
        let mut busy = self
            .calendars
            .busy(
                &event.hosts,
                occupied_start,
                occupied_end,
                record.calendar_event_id,
            )
            .await?;
        busy.extend(
            self.repository
                .busy(&event.hosts, occupied_start, occupied_end, Some(id))
                .await?,
        );
        self.respect_host_hours(
            &owner,
            &event,
            slots_for_date(&event, &record.schedule, date, Utc::now(), &busy)?,
        )
        .await
    }
    /// Move a booking while retaining both reservations until the calendar accepts the change.
    pub async fn reschedule(
        &self,
        id: Uuid,
        token: Uuid,
        starts_at: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        let mut record = self.receipt(id, token).await?;
        let original_start = record.booking.starts_at;
        let date = starts_at
            .with_timezone(&record.schedule.time_zone)
            .date_naive();
        let slot = self
            .replacement_slots(id, token, date)
            .await?
            .into_iter()
            .find(|s| s.starts_at == starts_at)
            .ok_or(Error::Conflict)?;
        let original_status = record.booking.status;
        record.booking.starts_at = slot.starts_at;
        record.booking.ends_at = slot.ends_at;
        record.busy_start =
            slot.starts_at - Duration::minutes(i64::from(record.event.before_minutes));
        record.busy_end = slot.ends_at + Duration::minutes(i64::from(record.event.after_minutes));
        record.booking.status = BookingStatus::Processing;
        record.operation = Some(CalendarOperation::new(CalendarOperationKind::Move {
            status: original_status,
            original_start,
        }));
        let (start, end) = day_bounds(&record.schedule, date)?;
        record = self
            .repository
            .move_booking(record, original_status, start, end)
            .await?;
        self.finish_operation(record).await
    }
    /// Cancel through a booker capability or an authorized profile administrator.
    pub async fn cancel(
        &self,
        id: Uuid,
        token: Option<Uuid>,
        user: Option<&str>,
    ) -> Result<Booking, Error> {
        let mut record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        if token != Some(record.token) {
            let owner = self
                .repository
                .profile(record.profile_id)
                .await?
                .ok_or(Error::NotFound)?;
            self.authorize(user.ok_or(Error::Forbidden)?, &owner, true)
                .await?;
        }
        if record.booking.status == BookingStatus::Cancelled {
            return Ok(record.booking);
        }
        let expected = record.booking.status;
        if expected == BookingStatus::Processing || expected == BookingStatus::Failed {
            return Err(Error::Conflict);
        }
        record.booking.status = BookingStatus::Processing;
        record.operation = Some(CalendarOperation::new(CalendarOperationKind::Cancel));
        record = self.repository.update_booking(record, expected).await?;
        Ok(self.finish_operation(record).await?.booking)
    }
}
fn day_bounds(
    schedule: &Schedule,
    date: NaiveDate,
) -> Result<(DateTime<Utc>, DateTime<Utc>), Error> {
    let start = schedule
        .time_zone
        .from_local_datetime(&date.and_hms_opt(0, 0, 0).ok_or(Error::Conflict)?)
        .earliest()
        .ok_or(Error::Conflict)?;
    let end = schedule
        .time_zone
        .from_local_datetime(
            &date
                .succ_opt()
                .ok_or(Error::Conflict)?
                .and_hms_opt(0, 0, 0)
                .ok_or(Error::Conflict)?,
        )
        .earliest()
        .ok_or(Error::Conflict)?;
    Ok((start.with_timezone(&Utc), end.with_timezone(&Utc)))
}

#[cfg(test)]
mod test;
