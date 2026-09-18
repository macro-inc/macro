use super::*;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
#[derive(Default)]
struct Memory {
    fail_completion: AtomicBool,
    profiles: Mutex<HashMap<Uuid, OwnedProfile>>,
    bookings: Mutex<HashMap<Uuid, BookingRecord>>,
}
impl Repository for Arc<Memory> {
    async fn consume_budget(&self, _: Uuid, _: PublicBudget) -> Result<(), Error> {
        Ok(())
    }
    async fn claim_recovery(&self) -> Result<Option<BookingRecord>, Error> {
        let mut data = self.bookings.lock().unwrap();
        let Some(record) = data.values_mut().find(|r| {
            matches!(
                r.booking.status,
                BookingStatus::Processing | BookingStatus::Failed
            ) && r
                .operation
                .as_ref()
                .is_some_and(|o| o.retry_at <= Utc::now())
        }) else {
            return Ok(None);
        };
        let operation = record.operation.as_mut().unwrap();
        operation.attempt += 1;
        record.revision += 1;
        operation.retry_at = Utc::now() + Duration::minutes(5);
        record.booking.status = BookingStatus::Processing;
        Ok(Some(record.clone()))
    }
    async fn profile(&self, id: Uuid) -> Result<Option<OwnedProfile>, Error> {
        Ok(self.profiles.lock().unwrap().get(&id).cloned())
    }
    async fn save_profile(&self, mut p: OwnedProfile) -> Result<Profile, Error> {
        let mut data = self.profiles.lock().unwrap();
        if data
            .get(&p.profile.id)
            .is_some_and(|old| old.profile.revision != p.profile.revision)
        {
            return Err(Error::Conflict);
        }
        p.profile.revision += 1;
        let out = p.profile.clone();
        data.insert(p.profile.id, p);
        Ok(out)
    }
    async fn bookings(
        &self,
        p: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<BookingRecord>, Error> {
        Ok(self
            .bookings
            .lock()
            .unwrap()
            .values()
            .filter(|r| {
                r.profile_id == p && r.booking.starts_at >= start && r.booking.starts_at < end
            })
            .cloned()
            .collect())
    }
    async fn busy(
        &self,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        Ok(self
            .bookings
            .lock()
            .unwrap()
            .values()
            .filter(|r| {
                Some(r.booking.id) != exclude
                    && r.booking.status != BookingStatus::Cancelled
                    && r.busy_start < end
                    && r.busy_end > start
            })
            .flat_map(|r| {
                r.booking
                    .hosts
                    .iter()
                    .filter(|h| hosts.contains(h))
                    .map(|h| BusyRange {
                        host: h.clone(),
                        start: r.busy_start,
                        end: r.busy_end,
                    })
            })
            .collect())
    }
    async fn reserve(
        &self,
        r: BookingRecord,
        _: Option<u16>,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        let mut data = self.bookings.lock().unwrap();
        if data.values().any(|b| {
            b.booking.status != BookingStatus::Cancelled
                && b.busy_start < r.busy_end
                && b.busy_end > r.busy_start
                && b.booking.hosts.iter().any(|h| r.booking.hosts.contains(h))
        }) {
            return Err(Error::Conflict);
        }
        data.insert(r.booking.id, r.clone());
        Ok(r)
    }
    async fn booking(&self, id: Uuid) -> Result<Option<BookingRecord>, Error> {
        Ok(self.bookings.lock().unwrap().get(&id).cloned())
    }
    async fn booking_request(&self, id: Uuid) -> Result<Option<BookingRecord>, Error> {
        Ok(self
            .bookings
            .lock()
            .unwrap()
            .values()
            .find(|r| r.request_id == id)
            .cloned())
    }
    async fn update_booking(
        &self,
        mut r: BookingRecord,
        expected: BookingStatus,
    ) -> Result<BookingRecord, Error> {
        if expected == BookingStatus::Processing
            && self.fail_completion.swap(false, Ordering::SeqCst)
        {
            return Err(Error::Unavailable);
        }
        let mut data = self.bookings.lock().unwrap();
        if data.get(&r.booking.id).is_none_or(|old| {
            old.revision != r.revision
                || old.booking.status != expected
                || (expected == BookingStatus::Processing
                    && old.operation.as_ref().map(|o| (o.id, o.attempt))
                        != r.operation.as_ref().map(|o| (o.id, o.attempt)))
        }) {
            return Err(Error::Conflict);
        }
        r.revision += 1;
        data.insert(r.booking.id, r.clone());
        Ok(r)
    }
    async fn move_booking(
        &self,
        r: BookingRecord,
        expected: BookingStatus,
        _: DateTime<Utc>,
        _: DateTime<Utc>,
    ) -> Result<BookingRecord, Error> {
        self.update_booking(r, expected).await
    }
}
#[derive(Default)]
struct Calendar {
    creates: AtomicUsize,
    fail: bool,
    fail_reschedule: bool,
    lose_create_response: AtomicBool,
    lose_move_response: AtomicBool,
    lose_cancel_response: AtomicBool,
    events: Mutex<HashMap<Uuid, Uuid>>,
}
impl Calendars for Arc<Calendar> {
    async fn creation_calendar(&self, _: &str) -> Result<Uuid, Error> {
        Ok(Uuid::nil())
    }
    async fn busy(
        &self,
        _: &[String],
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        Ok(vec![])
    }
    async fn create(&self, record: &BookingRecord, _: &EventType) -> Result<(Uuid, String), Error> {
        if self.fail {
            return Err(Error::CalendarUnavailable);
        }
        let id = *self
            .events
            .lock()
            .unwrap()
            .entry(record.booking.id)
            .or_insert_with(|| {
                self.creates.fetch_add(1, Ordering::SeqCst);
                Uuid::now_v7()
            });
        if self.lose_create_response.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok((id, "https://meet.google.com/test".into()))
    }
    async fn cancel(&self, _: &BookingRecord) -> Result<(), Error> {
        if self.lose_cancel_response.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok(())
    }
    async fn reschedule(&self, _: &BookingRecord) -> Result<(), Error> {
        if self.fail_reschedule || self.lose_move_response.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok(())
    }
}
struct Members;
impl Directory for Members {
    async fn members(&self, _: Uuid) -> Result<Vec<TeamMember>, Error> {
        Ok(vec![
            TeamMember {
                user_id: "admin".into(),
                admin: true,
            },
            TeamMember {
                user_id: "member".into(),
                admin: false,
            },
        ])
    }
}
type TestService = Service<Arc<Memory>, Arc<Calendar>, Members>;
fn profile(team: Option<Uuid>) -> Profile {
    let schedule = Schedule {
        id: Uuid::new_v4(),
        name: "Work".into(),
        time_zone: chrono_tz::UTC,
        weekly: (0..7)
            .map(|day| WeeklyDay {
                day,
                windows: vec![TimeWindow {
                    start: "09:00".into(),
                    end: "17:00".into(),
                }],
            })
            .collect(),
        overrides: vec![],
    };
    let event = EventType {
        id: Uuid::new_v4(),
        title: "Meeting".into(),
        slug: "meeting".into(),
        description: String::new(),
        duration_minutes: 30,
        location: String::new(),
        google_meet: false,
        enabled: true,
        schedule_id: schedule.id,
        mode: if team.is_some() {
            SchedulingMode::RoundRobin
        } else {
            SchedulingMode::Individual
        },
        hosts: if team.is_some() {
            vec!["admin".into(), "member".into()]
        } else {
            vec!["admin".into()]
        },
        before_minutes: 0,
        after_minutes: 0,
        notice_minutes: 0,
        horizon_days: 30,
        interval_minutes: 30,
        daily_limit: None,
        requires_confirmation: false,
        questions: vec![],
    };
    Profile {
        id: TestService::profile_id("admin", team),
        name: "Calendar".into(),
        description: String::new(),
        default_schedule_id: Some(schedule.id),
        schedules: vec![schedule],
        event_types: vec![event],
        revision: 0,
    }
}
fn request() -> BookingRequest {
    BookingRequest {
        starts_at: (Utc::now().date_naive() + Duration::days(2))
            .and_hms_opt(10, 0, 0)
            .unwrap()
            .and_utc(),
        name: "Booker".into(),
        email: "guest@example.com".into(),
        time_zone: chrono_tz::UTC,
        answers: Default::default(),
        request_id: Uuid::new_v4(),
    }
}
#[tokio::test]
async fn team_permissions_and_host_membership_are_server_enforced() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let team = Some(Uuid::new_v4());
    let p = profile(team);
    assert!(matches!(
        service.save("member", team, p.clone()).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.settings("stranger", team).await,
        Err(Error::Forbidden)
    ));
    let mut bad = p.clone();
    bad.event_types[0].hosts.push("stranger".into());
    assert!(matches!(
        service.save("admin", team, bad).await,
        Err(Error::Invalid(_))
    ));
    assert!(service.save("admin", team, p).await.is_ok());
    assert!(service.settings("member", team).await.is_ok());
}
#[tokio::test]
async fn personal_calendar_cannot_impersonate_another_host() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let mut p = profile(None);
    p.event_types[0].hosts = vec!["member".into()];
    assert!(matches!(
        service.save("admin", None, p).await,
        Err(Error::Invalid(_))
    ));
}
#[tokio::test]
async fn booking_retry_is_idempotent_and_another_request_conflicts() {
    let cal = Arc::new(Calendar::default());
    let service = TestService::new(Arc::new(Memory::default()), cal.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = request();
    let a = service
        .book(p.id, p.event_types[0].id, r.clone())
        .await
        .unwrap();
    let b = service.book(p.id, p.event_types[0].id, r).await.unwrap();
    assert_eq!(a.booking.id, b.booking.id);
    assert_eq!(cal.creates.load(Ordering::SeqCst), 1);
    assert!(matches!(
        service.book(p.id, p.event_types[0].id, request()).await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        service.receipt(a.booking.id, Uuid::new_v4()).await,
        Err(Error::NotFound)
    ));
    service
        .cancel(a.booking.id, Some(a.token), None)
        .await
        .unwrap();
    assert!(
        service
            .book(p.id, p.event_types[0].id, request())
            .await
            .is_ok()
    );
}
#[tokio::test]
async fn round_robin_assigns_distinct_available_hosts() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let team = Some(Uuid::new_v4());
    let p = service.save("admin", team, profile(team)).await.unwrap();
    let a = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let b = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_ne!(a.booking.hosts, b.booking.hosts);
    assert_eq!(a.booking.hosts.len(), 1);
    assert_eq!(b.booking.hosts.len(), 1);
}
#[tokio::test]
async fn pending_booking_can_be_approved_after_link_is_removed() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let p = profile(None);
    let mut p = service.save("admin", None, p).await.unwrap();
    let booking = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let mut legacy = booking.clone();
    legacy.booking.status = BookingStatus::Pending;
    legacy.calendar_event_id = None;
    service
        .repository
        .bookings
        .lock()
        .unwrap()
        .insert(legacy.booking.id, legacy);
    p.event_types.clear();
    service.save("admin", None, p).await.unwrap();
    assert_eq!(
        service
            .approve("admin", booking.booking.id)
            .await
            .unwrap()
            .status,
        BookingStatus::Confirmed
    );
}
#[tokio::test]
async fn provider_failure_retains_reservation_instead_of_risking_a_duplicate() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar {
            creates: AtomicUsize::new(0),
            fail: true,
            fail_reschedule: false,
            ..Default::default()
        }),
        Members,
    );
    let p = service.save("admin", None, profile(None)).await.unwrap();
    assert_eq!(
        service
            .book(p.id, p.event_types[0].id, request())
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Failed
    );
    assert!(matches!(
        service.book(p.id, p.event_types[0].id, request()).await,
        Err(Error::Conflict)
    ));
}

