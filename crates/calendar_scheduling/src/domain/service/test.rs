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
    /// Request lookups that miss, as a resend's does when it reads before its
    /// first attempt has reserved.
    missed_request_lookups: AtomicUsize,
    reserve_barrier: Option<tokio::sync::Barrier>,
    reserve_calls: AtomicUsize,
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
                .is_some_and(|o| o.abandoned_at.is_none() && o.retry_at <= Utc::now())
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
    async fn daily_bookings(
        &self,
        profile: Uuid,
        event_type: Uuid,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        exclude: Option<Uuid>,
    ) -> Result<i64, Error> {
        let on_day = |time: DateTime<Utc>| time >= start && time < end;
        Ok(self
            .bookings
            .lock()
            .unwrap()
            .values()
            .filter(|r| {
                r.profile_id == profile
                    && Some(r.booking.id) != exclude
                    && r.booking.event_type_id == event_type
                    && r.booking.status != BookingStatus::Cancelled
                    && (on_day(r.booking.starts_at)
                        || r.booking.status == BookingStatus::Processing
                            && r.operation.as_ref().is_some_and(|o| {
                                o.attempt == 0
                                    && matches!(o.kind, CalendarOperationKind::Move { original_start, .. } if on_day(original_start))
                            }))
            })
            .count() as i64)
    }
    async fn host_booking_counts(
        &self,
        profile: Uuid,
        hosts: &[String],
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<std::collections::BTreeMap<String, i64>, Error> {
        let bookings = self.bookings(profile, start, end).await?;
        Ok(hosts
            .iter()
            .map(|host| {
                (
                    host.clone(),
                    bookings
                        .iter()
                        .filter(|r| {
                            r.booking.status != BookingStatus::Cancelled
                                && r.booking.hosts.contains(host)
                        })
                        .count() as i64,
                )
            })
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
        if let Some(barrier) = &self.reserve_barrier
            && self.reserve_calls.fetch_add(1, Ordering::SeqCst) < 2
        {
            barrier.wait().await;
        }
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
        if self
            .missed_request_lookups
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            .is_ok()
        {
            return Ok(None);
        }
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
    create_attempts: AtomicUsize,
    reject_creates: AtomicBool,
    reject_cancels: AtomicBool,
    reject_moves: AtomicBool,
    fail_creates: AtomicBool,
    lose_create_response: AtomicBool,
    lose_move_response: AtomicBool,
    lose_cancel_response: AtomicBool,
    events: Mutex<HashMap<Uuid, Uuid>>,
    busy: Mutex<Vec<BusyRange>>,
    /// The inbox each availability read was told the booking lands on.
    busy_inboxes: Mutex<Vec<Option<Uuid>>>,
}
/// The calendar the fake pins for a host's booking: one per host, or one per
/// connected inbox when the link names one.
fn pinned_calendar(host: &str, inbox: Option<Uuid>) -> Uuid {
    match inbox {
        Some(inbox) => Uuid::new_v5(&Uuid::NAMESPACE_OID, inbox.as_bytes()),
        None => Uuid::new_v5(&Uuid::NAMESPACE_OID, host.as_bytes()),
    }
}
impl Calendars for Arc<Calendar> {
    async fn creation_calendar(&self, host: &str, inbox: Option<Uuid>) -> Result<Uuid, Error> {
        Ok(pinned_calendar(host, inbox))
    }
    async fn busy(
        &self,
        _: &[String],
        _: DateTime<Utc>,
        _: DateTime<Utc>,
        _: Option<Uuid>,
        inbox: Option<Uuid>,
    ) -> Result<Vec<BusyRange>, Error> {
        self.busy_inboxes.lock().unwrap().push(inbox);
        Ok(self.busy.lock().unwrap().clone())
    }
    async fn create(&self, record: &BookingRecord, _: &EventType) -> Result<(Uuid, String), Error> {
        self.create_attempts.fetch_add(1, Ordering::SeqCst);
        if self.reject_creates.load(Ordering::SeqCst) {
            return Err(Error::CalendarRejected);
        }
        if self.fail_creates.load(Ordering::SeqCst) {
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
        if self.reject_cancels.load(Ordering::SeqCst) {
            return Err(Error::CalendarRejected);
        }
        if self.lose_cancel_response.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok(())
    }
    async fn reschedule(&self, _: &BookingRecord) -> Result<(), Error> {
        if self.reject_moves.load(Ordering::SeqCst) {
            return Err(Error::CalendarRejected);
        }
        if self.lose_move_response.swap(false, Ordering::SeqCst) {
            return Err(Error::CalendarUnavailable);
        }
        Ok(())
    }
}
struct Members;
impl Directory for Members {
    async fn user_teams(&self, _: &str) -> Result<Vec<Uuid>, Error> {
        Ok(vec![])
    }
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
        macro_call: false,
        google_meet: false,
        email_link_id: None,
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
        service.save("stranger", team, p.clone()).await,
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
    assert!(service.save("member", team, p).await.is_ok());
    assert!(service.settings("admin", team).await.is_ok());
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
async fn a_resend_that_finds_its_time_taken_by_its_first_attempt_gets_that_booking() {
    let cal = Arc::new(Calendar::default());
    let repo = Arc::new(Memory::default());
    let service = TestService::new(repo.clone(), cal.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = request();
    let first = service
        .book(p.id, p.event_types[0].id, r.clone())
        .await
        .unwrap();
    repo.missed_request_lookups.store(1, Ordering::SeqCst);
    let resent = service
        .book(p.id, p.event_types[0].id, r.clone())
        .await
        .unwrap();
    assert_eq!(resent.booking.id, first.booking.id);
    assert_eq!(cal.creates.load(Ordering::SeqCst), 1);
    repo.missed_request_lookups.store(1, Ordering::SeqCst);
    assert!(matches!(
        service
            .book(
                p.id,
                p.event_types[0].id,
                BookingRequest {
                    email: "another@example.com".into(),
                    ..r
                }
            )
            .await,
        Err(Error::Conflict)
    ));
}
#[tokio::test]
async fn concurrent_round_robin_bookings_use_distinct_hosts_and_calendars() {
    let repo = Arc::new(Memory {
        reserve_barrier: Some(tokio::sync::Barrier::new(2)),
        ..Default::default()
    });
    let cal = Arc::new(Calendar::default());
    let service = TestService::new(repo.clone(), cal.clone(), Members);
    let team = Some(Uuid::new_v4());
    let p = service.save("admin", team, profile(team)).await.unwrap();
    let retry = request();
    let (a, b) = tokio::join!(
        service.book(p.id, p.event_types[0].id, retry.clone()),
        service.book(p.id, p.event_types[0].id, request()),
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_ne!(a.booking.hosts, b.booking.hosts);
    assert_eq!(a.booking.hosts.len(), 1);
    assert_eq!(b.booking.hosts.len(), 1);
    for record in [&a, &b] {
        assert_eq!(
            record.calendar_id,
            Some(pinned_calendar(&record.booking.hosts[0], None))
        );
    }
    assert_eq!(cal.creates.load(Ordering::SeqCst), 2);
    assert_eq!(
        service
            .book(p.id, p.event_types[0].id, retry)
            .await
            .unwrap()
            .booking
            .id,
        a.booking.id
    );
    assert!(matches!(
        service.book(p.id, p.event_types[0].id, request()).await,
        Err(Error::Conflict)
    ));
    assert_eq!(cal.creates.load(Ordering::SeqCst), 2);
}
#[tokio::test]
async fn pending_approval_ignores_points_but_rejects_reversed_calendar_facts() {
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(Arc::new(Memory::default()), calendars.clone(), Members);
    let profile = service.save("admin", None, profile(None)).await.unwrap();
    let mut record = service
        .book(profile.id, profile.event_types[0].id, request())
        .await
        .unwrap();
    record.booking.status = BookingStatus::Pending;
    record.calendar_event_id = None;
    let id = record.booking.id;
    let point = record.booking.starts_at + Duration::minutes(5);
    let host = record.booking.hosts[0].clone();
    service
        .repository
        .bookings
        .lock()
        .unwrap()
        .insert(id, record);
    *calendars.busy.lock().unwrap() = vec![BusyRange {
        host,
        start: point,
        end: point - Duration::seconds(1),
    }];
    assert!(matches!(
        service.approve("admin", id).await,
        Err(Error::CalendarUnavailable)
    ));
    calendars.busy.lock().unwrap()[0].end = point;
    assert_eq!(
        service.approve("admin", id).await.unwrap().status,
        BookingStatus::Confirmed
    );
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
    legacy.event.requires_confirmation = true;
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
    let moved = service
        .reschedule(
            booking.booking.id,
            booking.token,
            booking.booking.starts_at + Duration::hours(1),
        )
        .await
        .unwrap();
    assert_eq!(moved.booking.status, BookingStatus::Confirmed);
    assert_eq!(moved.booking.reschedule_count, 1);
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
        async fn user_teams(&self, _: &str) -> Result<Vec<Uuid>, Error> {
            Ok(vec![])
        }
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
async fn hosts_manage_the_team_meetings_they_host() {
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
    let set_hosts = |hosts: &[&str]| {
        let mut data = store.bookings.lock().unwrap();
        data.get_mut(&r.booking.id).unwrap().booking.hosts =
            hosts.iter().map(|host| host.to_string()).collect();
    };
    set_hosts(&["admin"]);
    assert!(matches!(
        service.manage("member", r.booking.id).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.cancel(r.booking.id, None, Some("member")).await,
        Err(Error::Forbidden)
    ));
    set_hosts(&["member"]);
    assert!(service.manage("admin", r.booking.id).await.is_ok());
    assert!(service.manage("member", r.booking.id).await.is_ok());
    assert_eq!(
        service
            .cancel(r.booking.id, None, Some("member"))
            .await
            .unwrap()
            .status,
        BookingStatus::Cancelled
    );
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

/// A host whose calendar refuses the event, such as one with no writable
/// calendar, gets a failed booking at once instead of an hourly retry that
/// never ends.
#[tokio::test]
async fn a_refused_create_leaves_the_booking_failed_and_never_retries() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar {
        reject_creates: AtomicBool::new(true),
        ..Default::default()
    });
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let receipt = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(receipt.booking.status, BookingStatus::Failed);
    assert!(receipt.booking.abandoned_at.is_some());
    let stored = store.booking(receipt.booking.id).await.unwrap().unwrap();
    assert!(
        stored
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_some() && operation.unsent)
    );
    make_due(&store, receipt.booking.id);
    assert!(!service.recover_once().await.unwrap());
    assert_eq!(calendars.create_attempts.load(Ordering::SeqCst), 1);
    let shown = service
        .receipt(receipt.booking.id, receipt.token)
        .await
        .unwrap()
        .booking;
    assert_eq!(shown.status, BookingStatus::Failed);
    assert!(shown.abandoned_at.is_some());
    // Nothing owns it any more, so it can be cancelled. The refused create
    // never reached the calendar, so the cancellation frees the time without
    // asking it, even while the calendar refuses changes.
    calendars.reject_cancels.store(true, Ordering::SeqCst);
    let cancelled = service
        .cancel(receipt.booking.id, Some(receipt.token), None)
        .await
        .unwrap();
    assert_eq!(cancelled.status, BookingStatus::Cancelled);
    assert!(cancelled.abandoned_at.is_none());
}

/// A refusal whose completion write fails returns the processing receipt
/// storage still holds, without the unsaved abandonment.
#[tokio::test]
async fn an_unsaved_abandonment_stays_off_the_receipt() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar {
        reject_creates: AtomicBool::new(true),
        ..Default::default()
    });
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    store.fail_completion.store(true, Ordering::SeqCst);
    let receipt = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(receipt.booking.status, BookingStatus::Processing);
    assert!(receipt.booking.abandoned_at.is_none());
}

/// A create whose earlier attempt may have landed can only be cancelled
/// through the calendar. A calendar that refuses the cancellation too keeps
/// the reservations, as lost access always has; once it accepts, the
/// cancellation frees the time.
#[tokio::test]
async fn an_abandoned_create_that_may_have_landed_cancels_through_the_calendar() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar {
        lose_create_response: AtomicBool::new(true),
        ..Default::default()
    });
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let receipt = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert!(receipt.booking.abandoned_at.is_none());
    calendars.reject_creates.store(true, Ordering::SeqCst);
    make_due(&store, receipt.booking.id);
    assert!(service.recover_once().await.unwrap());
    let stored = store.booking(receipt.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert!(stored.booking.abandoned_at.is_some());
    assert!(
        stored
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_some() && !operation.unsent)
    );
    calendars.reject_cancels.store(true, Ordering::SeqCst);
    // The second refusal follows a cancellation refused on its first
    // attempt: only a refused create skips the calendar, so it stays held.
    for _ in 0..2 {
        let refused = service
            .cancel(receipt.booking.id, Some(receipt.token), None)
            .await
            .unwrap();
        assert_eq!(refused.status, BookingStatus::Failed);
        assert!(refused.abandoned_at.is_some());
    }
    calendars.reject_cancels.store(false, Ordering::SeqCst);
    let cancelled = service
        .cancel(receipt.booking.id, Some(receipt.token), None)
        .await
        .unwrap();
    assert_eq!(cancelled.status, BookingStatus::Cancelled);
    assert!(cancelled.abandoned_at.is_none());
}

/// A calendar that keeps failing in a way that may clear, such as an outage
/// or a host who must reconnect, is retried while the meeting is still ahead,
/// however long that takes; once the meeting has started the booking stays
/// failed.
#[tokio::test]
async fn a_create_that_keeps_failing_retries_until_the_meeting_starts() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar {
        fail_creates: AtomicBool::new(true),
        ..Default::default()
    });
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let receipt = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(receipt.booking.status, BookingStatus::Failed);
    // Recovery still owns it.
    assert!(matches!(
        service
            .cancel(receipt.booking.id, Some(receipt.token), None)
            .await,
        Err(Error::Conflict)
    ));
    // Far more attempts than a day of hourly retries.
    for _ in 0..40 {
        make_due(&store, receipt.booking.id);
        assert!(service.recover_once().await.unwrap());
    }
    let stored = store.booking(receipt.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert!(
        stored
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_none())
    );

    store
        .bookings
        .lock()
        .unwrap()
        .get_mut(&receipt.booking.id)
        .unwrap()
        .booking
        .starts_at = Utc::now() - Duration::minutes(1);
    make_due(&store, receipt.booking.id);
    assert!(service.recover_once().await.unwrap());
    let stored = store.booking(receipt.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert!(
        stored
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_some())
    );
    make_due(&store, receipt.booking.id);
    assert!(!service.recover_once().await.unwrap());
    // The booking request plus one provider call per claim.
    assert_eq!(calendars.create_attempts.load(Ordering::SeqCst), 1 + 41);
}

