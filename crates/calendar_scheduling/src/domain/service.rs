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
    pub(super) directory: D,
}
impl<R: Repository, C, D: Directory> Service<R, C, D> {
    /// Construct the scheduling use-case service.
    pub fn new(repository: R, calendars: C, directory: D) -> Self {
        Self {
            repository,
            calendars,
            directory,
        }
    }
    /// Validate a saved booking destination for an authorized authoring integration.
    pub async fn validate_attachment(
        &self,
        user: &str,
        profile: Uuid,
        event: Uuid,
    ) -> Result<(), Error>
    where
        C: AttachmentReadiness,
    {
        let owner = self
            .repository
            .profile(profile)
            .await?
            .ok_or(Error::NotFound)?;
        self.authorize(user, &owner, false).await?;
        let event = owner
            .profile
            .event_types
            .iter()
            .find(|e| e.id == event && e.enabled)
            .ok_or(Error::NotFound)?;
        if event.requires_confirmation
            || event.hosts.is_empty()
            || !owner
                .profile
                .schedules
                .iter()
                .any(|s| s.id == event.schedule_id)
        {
            return Err(Error::Invalid(
                "Choose an enabled booking link with a schedule, hosts and automatic confirmation."
                    .into(),
            ));
        }
        self.validate_booking_hosts(&owner, &event.hosts).await?;
        for host in &event.hosts {
            self.calendars.ready(host, event.email_link_id).await?;
        }
        Ok(())
    }
    /// Deterministic opaque identity for a personal or team scheduling profile.
    pub fn profile_id(user: &str, team: Option<Uuid>) -> Uuid {
        let scope = team.map_or_else(
            || format!("macro:scheduling:user:{user}"),
            |t| format!("macro:scheduling:team:{t}"),
        );
        Uuid::new_v5(&Uuid::NAMESPACE_URL, scope.as_bytes())
    }
    /// Any team member may read and edit their team's profile; `admin` limits
    /// the action to the team's administrators.
    pub(super) async fn authorize(
        &self,
        user: &str,
        owner: &OwnedProfile,
        admin: bool,
    ) -> Result<(), Error> {
        if let Some(team) = owner.team_id {
            if self
                .directory
                .members(team)
                .await?
                .iter()
                .any(|m| m.user_id == user && (!admin || m.admin))
            {
                return Ok(());
            }
        } else if owner.user_id.as_deref() == Some(user) {
            return Ok(());
        }
        Err(Error::Forbidden)
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
    /// Save a validated, revision-protected profile. Any team member may edit team links.
    pub async fn save(
        &self,
        user: &str,
        team: Option<Uuid>,
        profile: Profile,
    ) -> Result<Profile, Error>
    where
        C: BookingAccounts,
    {
        if profile.id != Self::profile_id(user, team) {
            return Err(Error::Forbidden);
        }
        validate_profile(&profile, team.is_some())?;
        let owner = OwnedProfile {
            user_id: team.is_none().then(|| user.to_owned()),
            team_id: team,
            profile,
        };
        self.authorize(user, &owner, false).await?;
        let previous = self.repository.profile(owner.profile.id).await?;
        self.validate_hosts(&owner, previous.as_ref()).await?;
        self.validate_accounts(&owner, previous.as_ref()).await?;
        self.repository.save_profile(owner).await
    }
    /// A personal link books only on a connected account its host can write,
    /// and a video meeting needs an account that can add one. Only a changed
    /// account, or one newly asked for a video meeting, is checked, so a link
    /// whose account was removed since does not block saving the profile's
    /// other links; it takes no bookings until its owner picks another.
    async fn validate_accounts(
        &self,
        owner: &OwnedProfile,
        previous: Option<&OwnedProfile>,
    ) -> Result<(), Error>
    where
        C: BookingAccounts,
    {
        let changed = owner
            .profile
            .event_types
            .iter()
            .filter(|event| {
                let old =
                    previous.and_then(|p| p.profile.event_types.iter().find(|e| e.id == event.id));
                event.email_link_id.is_some()
                    && !old.is_some_and(|old| {
                        old.email_link_id == event.email_link_id
                            && (old.google_meet || !event.google_meet)
                    })
            })
            .collect::<Vec<_>>();
        if changed.is_empty() {
            return Ok(());
        }
        let host = owner.user_id.as_deref().ok_or(Error::Forbidden)?;
        let accounts = self.calendars.booking_accounts(host).await?;
        for event in changed {
            let account = accounts
                .iter()
                .find(|account| Some(account.email_link_id) == event.email_link_id)
                .ok_or_else(|| {
                    Error::Invalid(
                        "Choose one of your connected accounts for this booking link".into(),
                    )
                })?;
            if event.google_meet && !account.video_meetings {
                return Err(Error::Invalid(format!(
                    "{} can't add video meetings. Choose a Macro call or a custom location.",
                    account.email_address
                )));
            }
        }
        Ok(())
    }
    async fn validate_hosts(
        &self,
        owner: &OwnedProfile,
        previous: Option<&OwnedProfile>,
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
        for event in &owner.profile.event_types {
            let old =
                previous.and_then(|p| p.profile.event_types.iter().find(|e| e.id == event.id));
            // Permit repairing one legacy event at a time; booking still validates current hosts.
            if event.requires_confirmation && !old.is_some_and(|e| e.requires_confirmation) {
                return Err(Error::Invalid(
                    "Manual approval is not available yet. Use automatic confirmation.".into(),
                ));
            }
            if event.hosts.iter().any(|host| !members.contains(host))
                && !old.is_some_and(|e| e.hosts == event.hosts && (!event.enabled || e.enabled))
            {
                return Err(Error::Invalid(
                    "Every host must be a current member of this calendar's owner".into(),
                ));
            }
        }
        Ok(())
    }
}
impl<R: Repository, C: Calendars, D: Directory> Service<R, C, D> {
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
                    macro_call: e.macro_call,
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
        self.slots_for_owner(&owner, event_id, date).await
    }
    async fn slots_for_owner(
        &self,
        owner: &OwnedProfile,
        event_id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        let profile_id = owner.profile.id;
        let event = owner
            .profile
            .event_types
            .iter()
            .find(|e| e.id == event_id && e.enabled)
            .ok_or(Error::NotFound)?;
        self.validate_booking_hosts(owner, &event.hosts).await?;
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
        if let Some(limit) = event.daily_limit {
            let count = self
                .repository
                .daily_bookings(profile_id, event_id, start, end, None)
                .await?;
            if count >= i64::from(limit) {
                return Ok(vec![]);
            }
        }
        let busy_start = start - Duration::minutes(i64::from(event.before_minutes));
        let busy_end = end + Duration::minutes(i64::from(event.after_minutes));
        let mut busy = self
            .calendars
            .busy(
                &event.hosts,
                busy_start,
                busy_end,
                None,
                event.email_link_id,
            )
            .await?;
        busy.extend(
            self.repository
                .busy(&event.hosts, busy_start, busy_end, None)
                .await?,
        );
        self.respect_host_hours(
            owner,
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
                self.slots_for_owner(&owner, event_id, host_date)
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
    #[tracing::instrument(
        name = "scheduling.book",
        skip_all,
        fields(
            profile_id = %profile_id,
            event_type_id = %event_id,
            booking_id = tracing::field::Empty,
            email_link_id = tracing::field::Empty,
            status = tracing::field::Empty,
        ),
        err(level = tracing::Level::DEBUG)
    )]
    pub async fn book(
        &self,
        profile_id: Uuid,
        event_id: Uuid,
        request: BookingRequest,
    ) -> Result<BookingRecord, Error> {
        if let Some(existing) = self.requested(profile_id, event_id, &request).await? {
            return Ok(existing);
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
        if let Some(inbox) = event.email_link_id {
            tracing::Span::current().record("email_link_id", tracing::field::display(inbox));
        }
        if event.requires_confirmation {
            return Err(Error::Invalid(
                "This booking link is paused until its host enables automatic confirmation.".into(),
            ));
        }
        if request.name.trim().is_empty()
            || request.name.len() > 200
            || request.email.len() > 254
            || !email_validator::is_valid_email(&request.email)
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
        let Some(mut slot) = self
            .slots_for_owner(&owner, event_id, date)
            .await?
            .into_iter()
            .find(|s| s.starts_at == request.starts_at)
        else {
            // A resend can miss its own first attempt above and then find the
            // time taken by it.
            return self
                .requested(profile_id, event_id, &request)
                .await?
                .ok_or(Error::Conflict);
        };
        if event.mode == SchedulingMode::RoundRobin {
            let counts = self
                .repository
                .host_booking_counts(
                    profile_id,
                    &slot.hosts,
                    Utc::now() - Duration::days(30),
                    Utc::now() + Duration::days(366),
                )
                .await?;
            slot.hosts
                .sort_by_key(|host| (counts.get(host).copied().unwrap_or(0), host.clone()));
        }
        let mut backup_hosts =
            if event.mode == SchedulingMode::RoundRobin && slot.hosts.len() > 1 {
                slot.hosts.split_off(1)
            } else {
                Vec::new()
            }
            .into_iter();
        let (day_start, day_end) = day_bounds(schedule, date)?;
        let mut record = BookingRecord {
            revision: 0,
            event: event.clone(),
            schedule: schedule.clone(),
            profile_id,
            token: Uuid::new_v4(),
            request_id: request.request_id,
            calendar_event_id: None,
            calendar_id: Some(
                self.calendars
                    .creation_calendar(
                        slot.hosts.first().ok_or(Error::CalendarUnavailable)?,
                        event.email_link_id,
                    )
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
                abandoned_at: None,
                location: event.location.clone(),
                answers: request.answers,
                question_labels: event
                    .questions
                    .iter()
                    .map(|q| (q.id, q.label.clone()))
                    .collect(),
            },
        };
        let reservation_id = record.booking.id;
        let booked = loop {
            match self
                .repository
                .reserve(record.clone(), event.daily_limit, day_start, day_end)
                .await
            {
                Ok(reserved) if reserved.booking.id != reservation_id => break reserved,
                Ok(reserved) => break self.finish_operation(reserved).await?,
                Err(Error::Conflict) => {
                    let host = backup_hosts.next().ok_or(Error::Conflict)?;
                    record.calendar_id = Some(
                        self.calendars
                            .creation_calendar(&host, event.email_link_id)
                            .await?,
                    );
                    record.booking.hosts = vec![host];
                }
                Err(error) => return Err(error),
            }
        };
        let span = tracing::Span::current();
        span.record("booking_id", tracing::field::display(booked.booking.id));
        span.record("status", tracing::field::debug(booked.booking.status));
        Ok(booked)
    }
    /// The booking an earlier send of this request made, if any; another
    /// booking under the same request id conflicts.
    async fn requested(
        &self,
        profile_id: Uuid,
        event_id: Uuid,
        request: &BookingRequest,
    ) -> Result<Option<BookingRecord>, Error> {
        let Some(existing) = self.repository.booking_request(request.request_id).await? else {
            return Ok(None);
        };
        if existing.profile_id == profile_id
            && existing.booking.event_type_id == event_id
            && existing.booking.email == request.email.trim().to_lowercase()
            && existing.booking.starts_at == request.starts_at
        {
            return Ok(Some(existing));
        }
        Err(Error::Conflict)
    }
    /// Read bookings for a profile, with authorization and a bounded range.
    pub async fn bookings(&self, user: &str, team: Option<Uuid>) -> Result<Vec<Booking>, Error> {
        let now = Utc::now();
        self.bookings_in_range(
            user,
            team,
            now - Duration::days(30),
            now + Duration::days(31),
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
            .map(|mut r| {
                r.booking.question_labels = r
                    .event
                    .questions
                    .into_iter()
                    .map(|q| (q.id, q.label))
                    .collect();
                r.booking
            })
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
        self.authorize_booking(user, &owner, &record).await?;
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
        let busy = self
            .calendars
            .busy(
                &record.booking.hosts,
                record.busy_start,
                record.busy_end,
                None,
                record.event.email_link_id,
            )
            .await?;
        if busy.iter().any(|interval| interval.end < interval.start) {
            return Err(Error::CalendarUnavailable);
        }
        if busy
            .iter()
            .any(|b| b.start < b.end && b.start < record.busy_end && b.end > record.busy_start)
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
                    record.event.email_link_id,
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
        self.authorize_booking(user, &owner, &record).await?;
        Ok(record)
    }
    /// Hosts may manage the meetings they host; anyone else needs admin rights.
    async fn authorize_booking(
        &self,
        user: &str,
        owner: &OwnedProfile,
        record: &BookingRecord,
    ) -> Result<(), Error> {
        let hosts = record.booking.hosts.iter().any(|host| host == user);
        self.authorize(user, owner, !hosts).await
    }
    /// Read a booking using its unguessable booker capability.
    pub async fn receipt(&self, id: Uuid, token: Uuid) -> Result<BookingRecord, Error> {
        let record = self.repository.booking(id).await?.ok_or(Error::NotFound)?;
        if record.token != token {
            return Err(Error::NotFound);
        }
        Ok(record)
    }
    /// Return slots on the visitor's date, excluding this booking's reservation and calendar event.
    /// Omitting the visitor zone preserves host-date semantics for existing clients.
    #[tracing::instrument(skip_all, fields(booking_id = %id, %date, time_zone = ?zone), err)]
    pub async fn replacement_slots(
        &self,
        id: Uuid,
        token: Uuid,
        date: NaiveDate,
        zone: Option<chrono_tz::Tz>,
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
        let viewer_schedule = Schedule {
            time_zone: zone.unwrap_or(record.schedule.time_zone),
            ..record.schedule.clone()
        };
        let (start, end) = day_bounds(&viewer_schedule, date)?;
        if start > Utc::now() + Duration::days(i64::from(event.horizon_days) + 1)
            || end < Utc::now()
        {
            return Ok(vec![]);
        }
        let occupied_start = start - Duration::minutes(i64::from(event.before_minutes));
        // A slot starting before visitor midnight may finish on their next day.
        let occupied_end = end
            + Duration::minutes(i64::from(event.duration_minutes) + i64::from(event.after_minutes));
        let mut busy = self
            .calendars
            .busy(
                &event.hosts,
                occupied_start,
                occupied_end,
                record.calendar_event_id,
                event.email_link_id,
            )
            .await?;
        busy.extend(
            self.repository
                .busy(&event.hosts, occupied_start, occupied_end, Some(id))
                .await?,
        );
        let mut host_date = start.with_timezone(&record.schedule.time_zone).date_naive();
        let last = (end - Duration::seconds(1))
            .with_timezone(&record.schedule.time_zone)
            .date_naive();
        let mut slots = vec![];
        let now = Utc::now();
        while host_date <= last {
            if !self.day_full_for_move(&record, host_date).await? {
                slots.extend(
                    slots_for_date(&event, &record.schedule, host_date, now, &busy)?
                        .into_iter()
                        .filter(|s| s.starts_at >= start && s.starts_at < end),
                );
            }
            host_date = host_date.succ_opt().ok_or(Error::Conflict)?;
        }
        slots.sort_by_key(|s| s.starts_at);
        self.respect_host_hours(&owner, &event, slots).await
    }
    /// Whether the booking link's daily limit leaves no place for `record` on
    /// this schedule date, counted as the move itself counts it: the booking
    /// being moved never takes a place from itself.
    async fn day_full_for_move(
        &self,
        record: &BookingRecord,
        date: NaiveDate,
    ) -> Result<bool, Error> {
        let Some(limit) = record.event.daily_limit else {
            return Ok(false);
        };
        let (start, end) = day_bounds(&record.schedule, date)?;
        let count = self
            .repository
            .daily_bookings(
                record.profile_id,
                record.booking.event_type_id,
                start,
                end,
                Some(record.booking.id),
            )
            .await?;
        Ok(count >= i64::from(limit))
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
            .replacement_slots(id, token, date, None)
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
            self.authorize_booking(user.ok_or(Error::Forbidden)?, &owner, &record)
                .await?;
        }
        if record.booking.status == BookingStatus::Cancelled {
            return Ok(record.booking);
        }
        let expected = record.booking.status;
        // Recovery owns a failed booking until it abandons the operation; after
        // that, cancelling is the only way to release its reservations.
        let abandoned = record
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_some());
        if expected == BookingStatus::Processing
            || (expected == BookingStatus::Failed && !abandoned)
        {
            return Err(Error::Conflict);
        }
        // A create refused on its first attempt never reached the calendar,
        // so there is no event to remove and the cancellation needs no
        // calendar change.
        if expected == BookingStatus::Failed
            && record.operation.as_ref().is_some_and(|operation| {
                operation.unsent && matches!(operation.kind, CalendarOperationKind::Create)
            })
        {
            record.booking.status = BookingStatus::Cancelled;
            record.booking.abandoned_at = None;
            let cancelled = self.repository.update_booking(record, expected).await?;
            tracing::info!(booking_id = %cancelled.booking.id, "scheduling booking cancelled; its calendar never received it");
            return Ok(cancelled.booking);
        }
        record.booking.status = BookingStatus::Processing;
        record.booking.abandoned_at = None;
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