#[tokio::test]
async fn reschedule_keeps_identity_and_releases_the_old_slot() {
    let cal = Arc::new(Calendar::default());
    let service = TestService::new(Arc::new(Memory::default()), cal.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let a = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let next = a.booking.starts_at + Duration::hours(1);
    assert!(matches!(
        service.manage("stranger", a.booking.id).await,
        Err(Error::Forbidden)
    ));
    let b = service
        .reschedule(a.booking.id, a.token, next)
        .await
        .unwrap();
    assert_eq!(b.booking.id, a.booking.id);
    assert_eq!(b.calendar_event_id, a.calendar_event_id);
    assert_eq!(b.booking.starts_at, next);
    assert_eq!(b.booking.status, BookingStatus::Confirmed);
    assert_eq!(b.booking.reschedule_count, 1);
    assert!(b.booking.rescheduled_at.is_some());
    let unchanged = service
        .reschedule(b.booking.id, b.token, next)
        .await
        .unwrap();
    assert_eq!(unchanged.booking.reschedule_count, 1);
    assert_eq!(unchanged.booking.rescheduled_at, b.booking.rescheduled_at);
    assert_eq!(cal.creates.load(Ordering::SeqCst), 1);
    assert!(
        service
            .book(p.id, p.event_types[0].id, request())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn visitor_time_zone_uses_the_visitors_local_date() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let date = request().starts_at.date_naive();
    let zone = chrono_tz::Pacific::Auckland;
    let slots = service
        .slots_in_zone(p.id, p.event_types[0].id, date, zone)
        .await
        .unwrap();
    assert!(!slots.is_empty());
    assert!(
        slots
            .iter()
            .all(|s| s.starts_at.with_timezone(&zone).date_naive() == date)
    );
}

#[tokio::test]
async fn approval_rechecks_assigned_hosts_even_after_link_removal() {
    struct ChangingMembers(Arc<Mutex<Vec<TeamMember>>>);
    impl Directory for ChangingMembers {
        async fn members(&self, _: Uuid) -> Result<Vec<TeamMember>, Error> {
            Ok(self.0.lock().unwrap().clone())
        }
    }
    let members = Arc::new(Mutex::new(vec![
        TeamMember {
            user_id: "admin".into(),
            admin: true,
        },
        TeamMember {
            user_id: "member".into(),
            admin: false,
        },
    ]));
    let service = Service::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        ChangingMembers(members.clone()),
    );
    let team = Some(Uuid::new_v4());
    let mut p = profile(team);
    p.event_types[0].hosts = vec!["member".into()];
    let mut p = service.save("admin", team, p).await.unwrap();
    let b = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let mut legacy = b.clone();
    legacy.booking.status = BookingStatus::Pending;
    legacy.calendar_event_id = None;
    service
        .repository
        .bookings
        .lock()
        .unwrap()
        .insert(legacy.booking.id, legacy);
    p.event_types.clear();
    service.save("admin", team, p).await.unwrap();
    members.lock().unwrap().retain(|m| m.admin);
    assert!(matches!(
        service.approve("admin", b.booking.id).await,
        Err(Error::Forbidden)
    ));
}

#[tokio::test]
async fn attendance_requires_finished_confirmed_booking_and_current_host_or_admin() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let team = Some(Uuid::new_v4());
    let mut p = profile(team);
    p.event_types[0].hosts = vec!["member".into()];
    let p = service.save("admin", team, p).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert!(matches!(
        service
            .set_attendance("member", r.booking.id, BookingAttendance::Attended)
            .await,
        Err(Error::Invalid(_))
    ));
    {
        let mut data = store.bookings.lock().unwrap();
        let r = data.get_mut(&r.booking.id).unwrap();
        r.booking.starts_at = Utc::now() - Duration::hours(2);
        r.booking.ends_at = Utc::now() - Duration::hours(1);
    }
    assert!(matches!(
        service
            .set_attendance("stranger", r.booking.id, BookingAttendance::GuestNoShow)
            .await,
        Err(Error::Forbidden)
    ));
    assert_eq!(
        service
            .set_attendance("member", r.booking.id, BookingAttendance::Attended)
            .await
            .unwrap()
            .attendance,
        BookingAttendance::Attended
    );
    assert_eq!(
        service
            .set_attendance("admin", r.booking.id, BookingAttendance::GuestNoShow)
            .await
            .unwrap()
            .attendance,
        BookingAttendance::GuestNoShow
    );
    assert_eq!(
        service
            .set_attendance("admin", r.booking.id, BookingAttendance::Unknown)
            .await
            .unwrap()
            .attendance,
        BookingAttendance::Unknown
    );
    store
        .bookings
        .lock()
        .unwrap()
        .get_mut(&r.booking.id)
        .unwrap()
        .booking
        .status = BookingStatus::Pending;
    assert!(matches!(
        service
            .set_attendance("admin", r.booking.id, BookingAttendance::Attended)
            .await,
        Err(Error::Invalid(_))
    ));
}

