use super::*;
use chrono::{Duration, SubsecRound};

/// CI clones every test database from a `template1` that already holds the macrodb
/// schema (`just setup_test_template`). These tests build their own schema, so they
/// start from an empty `public` schema.
const EMPTY_PUBLIC_SCHEMA: &str = "DROP SCHEMA public CASCADE; CREATE SCHEMA public;";

async fn setup(pool: &PgPool) {
    sqlx::raw_sql(EMPTY_PUBLIC_SCHEMA)
        .execute(pool)
        .await
        .unwrap();
    sqlx::raw_sql(
        "CREATE TABLE \"User\" (id text PRIMARY KEY); CREATE TABLE team (id uuid PRIMARY KEY);",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260918164303_calendar_scheduling.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20260918175703_scheduling_recovery.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261119171842_scheduling_booking_processing.up.sql"
    ))
    .execute(pool)
    .await
    .unwrap();
    sqlx::raw_sql("INSERT INTO \"User\" (id) VALUES ('host');")
        .execute(pool)
        .await
        .unwrap();
}
fn owned() -> OwnedProfile {
    OwnedProfile {
        user_id: Some("host".into()),
        team_id: None,
        profile: Profile {
            id: Uuid::new_v4(),
            name: "Host".into(),
            description: String::new(),
            default_schedule_id: None,
            schedules: vec![],
            event_types: vec![],
            revision: 0,
        },
    }
}
fn booking(profile: Uuid, start: DateTime<Utc>) -> BookingRecord {
    let event:EventType=serde_json::from_value(serde_json::json!({"id":Uuid::new_v4(),"title":"Meeting","slug":"meeting","description":"","durationMinutes":30,"location":"","googleMeet":false,"enabled":true,"scheduleId":Uuid::nil(),"mode":"individual","hosts":["host"],"beforeMinutes":0,"afterMinutes":0,"noticeMinutes":0,"horizonDays":30,"intervalMinutes":30,"dailyLimit":null,"requiresConfirmation":false,"questions":[]})).unwrap();
    BookingRecord {
        revision: 0,
        event: event.clone(),
        schedule: Schedule {
            id: Uuid::nil(),
            name: "Work".into(),
            time_zone: chrono_tz::UTC,
            weekly: vec![],
            overrides: vec![],
        },
        profile_id: profile,
        token: Uuid::new_v4(),
        request_id: Uuid::new_v4(),
        calendar_event_id: None,
        calendar_id: None,
        operation: None,
        busy_start: start,
        busy_end: start + Duration::minutes(30),
        booking: Booking {
            id: Uuid::new_v4(),
            event_type_id: event.id,
            title: "Meeting".into(),
            name: "Booker".into(),
            email: "guest@example.com".into(),
            starts_at: start,
            ends_at: start + Duration::minutes(30),
            time_zone: chrono_tz::UTC,
            hosts: vec!["host".into()],
            status: BookingStatus::Pending,
            attendance: BookingAttendance::Unknown,
            reschedule_count: 0,
            rescheduled_at: None,
            abandoned_at: None,
            location: String::new(),
            answers: Default::default(),
            question_labels: Default::default(),
        },
    }
}
#[sqlx::test(migrations = false)]
async fn overlapping_host_reservations_are_atomic(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let a = booking(p.id, start);
    let b = booking(p.id, start);
    let (a, b) = tokio::join!(
        repo.reserve(a, None, start, start + Duration::days(1)),
        repo.reserve(b, None, start, start + Duration::days(1))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let mut winner = a.or(b).unwrap();
    winner.booking.status = BookingStatus::Cancelled;
    repo.update_booking(winner, BookingStatus::Pending)
        .await
        .unwrap();
    assert!(
        repo.reserve(booking(p.id, start), None, start, start + Duration::days(1))
            .await
            .is_ok()
    );
}
#[sqlx::test(migrations = false)]
async fn profile_revision_rejects_lost_updates(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let mut owner = owned();
    owner.profile = repo.save_profile(owner.clone()).await.unwrap();
    let stale = owner.clone();
    repo.save_profile(owner).await.unwrap();
    assert!(matches!(
        repo.save_profile(stale).await,
        Err(Error::Conflict)
    ));
}
#[sqlx::test(migrations = false)]
async fn daily_limit_is_atomic_for_non_overlapping_slots(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let a = booking(p.id, start);
    let mut b = booking(p.id, start + Duration::hours(1));
    b.booking.event_type_id = a.booking.event_type_id;
    let (a, b) = tokio::join!(
        repo.reserve(a, Some(1), start, start + Duration::days(1)),
        repo.reserve(b, Some(1), start, start + Duration::days(1))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
}

#[sqlx::test(migrations = false)]
async fn reschedule_holds_both_times_without_blocking_the_days_between(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let mut moving = repo
        .reserve(booking(p.id, start), None, start, start + Duration::days(1))
        .await
        .unwrap();
    repo.reserve(
        booking(p.id, start + Duration::days(1)),
        None,
        start,
        start + Duration::days(3),
    )
    .await
    .unwrap();
    moving.booking.starts_at += Duration::days(2);
    moving.booking.ends_at += Duration::days(2);
    moving.busy_start += Duration::days(2);
    moving.busy_end += Duration::days(2);
    moving.booking.status = BookingStatus::Processing;
    moving = repo
        .move_booking(
            moving.clone(),
            BookingStatus::Pending,
            start,
            start + Duration::days(3),
        )
        .await
        .unwrap();
    for occupied in [start, start + Duration::days(2)] {
        assert!(matches!(
            repo.reserve(
                booking(p.id, occupied),
                None,
                start,
                start + Duration::days(3)
            )
            .await,
            Err(Error::Conflict)
        ));
    }
    moving.booking.status = BookingStatus::Pending;
    repo.update_booking(moving, BookingStatus::Processing)
        .await
        .unwrap();
    assert!(
        repo.reserve(booking(p.id, start), None, start, start + Duration::days(1))
            .await
            .is_ok()
    );
}

#[sqlx::test(migrations = false)]
async fn booking_history_is_bounded_but_host_counts_are_not(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let r = booking(p.id, start);
    let json = serde_json::to_value(&r).unwrap();
    let ids: Vec<_> = (0..5001).map(|_| Uuid::now_v7()).collect();
    sqlx::query!(
        "INSERT INTO scheduling_booking (id, profile_id, request_id, event_type_id, starts_at, ends_at, status, record) SELECT id, $1, id, $2, $3, $4, 'confirmed', $5 FROM unnest($6::uuid[]) AS id",
        p.id, r.booking.event_type_id, start, r.booking.ends_at, json, &ids
    ).execute(&pool).await.unwrap();
    let hosts = vec!["host".to_string(), "unused".to_string()];
    let counts = repo
        .host_booking_counts(p.id, &hosts, start, start + Duration::days(1))
        .await
        .unwrap();
    assert_eq!(counts.get("host"), Some(&5001));
    assert!(!counts.contains_key("unused"));
    assert!(
        repo.host_booking_counts(p.id, &hosts, start - Duration::days(1), start)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        matches!(repo.bookings(p.id, start, start + Duration::days(1)).await, Err(Error::Invalid(message)) if message.contains("shorter date range"))
    );
    assert!(
        repo.bookings(p.id, start - Duration::days(1), start)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrations = false)]
async fn recovery_claims_are_exclusive_and_completion_is_fenced(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let mut original = booking(p.id, start);
    original.booking.status = BookingStatus::Processing;
    let mut operation = CalendarOperation::new(CalendarOperationKind::Create);
    operation.retry_at = Utc::now() - Duration::seconds(1);
    original.operation = Some(operation);
    repo.reserve(original.clone(), None, start, start + Duration::days(1))
        .await
        .unwrap();
    let (a, b) = tokio::join!(repo.claim_recovery(), repo.claim_recovery());
    let mut claimed = a.unwrap().or(b.unwrap()).unwrap();
    assert_eq!(claimed.operation.as_ref().unwrap().attempt, 1);
    assert!(repo.claim_recovery().await.unwrap().is_none());
    original.booking.status = BookingStatus::Confirmed;
    assert!(matches!(
        repo.update_booking(original, BookingStatus::Processing)
            .await,
        Err(Error::Conflict)
    ));
    claimed.booking.status = BookingStatus::Confirmed;
    repo.update_booking(claimed, BookingStatus::Processing)
        .await
        .unwrap();
}

#[sqlx::test(migrations = false)]
async fn a_reverted_move_restores_its_time_and_releases_the_new_interval(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now().trunc_subsecs(0) + Duration::days(2);
    let original = booking(p.id, start);
    repo.reserve(original.clone(), None, start, start + Duration::days(1))
        .await
        .unwrap();
    let mut moving = original.clone();
    moving.booking.starts_at += Duration::hours(2);
    moving.booking.ends_at += Duration::hours(2);
    moving.busy_start += Duration::hours(2);
    moving.busy_end += Duration::hours(2);
    moving.operation = Some(CalendarOperation::new(CalendarOperationKind::Move {
        status: original.booking.status,
        original_start: start,
    }));
    moving.booking.status = BookingStatus::Processing;
    let moved = repo
        .move_booking(
            moving,
            original.booking.status,
            start,
            start + Duration::days(1),
        )
        .await
        .unwrap();
    let mut reverted = moved;
    reverted.booking.starts_at = original.booking.starts_at;
    reverted.booking.ends_at = original.booking.ends_at;
    reverted.busy_start = original.busy_start;
    reverted.busy_end = original.busy_end;
    reverted.booking.status = original.booking.status;
    let id = reverted.booking.id;
    repo.update_booking(reverted, BookingStatus::Processing)
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT starts_at, ends_at, recovery_at FROM scheduling_booking WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.starts_at, original.booking.starts_at);
    assert_eq!(row.ends_at, original.booking.ends_at);
    assert!(row.recovery_at.is_none());
    // The time the move asked for is free again; the original is still held.
    repo.reserve(
        booking(p.id, start + Duration::hours(2)),
        None,
        start,
        start + Duration::days(1),
    )
    .await
    .unwrap();
    assert!(matches!(
        repo.reserve(booking(p.id, start), None, start, start + Duration::days(1))
            .await,
        Err(Error::Conflict)
    ));
}

#[sqlx::test(migrations = false)]
async fn an_abandoned_operation_is_never_claimed_again(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let mut original = booking(p.id, start);
    original.booking.status = BookingStatus::Processing;
    let mut operation = CalendarOperation::new(CalendarOperationKind::Create);
    operation.retry_at = Utc::now() - Duration::seconds(1);
    original.operation = Some(operation);
    repo.reserve(original, None, start, start + Duration::days(1))
        .await
        .unwrap();
    let mut claimed = repo.claim_recovery().await.unwrap().unwrap();
    claimed.booking.status = BookingStatus::Failed;
    let operation = claimed.operation.as_mut().unwrap();
    operation.retry_at = Utc::now() - Duration::seconds(1);
    operation.abandoned_at = Some(Utc::now());
    let id = claimed.booking.id;
    repo.update_booking(claimed, BookingStatus::Processing)
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT status, recovery_at FROM scheduling_booking WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.status, "failed");
    assert!(row.recovery_at.is_none());
    assert!(repo.claim_recovery().await.unwrap().is_none());
    let reservations = sqlx::query_scalar!(
        "SELECT count(*) FROM scheduling_host_claim WHERE booking_id = $1",
        id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        reservations,
        Some(1),
        "an abandoned booking keeps its reservation"
    );
}

