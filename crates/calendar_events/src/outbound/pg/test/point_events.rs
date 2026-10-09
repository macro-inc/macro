use super::*;
use crate::domain::team::CalendarTeamRepository;
use crate::outbound::pg_team::PgCalendarTeamRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn point_event_keeps_its_start_based_reminder_identity(pool: PgPool) {
    let owner = "macro|point-reminder@example.com";
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let starts_at = (Utc::now() + Duration::hours(2)).trunc_subsecs(0);
    let mut event = reminder_upsert(
        owner,
        link,
        provider,
        "point-reminder",
        starts_at,
        popup_reminders(&[10]),
    );
    let point = EventTime::Timed {
        starts_at,
        ends_at: starts_at,
        time_zone: Some("UTC".to_owned()),
    };
    event.event.time = point.clone();
    event.occurrences[0].time = point;
    let id = repo.upsert_event_fixture(event).await.unwrap();
    assert_eq!(
        scheduled_firings(&pool, id).await,
        vec![(
            starts_at.to_rfc3339(),
            10,
            starts_at - Duration::minutes(10)
        )]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn point_storage_and_own_and_team_queries_preserve_half_open_membership(pool: PgPool) {
    let owner = "macro|point-owner@example.com";
    let viewer = "macro|point-viewer@example.com";
    insert_team(&pool, viewer, &[viewer, owner]).await;
    let link = insert_link(&pool, owner).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let mut upsert = timed_upsert(owner, link, provider, "points", "Point series", 1);
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 9, 0, 0).unwrap();
    let ends_at = starts_at + Duration::hours(1);
    let point = |instant| EventTime::Timed {
        starts_at: instant,
        ends_at: instant,
        time_zone: None,
    };
    upsert.event.time = point(starts_at);
    // Use OOO to prove the compatibility endpoint does not turn a point into
    // an absence while ordinary browsing retains the real event identity.
    upsert.event.event_type = EventType::OutOfOffice;
    upsert.occurrences = [
        starts_at - Duration::minutes(1),
        starts_at,
        starts_at + Duration::minutes(30),
        ends_at,
    ]
    .into_iter()
    .map(|instant| CalendarOccurrence {
        event_id: upsert.event.id,
        occurrence_key: instant.to_rfc3339(),
        recurrence_id: Some(instant.to_rfc3339()),
        time: point(instant),
        is_cancelled: false,
    })
    .collect();
    upsert.overrides = vec![CalendarEventOverride {
        recurrence_id: starts_at.to_rfc3339(),
        original_time: EventStart::Timed(starts_at),
        time: point(starts_at),
        title: Some("Point exception".to_owned()),
        description: None,
        location: None,
        status: None,
        attendees: None,
        visibility: None,
        transparency: None,
        sequence: None,
        source_updated_at: None,
    }];
    let event_id = upsert.event.id;
    repo.upsert_event_fixture(upsert).await.unwrap();
    enable_team_details(&repo, &[owner]).await;
    let range = OccurrenceRange {
        starts_at,
        ends_at,
        start_date: starts_at.date_naive(),
        end_date: starts_at.date_naive().succ_opt().unwrap(),
    };
    let own = repo
        .list_occurrences(owner, range.clone(), None, 100)
        .await
        .unwrap();
    assert_eq!(own.len(), 2);
    assert!(own.iter().all(|row| row.event.id == event_id));
    assert_eq!(own[0].occurrence.time, point(starts_at));
    assert_eq!(
        own[1].occurrence.time,
        point(starts_at + Duration::minutes(30))
    );
    let shared = PgCalendarTeamRepository::new(pool.clone())
        .sources(viewer, range.clone(), &[owner.to_owned()], None, 100)
        .await
        .unwrap();
    assert_eq!(shared.len(), 2);
    assert_eq!(shared[0].time(), &point(starts_at));
    assert_eq!(shared[1].time(), &point(starts_at + Duration::minutes(30)));
    assert!(
        repo.list_team_out_of_office(viewer, range, 100)
            .await
            .unwrap()
            .is_empty()
    );

    // The migration relaxes equality only: all three physical time shapes
    // still reject reversed timed intervals and nonpositive all-day spans.
    for (start, end, date) in [
        (
            Some(starts_at),
            Some(starts_at - Duration::seconds(1)),
            None,
        ),
        (None, None, Some(starts_at.date_naive())),
    ] {
        assert!(sqlx::query!(
            "UPDATE calendar_events SET starts_at=$2,ends_at=$3,start_date=$4,end_date=$4 WHERE id=$1",
            event_id, start, end, date
        ).execute(&pool).await.is_err());
        assert!(sqlx::query!(
            "UPDATE calendar_event_overrides SET starts_at=$2,ends_at=$3,start_date=$4,end_date=$4 WHERE event_id=$1",
            event_id, start, end, date
        ).execute(&pool).await.is_err());
        assert!(sqlx::query!(
            "UPDATE calendar_event_occurrences SET starts_at=$2,ends_at=$3,start_date=$4,end_date=$4 WHERE event_id=$1",
            event_id, start, end, date
        ).execute(&pool).await.is_err());
    }
}
