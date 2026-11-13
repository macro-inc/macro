use super::*;
use crate::domain::{
    attendance::{AttendanceFuture, AttendanceSource, ObservedParticipants},
    insights::InsightQuery,
};
use std::collections::BTreeMap;

#[derive(Default)]
struct Attendance {
    observed: Mutex<BTreeMap<Uuid, ObservedParticipants>>,
    requested: Mutex<Vec<Uuid>>,
    fail: AtomicBool,
}

impl AttendanceSource for Arc<Attendance> {
    fn observed_participants<'a>(&'a self, bookings: &'a [Booking]) -> AttendanceFuture<'a> {
        Box::pin(async move {
            self.requested
                .lock()
                .unwrap()
                .extend(bookings.iter().map(|booking| booking.id));
            if self.fail.load(Ordering::SeqCst) {
                return Err(Error::Unavailable);
            }
            let observed = self.observed.lock().unwrap();
            Ok(bookings
                .iter()
                .filter_map(|booking| {
                    observed
                        .get(&booking.id)
                        .map(|people| (booking.id, people.clone()))
                })
                .collect())
        })
    }
}

async fn setup() -> (Arc<Memory>, Arc<Attendance>, TestService, BookingRecord) {
    let store = Arc::new(Memory::default());
    let attendance = Arc::new(Attendance::default());
    let service = TestService::new(store.clone(), Arc::new(Calendar::default()), Members)
        .with_attendance_source(attendance.clone());
    let mut draft = profile(None);
    draft.event_types[0].macro_call = true;
    let saved = service.save("admin", None, draft).await.unwrap();
    let mut record = service
        .book(saved.id, saved.event_types[0].id, request())
        .await
        .unwrap();
    record.booking.starts_at = Utc::now() - Duration::days(1);
    record.booking.ends_at = record.booking.starts_at + Duration::minutes(30);
    store
        .bookings
        .lock()
        .unwrap()
        .insert(record.booking.id, record.clone());
    (store, attendance, service, record)
}