/// Bookings abandoned before the booking carried its own abandon time read
/// back with it, and a create refused on its first attempt reads back unsent.
#[sqlx::test(migrations = false)]
async fn older_abandoned_bookings_read_back_with_their_abandon_time(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let reserve = |offset: i64, due: bool| {
        let mut record = booking(p.id, start + Duration::hours(offset));
        record.booking.status = BookingStatus::Processing;
        let mut operation = CalendarOperation::new(CalendarOperationKind::Create);
        if due {
            operation.retry_at = Utc::now() - Duration::seconds(1);
        }
        record.operation = Some(operation);
        record
    };
    let first = repo
        .reserve(reserve(0, false), None, start, start + Duration::days(1))
        .await
        .unwrap();
    repo.reserve(reserve(2, true), None, start, start + Duration::days(1))
        .await
        .unwrap();
    let retried = repo.claim_recovery().await.unwrap().unwrap();
    let past = Utc::now() - Duration::hours(1);
    let mut late = booking(p.id, past);
    late.booking.status = BookingStatus::Processing;
    late.operation = Some(CalendarOperation::new(CalendarOperationKind::Create));
    let late = repo
        .reserve(late, None, past, past + Duration::days(1))
        .await
        .unwrap();
    let mut ids = Vec::new();
    for mut record in [first, retried, late] {
        // The shape an older release wrote: only the operation knows.
        record.booking.status = BookingStatus::Failed;
        record.booking.abandoned_at = None;
        record.operation.as_mut().unwrap().abandoned_at = Some(Utc::now());
        ids.push(record.booking.id);
        repo.update_booking(record, BookingStatus::Processing)
            .await
            .unwrap();
    }
    let first = repo.booking(ids[0]).await.unwrap().unwrap();
    let operation = first.operation.as_ref().unwrap();
    assert_eq!(first.booking.abandoned_at, operation.abandoned_at);
    assert!(operation.unsent);
    let retried = repo.booking(ids[1]).await.unwrap().unwrap();
    let operation = retried.operation.as_ref().unwrap();
    assert_eq!(retried.booking.abandoned_at, operation.abandoned_at);
    assert!(!operation.unsent, "a retried create may have landed");
    let late = repo.booking(ids[2]).await.unwrap().unwrap();
    let operation = late.operation.as_ref().unwrap();
    assert_eq!(late.booking.abandoned_at, operation.abandoned_at);
    assert!(
        !operation.unsent,
        "abandoned after its start, so not necessarily refused"
    );
}

