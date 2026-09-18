use super::*;
use chrono::Duration;

async fn setup(pool: &PgPool) {
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
            location: String::new(),
            answers: Default::default(),
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
async fn booking_list_reports_overflow_instead_of_returning_partial_counts(pool: PgPool) {
    setup(&pool).await;
    let repo = PostgresRepository::new(pool.clone());
    let p = repo.save_profile(owned()).await.unwrap();
    let start = Utc::now() + Duration::days(2);
    let r = booking(p.id, start);
    let json = serde_json::to_value(&r).unwrap();
    sqlx::query!(
        "INSERT INTO scheduling_booking (id, profile_id, request_id, event_type_id, starts_at, ends_at, status, record) SELECT gen_random_uuid(), $1, gen_random_uuid(), $2, $3, $4, 'cancelled', $5 FROM generate_series(1, 5001)",
        p.id, r.booking.event_type_id, start, r.booking.ends_at, json
    ).execute(&pool).await.unwrap();
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