#[tokio::test]
async fn observed_guest_and_host_no_shows_reach_bookings_and_both_insight_periods() {
    let (store, attendance, service, current) = setup().await;
    let mut previous = current.clone();
    previous.booking.id = Uuid::now_v7();
    previous.booking.starts_at -= Duration::days(1);
    previous.booking.ends_at -= Duration::days(1);
    store
        .bookings
        .lock()
        .unwrap()
        .insert(previous.booking.id, previous.clone());
    attendance.observed.lock().unwrap().extend([
        (
            current.booking.id,
            ObservedParticipants {
                user_ids: vec!["admin".into()],
                guest_present: false,
            },
        ),
        (
            previous.booking.id,
            ObservedParticipants {
                user_ids: vec![],
                guest_present: true,
            },
        ),
    ]);

    let bookings = service
        .bookings_in_range(
            "admin",
            None,
            previous.booking.starts_at,
            current.booking.ends_at,
        )
        .await
        .unwrap();
    assert_eq!(
        bookings
            .iter()
            .find(|booking| booking.id == current.booking.id)
            .unwrap()
            .attendance,
        BookingAttendance::GuestNoShow
    );
    let date = current.booking.starts_at.date_naive();
    let insights = service
        .booking_insights(
            "admin",
            None,
            InsightQuery {
                from: date,
                to: date,
                time_zone: chrono_tz::UTC,
                event_type_id: None,
                host_id: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(insights.current.counts.guest_no_show, 1);
    assert_eq!(insights.current.counts.completed, 0);
    assert_eq!(insights.previous.counts.host_no_show, 1);
    assert_eq!(insights.previous.counts.completed, 0);
    assert_eq!(
        service
            .receipt(current.booking.id, current.token)
            .await
            .unwrap()
            .booking
            .attendance,
        BookingAttendance::GuestNoShow
    );
    // Derived observations must never overwrite the host's stored attendance choice.
    assert_eq!(
        store.bookings.lock().unwrap()[&current.booking.id]
            .booking
            .attendance,
        BookingAttendance::Unknown
    );
}

#[tokio::test]
async fn manual_outcomes_and_ineligible_bookings_do_not_request_automatic_evidence() {
    let (store, attendance, service, template) = setup().await;
    let mut expected = BTreeMap::new();
    for (manual, status, macro_call, future) in [
        (
            BookingAttendance::Attended,
            BookingStatus::Confirmed,
            true,
            false,
        ),
        (
            BookingAttendance::GuestNoShow,
            BookingStatus::Confirmed,
            true,
            false,
        ),
        (
            BookingAttendance::HostNoShow,
            BookingStatus::Confirmed,
            true,
            false,
        ),
        (
            BookingAttendance::Unknown,
            BookingStatus::Cancelled,
            true,
            false,
        ),
        (
            BookingAttendance::Unknown,
            BookingStatus::Pending,
            true,
            false,
        ),
        (
            BookingAttendance::Unknown,
            BookingStatus::Confirmed,
            false,
            false,
        ),
        (
            BookingAttendance::Unknown,
            BookingStatus::Confirmed,
            true,
            true,
        ),
    ] {
        let mut record = template.clone();
        record.booking.id = Uuid::now_v7();
        record.booking.attendance = manual;
        record.booking.status = status;
        record.event.macro_call = macro_call;
        if future {
            record.booking.starts_at = Utc::now() + Duration::days(1);
            record.booking.ends_at = record.booking.starts_at + Duration::minutes(30);
        }
        expected.insert(record.booking.id, manual);
        store
            .bookings
            .lock()
            .unwrap()
            .insert(record.booking.id, record);
    }
    store.bookings.lock().unwrap().remove(&template.booking.id);
    let bookings = service
        .bookings_in_range(
            "admin",
            None,
            Utc::now() - Duration::days(3),
            Utc::now() + Duration::days(3),
        )
        .await
        .unwrap();
    for booking in bookings {
        assert_eq!(booking.attendance, expected[&booking.id]);
    }
    assert!(attendance.requested.lock().unwrap().is_empty());
}

#[tokio::test]
async fn empty_or_missing_evidence_stays_unknown_and_read_failures_are_not_zero_counts() {
    let (_, attendance, service, record) = setup().await;
    attendance
        .observed
        .lock()
        .unwrap()
        .insert(record.booking.id, ObservedParticipants::default());
    let start = record.booking.starts_at;
    let end = record.booking.ends_at;
    assert_eq!(
        service
            .bookings_in_range("admin", None, start, end)
            .await
            .unwrap()[0]
            .attendance,
        BookingAttendance::Unknown
    );
    attendance.observed.lock().unwrap().clear();
    assert_eq!(
        service
            .bookings_in_range("admin", None, start, end)
            .await
            .unwrap()[0]
            .attendance,
        BookingAttendance::Unknown
    );
    attendance.fail.store(true, Ordering::SeqCst);
    assert!(matches!(
        service.bookings_in_range("admin", None, start, end).await,
        Err(Error::Unavailable)
    ));
}

#[tokio::test]
async fn signed_in_and_anonymous_guests_count_as_people_not_assigned_hosts() {
    let (_, attendance, service, record) = setup().await;
    for (user_ids, guest_present, expected) in [
        (
            vec!["admin".into(), "visitor".into()],
            false,
            BookingAttendance::Attended,
        ),
        (vec!["admin".into()], true, BookingAttendance::Attended),
        (vec!["visitor".into()], false, BookingAttendance::HostNoShow),
        (
            vec!["admin".into(), "admin".into()],
            false,
            BookingAttendance::GuestNoShow,
        ),
    ] {
        attendance.observed.lock().unwrap().insert(
            record.booking.id,
            ObservedParticipants {
                user_ids,
                guest_present,
            },
        );
        assert_eq!(
            service
                .manage("admin", record.booking.id)
                .await
                .unwrap()
                .booking
                .attendance,
            expected
        );
    }
}

#[tokio::test]
async fn explicit_attendance_wins_and_clearing_resumes_automatic_detection() {
    let (store, attendance, service, record) = setup().await;
    attendance.observed.lock().unwrap().insert(
        record.booking.id,
        ObservedParticipants {
            user_ids: vec!["admin".into()],
            guest_present: false,
        },
    );
    assert_eq!(
        service
            .set_attendance("admin", record.booking.id, BookingAttendance::Attended)
            .await
            .unwrap()
            .attendance,
        BookingAttendance::Attended
    );
    assert!(attendance.requested.lock().unwrap().is_empty());
    assert_eq!(
        service
            .set_attendance("admin", record.booking.id, BookingAttendance::Unknown)
            .await
            .unwrap()
            .attendance,
        BookingAttendance::GuestNoShow
    );
    assert_eq!(
        store.bookings.lock().unwrap()[&record.booking.id]
            .booking
            .attendance,
        BookingAttendance::Unknown
    );
}

#[tokio::test]
async fn unauthorized_readers_never_request_attendance_evidence() {
    let (store, attendance, service, mut record) = setup().await;
    let team = Uuid::now_v7();
    let mut profile = profile(Some(team));
    profile.id = TestService::profile_id("admin", Some(team));
    record.profile_id = profile.id;
    store.profiles.lock().unwrap().insert(
        profile.id,
        OwnedProfile {
            user_id: None,
            team_id: Some(team),
            profile,
        },
    );
    store
        .bookings
        .lock()
        .unwrap()
        .insert(record.booking.id, record.clone());
    assert!(matches!(
        service
            .bookings_in_range(
                "stranger",
                Some(team),
                record.booking.starts_at,
                record.booking.ends_at
            )
            .await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.manage("stranger", record.booking.id).await,
        Err(Error::Forbidden)
    ));
    assert!(matches!(
        service.receipt(record.booking.id, Uuid::now_v7()).await,
        Err(Error::NotFound)
    ));
    assert!(attendance.requested.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_detection_does_not_clear_a_manual_override() {
    let (store, attendance, service, record) = setup().await;
    attendance.fail.store(true, Ordering::SeqCst);
    service
        .set_attendance("admin", record.booking.id, BookingAttendance::Attended)
        .await
        .unwrap();
    assert!(matches!(
        service
            .set_attendance("admin", record.booking.id, BookingAttendance::Unknown)
            .await,
        Err(Error::Unavailable)
    ));
    assert_eq!(
        store.bookings.lock().unwrap()[&record.booking.id]
            .booking
            .attendance,
        BookingAttendance::Attended
    );
}