#[sqlx::test(migrations = false)]
async fn public_budget_is_atomic_shared_and_resets_without_growing_rows(pool: PgPool) {
    setup(&pool).await;
    let repo = std::sync::Arc::new(PostgresRepository::new(pool.clone()));
    let p = repo.save_profile(owned()).await.unwrap();
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..50 {
        let repo = repo.clone();
        tasks.spawn(async move { repo.consume_budget(p.id, PublicBudget::Booking).await });
    }
    let mut admitted = 0;
    while let Some(result) = tasks.join_next().await {
        match result.unwrap() {
            Ok(()) => admitted += 1,
            Err(Error::RateLimited) => {}
            other => panic!("unexpected budget result: {other:?}"),
        }
    }
    assert_eq!(admitted, 30);
    sqlx::query!("UPDATE scheduling_public_budget SET window_start = now() - interval '2 hours' WHERE profile_id = $1", p.id).execute(&pool).await.unwrap();
    repo.consume_budget(p.id, PublicBudget::Booking)
        .await
        .unwrap();
    repo.consume_budget(p.id, PublicBudget::Availability)
        .await
        .unwrap();
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM scheduling_public_budget WHERE profile_id = $1",
            p.id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(2)
    );
}

#[sqlx::test(migrations = false)]
async fn stale_confirmed_snapshot_cannot_release_a_rescheduled_reservation(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let mut stale = booking(p.id, start);
    stale.booking.status = BookingStatus::Confirmed;
    repo.reserve(stale.clone(), None, start, start + Duration::days(1))
        .await
        .unwrap();
    let mut moving = stale.clone();
    moving.booking.starts_at += Duration::hours(2);
    moving.booking.ends_at += Duration::hours(2);
    moving.busy_start += Duration::hours(2);
    moving.busy_end += Duration::hours(2);
    moving.operation = Some(CalendarOperation::new(CalendarOperationKind::Move {
        status: BookingStatus::Confirmed,
        original_start: start,
    }));
    moving.booking.status = BookingStatus::Processing;
    let mut moved = repo
        .move_booking(
            moving,
            BookingStatus::Confirmed,
            start,
            start + Duration::days(1),
        )
        .await
        .unwrap();
    moved.booking.status = BookingStatus::Confirmed;
    repo.update_booking(moved, BookingStatus::Processing)
        .await
        .unwrap();
    stale.booking.attendance = BookingAttendance::Attended;
    assert!(matches!(
        repo.update_booking(stale.clone(), BookingStatus::Confirmed)
            .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repo.move_booking(
            stale,
            BookingStatus::Confirmed,
            start,
            start + Duration::days(1)
        )
        .await,
        Err(Error::Conflict)
    ));
    assert!(matches!(
        repo.reserve(
            booking(p.id, start + Duration::hours(2)),
            None,
            start,
            start + Duration::days(1)
        )
        .await,
        Err(Error::Conflict)
    ));
}