#[tokio::test]
async fn unrelated_team_member_cannot_record_attendance() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let team = Some(Uuid::new_v4());
    let mut p = profile(team);
    p.event_types[0].hosts = vec!["admin".into()];
    let p = service.save("admin", team, p).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    store
        .bookings
        .lock()
        .unwrap()
        .get_mut(&r.booking.id)
        .unwrap()
        .booking
        .ends_at = Utc::now() - Duration::hours(1);
    assert!(matches!(
        service
            .set_attendance("member", r.booking.id, BookingAttendance::HostNoShow)
            .await,
        Err(Error::Forbidden)
    ));
}

#[tokio::test]
async fn failed_reschedule_does_not_count_as_successful_move() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(
        store.clone(),
        Arc::new(Calendar {
            fail_reschedule: true,
            ..Default::default()
        }),
        Members,
    );
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(
        service
            .reschedule(
                r.booking.id,
                r.token,
                r.booking.starts_at + Duration::hours(1)
            )
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Failed
    );
    let stored = store.booking(r.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert_eq!(stored.booking.reschedule_count, 0);
    assert_eq!(stored.booking.rescheduled_at, None);
}

#[tokio::test]
async fn booking_ranges_are_half_open_bounded_and_authorized() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let team = Some(Uuid::new_v4());
    let p = service.save("admin", team, profile(team)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let start = r.booking.starts_at;
    assert_eq!(
        service
            .bookings_in_range("member", team, start, start + Duration::hours(1))
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(
        service
            .bookings_in_range("member", team, start - Duration::hours(1), start)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        service
            .bookings_in_range("stranger", team, start, start + Duration::hours(1))
            .await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.bookings_in_range("admin", team, start, start).await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        service
            .bookings_in_range("admin", team, start, start + Duration::days(734))
            .await,
        Err(Error::Invalid(_))
    ));
}