/// A move the host's calendar refuses never reached it, so the booking keeps
/// its original time and status and the time it asked for is released.
#[tokio::test]
async fn a_refused_move_keeps_the_booking_at_its_original_time() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    assert_eq!(r.booking.status, BookingStatus::Confirmed);
    calendars.reject_moves.store(true, Ordering::SeqCst);
    let next = r.booking.starts_at + Duration::hours(1);
    assert!(matches!(
        service.reschedule(r.booking.id, r.token, next).await,
        Err(Error::CalendarRejected)
    ));
    let kept = service.receipt(r.booking.id, r.token).await.unwrap();
    assert_eq!(kept.booking.status, BookingStatus::Confirmed);
    assert_eq!(kept.booking.starts_at, r.booking.starts_at);
    assert_eq!(kept.booking.ends_at, r.booking.ends_at);
    assert_eq!(kept.busy_start, r.busy_start);
    assert_eq!(kept.busy_end, r.busy_end);
    assert_eq!(kept.booking.reschedule_count, 0);
    make_due(&store, r.booking.id);
    assert!(!service.recover_once().await.unwrap());
    // Once the calendar accepts, the booking moves as usual.
    calendars.reject_moves.store(false, Ordering::SeqCst);
    let moved = service
        .reschedule(r.booking.id, r.token, next)
        .await
        .unwrap();
    assert_eq!(moved.booking.starts_at, next);
    assert_eq!(moved.booking.reschedule_count, 1);
}