/// Starts moving `record` to `to` as `reschedule` does, leaving the move
/// waiting on the calendar's first answer.
async fn start_move(
    repo: &PostgresRepository,
    record: &BookingRecord,
    to: DateTime<Utc>,
) -> BookingRecord {
    let mut moving = record.clone();
    let shift = to - record.booking.starts_at;
    moving.booking.starts_at += shift;
    moving.booking.ends_at += shift;
    moving.busy_start += shift;
    moving.busy_end += shift;
    moving.operation = Some(CalendarOperation::new(CalendarOperationKind::Move {
        status: record.booking.status,
        original_start: record.booking.starts_at,
    }));
    moving.booking.status = BookingStatus::Processing;
    repo.move_booking(moving, record.booking.status, to, to + Duration::days(1))
        .await
        .unwrap()
}

#[sqlx::test(migrations = false)]
async fn a_move_waiting_on_the_calendar_holds_a_place_on_both_days(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool);
    let p = repo.save_profile(owned()).await.unwrap();
    let day = Utc::now().trunc_subsecs(0) + Duration::days(2);
    let next_day = day + Duration::days(1);
    let mut original = booking(p.id, day);
    original.event.daily_limit = Some(1);
    let original = repo
        .reserve(original, Some(1), day, next_day)
        .await
        .unwrap();
    let event_type = original.booking.event_type_id;
    let moving = start_move(&repo, &original, next_day).await;
    for start in [day, next_day] {
        assert_eq!(
            repo.daily_bookings(p.id, event_type, start, start + Duration::days(1), None)
                .await
                .unwrap(),
            1
        );
        // The booking being moved never takes a place from itself.
        assert_eq!(
            repo.daily_bookings(
                p.id,
                event_type,
                start,
                start + Duration::days(1),
                Some(moving.booking.id)
            )
            .await
            .unwrap(),
            0
        );
    }
    // A refusal would put the move back on its first day, so that day is
    // still full: neither a new booking nor another move may take it.
    let mut newcomer = booking(p.id, day + Duration::hours(3));
    newcomer.booking.event_type_id = event_type;
    assert!(matches!(
        repo.reserve(newcomer.clone(), Some(1), day, next_day).await,
        Err(Error::Conflict)
    ));
    let mut other = booking(p.id, day + Duration::days(4));
    other.booking.event_type_id = event_type;
    other.event.daily_limit = Some(1);
    let other = repo
        .reserve(
            other,
            Some(1),
            day + Duration::days(4),
            day + Duration::days(5),
        )
        .await
        .unwrap();
    let mut into_first_day = other.clone();
    into_first_day.booking.starts_at = day + Duration::hours(5);
    into_first_day.booking.ends_at = day + Duration::hours(5) + Duration::minutes(30);
    into_first_day.busy_start = into_first_day.booking.starts_at;
    into_first_day.busy_end = into_first_day.booking.ends_at;
    into_first_day.booking.status = BookingStatus::Processing;
    assert!(matches!(
        repo.move_booking(into_first_day, other.booking.status, day, next_day)
            .await,
        Err(Error::Conflict)
    ));
    // Refused and put back: the first day holds exactly its limit.
    let mut reverted = moving.clone();
    reverted.booking.starts_at = original.booking.starts_at;
    reverted.booking.ends_at = original.booking.ends_at;
    reverted.busy_start = original.busy_start;
    reverted.busy_end = original.busy_end;
    reverted.booking.status = original.booking.status;
    let reverted = repo
        .update_booking(reverted, BookingStatus::Processing)
        .await
        .unwrap();
    assert_eq!(
        repo.daily_bookings(p.id, event_type, day, next_day, None)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        repo.daily_bookings(
            p.id,
            event_type,
            next_day,
            next_day + Duration::days(1),
            None
        )
        .await
        .unwrap(),
        0
    );
    // Accepted: the move leaves its first day for good.
    let mut accepted = start_move(&repo, &reverted, next_day).await;
    accepted.booking.status = reverted.booking.status;
    repo.update_booking(accepted, BookingStatus::Processing)
        .await
        .unwrap();
    assert!(repo.reserve(newcomer, Some(1), day, next_day).await.is_ok());
}

#[sqlx::test(migrations = false)]
async fn a_move_past_its_first_attempt_counts_only_on_its_new_day(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let day = Utc::now().trunc_subsecs(0) + Duration::days(2);
    let next_day = day + Duration::days(1);
    let original = repo
        .reserve(booking(p.id, day), Some(1), day, next_day)
        .await
        .unwrap();
    let moving = start_move(&repo, &original, next_day).await;
    // A recovery claim moves it past its first attempt; a refusal then
    // abandons it at the new time instead of putting it back.
    sqlx::query!(
        "UPDATE scheduling_booking SET record = jsonb_set(record, '{operation,attempt}', '1') WHERE id = $1",
        moving.booking.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let event_type = original.booking.event_type_id;
    assert_eq!(
        repo.daily_bookings(p.id, event_type, day, next_day, None)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        repo.daily_bookings(
            p.id,
            event_type,
            next_day,
            next_day + Duration::days(1),
            None
        )
        .await
        .unwrap(),
        1
    );
}