#[tokio::test]
async fn legacy_booking_metadata_defaults_without_inventing_attendance_or_history() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    let mut json = serde_json::to_value(r).unwrap();
    let booking = json["booking"].as_object_mut().unwrap();
    booking.remove("attendance");
    booking.remove("rescheduleCount");
    booking.remove("rescheduledAt");
    let decoded: BookingRecord = serde_json::from_value(json).unwrap();
    assert_eq!(decoded.booking.attendance, BookingAttendance::Unknown);
    assert_eq!(decoded.booking.reschedule_count, 0);
    assert_eq!(decoded.booking.rescheduled_at, None);
}

#[tokio::test]
async fn removed_host_in_another_link_does_not_break_current_team_booking() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let team = Some(Uuid::new_v4());
    let p = service.save("admin", team, profile(team)).await.unwrap();
    let mut unrelated = p.event_types[0].clone();
    unrelated.id = Uuid::new_v4();
    unrelated.slug = "old-link".into();
    unrelated.hosts = vec!["former-member".into()];
    store
        .profiles
        .lock()
        .unwrap()
        .get_mut(&p.id)
        .unwrap()
        .profile
        .event_types
        .push(unrelated.clone());
    assert!(
        !service
            .slots(p.id, p.event_types[0].id, request().starts_at.date_naive())
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        service
            .slots(p.id, unrelated.id, request().starts_at.date_naive())
            .await,
        Err(Error::Forbidden)
    ));
    assert!(
        service
            .book(p.id, p.event_types[0].id, request())
            .await
            .is_ok()
    );
}