#[tokio::test]
async fn slots_stay_closed_on_a_full_day_while_a_move_out_of_it_awaits_the_calendar() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let mut p = profile(None);
    p.event_types[0].daily_limit = Some(1);
    let p = service.save("admin", None, p).await.unwrap();
    let event = p.event_types[0].id;
    let r = service.book(p.id, event, request()).await.unwrap();
    let day = r.booking.starts_at.date_naive();
    let next_day = day + Duration::days(1);
    assert!(service.slots(p.id, event, day).await.unwrap().is_empty());
    assert!(
        !service
            .slots(p.id, event, next_day)
            .await
            .unwrap()
            .is_empty()
    );
    // The booking is moving to the next day and the calendar has not
    // answered: a refusal would bring it back, so its first day stays full.
    {
        let mut data = store.bookings.lock().unwrap();
        let moving = data.get_mut(&r.booking.id).unwrap();
        moving.operation = Some(CalendarOperation::new(CalendarOperationKind::Move {
            status: moving.booking.status,
            original_start: moving.booking.starts_at,
        }));
        moving.booking.status = BookingStatus::Processing;
        moving.booking.starts_at += Duration::days(1);
        moving.booking.ends_at += Duration::days(1);
        moving.busy_start += Duration::days(1);
        moving.busy_end += Duration::days(1);
    }
    assert!(service.slots(p.id, event, day).await.unwrap().is_empty());
    assert!(
        service
            .slots(p.id, event, next_day)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn reschedule_offers_no_times_on_a_day_already_at_its_limit() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let mut p = profile(None);
    p.event_types[0].daily_limit = Some(1);
    let p = service.save("admin", None, p).await.unwrap();
    let event = p.event_types[0].id;
    let first_day = request();
    let mut later = request();
    later.starts_at += Duration::days(1);
    let moving = service.book(p.id, event, later).await.unwrap();
    let full_day = first_day.starts_at.date_naive();
    let own_day = moving.booking.starts_at.date_naive();
    // Before anyone books it, the other day offers replacement times.
    assert!(
        !service
            .replacement_slots(moving.booking.id, moving.token, full_day, None)
            .await
            .unwrap()
            .is_empty()
    );
    let full = service.book(p.id, event, first_day).await.unwrap();
    // The full day offers nothing and refuses the move; the booking's own day
    // still offers other times, since it never takes a place from itself.
    assert!(
        service
            .replacement_slots(moving.booking.id, moving.token, full_day, None)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        service
            .host_replacement_slots("admin", moving.booking.id, full_day)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        service
            .reschedule(
                moving.booking.id,
                moving.token,
                full.booking.starts_at + Duration::hours(1)
            )
            .await,
        Err(Error::Conflict)
    ));
    assert!(
        !service
            .replacement_slots(moving.booking.id, moving.token, own_day, None)
            .await
            .unwrap()
            .is_empty()
    );
}