#[tokio::test]
async fn team_slots_intersect_each_hosts_personal_default_hours_in_their_zone() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let mut personal = profile(None);
    let mut defaults = personal.schedules[0].clone();
    defaults.id = Uuid::new_v4();
    defaults.time_zone = chrono_tz::America::New_York;
    for day in &mut defaults.weekly {
        day.windows = vec![TimeWindow {
            start: "09:00".into(),
            end: "10:00".into(),
        }];
    }
    personal.default_schedule_id = Some(defaults.id);
    personal.schedules.push(defaults);
    service.save("admin", None, personal).await.unwrap();
    let team = Some(Uuid::new_v4());
    let mut p = profile(team);
    p.event_types[0].mode = SchedulingMode::Collective;
    let p = service.save("admin", team, p).await.unwrap();
    let date = request().starts_at.date_naive();
    let slots = service
        .slots(p.id, p.event_types[0].id, date)
        .await
        .unwrap();
    assert_eq!(slots.len(), 2);
    assert!(slots.iter().all(|s| {
        s.starts_at
            .with_timezone(&chrono_tz::America::New_York)
            .time()
            >= chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap()
    }));
    assert!(slots.iter().all(|s| {
        s.ends_at
            .with_timezone(&chrono_tz::America::New_York)
            .time()
            <= chrono::NaiveTime::from_hms_opt(10, 0, 0).unwrap()
    }));
    let mut p = p;
    p.event_types[0].mode = SchedulingMode::RoundRobin;
    let p = service.save("admin", team, p).await.unwrap();
    let slots = service
        .slots(p.id, p.event_types[0].id, date)
        .await
        .unwrap();
    let outside = slots
        .iter()
        .find(|s| s.starts_at == request().starts_at)
        .unwrap();
    assert_eq!(outside.hosts, vec!["member"]);
    let b = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(b.booking.hosts, vec!["member"]);
}

fn make_due(store: &Memory, id: Uuid) {
    store
        .bookings
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .operation
        .as_mut()
        .unwrap()
        .retry_at = Utc::now() - Duration::seconds(1);
}

#[tokio::test]
async fn recovery_after_lost_create_response_creates_only_one_invitation() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar {
        lose_create_response: AtomicBool::new(true),
        ..Default::default()
    });
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    assert_eq!(
        service
            .book(p.id, p.event_types[0].id, request())
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Failed
    );
    let record = store
        .bookings
        .lock()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .clone();
    assert_eq!(record.booking.status, BookingStatus::Failed);
    assert!(!service.recover_once().await.unwrap());
    make_due(&store, record.booking.id);
    assert!(service.recover_once().await.unwrap());
    assert_eq!(
        service
            .receipt(record.booking.id, record.token)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Confirmed
    );
    assert_eq!(calendars.creates.load(Ordering::SeqCst), 1);
    assert!(!service.recover_once().await.unwrap());
}

#[tokio::test]
async fn recovery_finishes_move_once_and_cancel_releases_the_slot() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    calendars.lose_move_response.store(true, Ordering::SeqCst);
    let next = r.booking.starts_at + Duration::hours(1);
    assert_eq!(
        service
            .reschedule(r.booking.id, r.token, next)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Failed
    );
    make_due(&store, r.booking.id);
    assert!(service.recover_once().await.unwrap());
    let moved = service.receipt(r.booking.id, r.token).await.unwrap();
    assert_eq!(moved.booking.starts_at, next);
    assert_eq!(moved.booking.reschedule_count, 1);
    assert!(!service.recover_once().await.unwrap());
    calendars.lose_cancel_response.store(true, Ordering::SeqCst);
    assert_eq!(
        service
            .cancel(r.booking.id, Some(r.token), None)
            .await
            .unwrap()
            .status,
        BookingStatus::Failed
    );
    make_due(&store, r.booking.id);
    assert!(service.recover_once().await.unwrap());
    assert_eq!(
        service
            .receipt(r.booking.id, r.token)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Cancelled
    );
}

#[tokio::test]
async fn restart_recovers_processing_and_old_worker_cannot_complete_new_claim() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let mut r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    r.booking.status = BookingStatus::Processing;
    store
        .bookings
        .lock()
        .unwrap()
        .insert(r.booking.id, r.clone());
    make_due(&store, r.booking.id);
    let claimed = store.claim_recovery().await.unwrap().unwrap();
    let receipt = service.finish_operation(r).await.unwrap();
    assert_eq!(receipt.booking.id, claimed.booking.id);
    assert_eq!(receipt.token, claimed.token);
    assert_eq!(receipt.revision, claimed.revision);
    assert_eq!(receipt.booking.status, BookingStatus::Processing);
    assert_eq!(
        store
            .booking(claimed.booking.id)
            .await
            .unwrap()
            .unwrap()
            .revision,
        claimed.revision
    );
    service.finish_operation(claimed).await.unwrap();
    assert_eq!(calendars.creates.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn new_manual_approval_configuration_and_legacy_links_are_blocked() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let mut p = profile(None);
    p.event_types[0].requires_confirmation = true;
    assert!(matches!(
        service.save("admin", None, p.clone()).await,
        Err(Error::Invalid(_))
    ));
    store
        .save_profile(OwnedProfile {
            user_id: Some("admin".into()),
            team_id: None,
            profile: p.clone(),
        })
        .await
        .unwrap();
    assert!(matches!(
        service.book(p.id, p.event_types[0].id, request()).await,
        Err(Error::Invalid(_))
    ));
    assert!(store.bookings.lock().unwrap().is_empty());
}

#[tokio::test]
async fn completion_database_failure_still_returns_private_receipt_and_recovers() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    store.fail_completion.store(true, Ordering::SeqCst);
    let receipt = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(receipt.booking.status, BookingStatus::Processing);
    assert_eq!(
        service
            .receipt(receipt.booking.id, receipt.token)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Processing
    );
    make_due(&store, receipt.booking.id);
    assert!(service.recover_once().await.unwrap());
    assert_eq!(
        service
            .receipt(receipt.booking.id, receipt.token)
            .await
            .unwrap()
            .booking
            .status,
        BookingStatus::Confirmed
    );
    assert_eq!(calendars.creates.load(Ordering::SeqCst), 1);
}