/// A move whose first attempt failed without a recorded outcome may have
/// reached the calendar, so a later refusal must not put the booking back:
/// it stays failed at the requested time, holding both intervals.
#[tokio::test]
async fn a_move_refused_after_an_uncertain_attempt_is_not_reverted() {
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
    let failed = service
        .reschedule(r.booking.id, r.token, next)
        .await
        .unwrap();
    assert_eq!(failed.booking.status, BookingStatus::Failed);
    calendars.reject_moves.store(true, Ordering::SeqCst);
    make_due(&store, r.booking.id);
    assert!(service.recover_once().await.unwrap());
    let stored = store.booking(r.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert_eq!(stored.booking.starts_at, next);
    assert!(
        stored
            .operation
            .as_ref()
            .is_some_and(|operation| operation.abandoned_at.is_some())
    );
}

/// When a refused move's revert cannot be saved, recovery still owns the
/// move, so the caller gets the processing receipt rather than a refusal.
#[tokio::test]
async fn a_refused_move_whose_revert_is_not_saved_returns_the_receipt() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let p = service.save("admin", None, profile(None)).await.unwrap();
    let r = service
        .book(p.id, p.event_types[0].id, request())
        .await
        .unwrap();
    calendars.reject_moves.store(true, Ordering::SeqCst);
    store.fail_completion.store(true, Ordering::SeqCst);
    let next = r.booking.starts_at + Duration::hours(1);
    let receipt = service
        .reschedule(r.booking.id, r.token, next)
        .await
        .unwrap();
    assert_eq!(receipt.booking.status, BookingStatus::Processing);
    let stored = store.booking(r.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.starts_at, next);
    assert_eq!(receipt.booking.starts_at, stored.booking.starts_at);
    assert_eq!(receipt.booking.ends_at, stored.booking.ends_at);
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
    assert!(matches!(
        service.book(p.id, p.event_types[0].id, request()).await,
        Err(Error::Conflict)
    ));
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
    let stored = store.booking(r.booking.id).await.unwrap().unwrap();
    assert_eq!(stored.booking.status, BookingStatus::Failed);
    assert_eq!(stored.booking.reschedule_count, 0);
    assert_eq!(stored.booking.rescheduled_at, None);
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

#[tokio::test]
async fn invalid_email_never_reserves_a_slot_or_calls_the_provider() {
    let store = Arc::new(Memory::default());
    let calendars = Arc::new(Calendar::default());
    let service = TestService::new(store.clone(), calendars.clone(), Members);
    let profile = service.save("admin", None, profile(None)).await.unwrap();
    for email in ["@", "a@@b", "guest@example.com\n", "guest example.com"] {
        let mut request = request();
        request.email = email.into();
        assert!(matches!(
            service
                .book(profile.id, profile.event_types[0].id, request)
                .await,
            Err(Error::Invalid(_))
        ));
    }
    assert!(store.bookings.lock().unwrap().is_empty());
    assert_eq!(calendars.creates.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stale_team_events_can_be_repaired_one_at_a_time() {
    let store = Arc::new(Memory::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members);
    let team = Uuid::now_v7();
    let mut profile = service
        .save("admin", Some(team), profile(Some(team)))
        .await
        .unwrap();
    let mut second = profile.event_types[0].clone();
    second.id = Uuid::now_v7();
    second.slug = "second".into();
    profile.event_types.push(second);
    for event in &mut profile.event_types {
        event.hosts.push("departed".into());
        event.requires_confirmation = true;
    }
    store
        .profiles
        .lock()
        .unwrap()
        .get_mut(&profile.id)
        .unwrap()
        .profile = profile.clone();
    for index in 0..2 {
        profile.event_types[index]
            .hosts
            .retain(|host| host != "departed");
        profile.event_types[index].requires_confirmation = false;
        profile = service.save("admin", Some(team), profile).await.unwrap();
    }
    profile.event_types[0].hosts.push("new-outsider".into());
    assert!(matches!(
        service.save("admin", Some(team), profile).await,
        Err(Error::Invalid(_))
    ));
}

#[tokio::test]
async fn attaching_booking_targets_requires_current_access_and_an_enabled_saved_event() {
    let service = TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    );
    let saved = service.save("admin", None, profile(None)).await.unwrap();
    let event = saved.event_types[0].id;
    assert!(
        service
            .validate_attachment("admin", saved.id, event)
            .await
            .is_ok()
    );
    assert!(matches!(
        service
            .validate_attachment("stranger", saved.id, event)
            .await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service
            .validate_attachment("admin", saved.id, Uuid::new_v4())
            .await,
        Err(Error::NotFound)
    ));
    let mut disabled = saved.clone();
    disabled.event_types[0].enabled = false;
    service.save("admin", None, disabled).await.unwrap();
    assert!(matches!(
        service.validate_attachment("admin", saved.id, event).await,
        Err(Error::NotFound)
    ));
}

impl AttachmentReadiness for Arc<Calendar> {
    async fn ready(&self, _: &str, _: Option<Uuid>) -> Result<(), Error> {
        Ok(())
    }
}
impl BookingAccounts for Arc<Calendar> {
    async fn booking_accounts(
        &self,
        _: &str,
    ) -> Result<Vec<crate::domain::booking_link_models::BookingAccount>, Error> {
        Ok(vec![
            crate::domain::booking_link_models::BookingAccount {
                email_link_id: WORK_INBOX,
                email_address: "work@example.com".into(),
                video_meetings: true,
            },
            crate::domain::booking_link_models::BookingAccount {
                email_link_id: SIDE_INBOX,
                email_address: "side@example.com".into(),
                video_meetings: false,
            },
        ])
    }
}
/// A connected inbox other than the host's primary one.
const WORK_INBOX: Uuid = Uuid::from_u128(0x7);
/// Another connected inbox, whose calendar cannot add video meetings.
const SIDE_INBOX: Uuid = Uuid::from_u128(0x8);
mod booking_account;
mod booking_links;

mod management;
mod replacement;

#[cfg(all(feature = "client", feature = "inbound"))]
mod http_administration;
