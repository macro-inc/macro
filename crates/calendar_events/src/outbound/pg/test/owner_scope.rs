use super::*;
use crate::domain::changes::CalendarChangeRepository;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_scope_preserves_link_access_and_half_open_time_windows(pool: PgPool) {
    let owner = "macro|owner-scope@example.com";
    let child = "macro|child-scope@example.com";
    let stranger = "macro|stranger-scope@example.com";
    insert_user(&pool, owner).await;
    insert_user(&pool, child).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let own_link = insert_link(&pool, owner).await;
    let shared_link = insert_link(&pool, child).await;
    let private_link = insert_link(&pool, child).await;
    let stranger_link = insert_link(&pool, stranger).await;
    sqlx::query!(
        "INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id) VALUES ($1, $2, $3)",
        owner,
        child,
        shared_link,
    )
    .execute(&pool)
    .await
    .unwrap();
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 14, 0, 0).unwrap();
    let ends_at = starts_at + Duration::hours(1);
    let date = starts_at.date_naive();
    let range = OccurrenceRange {
        starts_at,
        ends_at,
        start_date: date,
        end_date: date.succ_opt().unwrap(),
    };
    let mut ids = Vec::new();
    let mut visible_ids = Vec::new();
    for (account, link, accessible) in [
        (owner, own_link, true),
        (child, shared_link, true),
        (child, private_link, false),
        (stranger, stranger_link, false),
    ] {
        let provider = provider_ids(&repo, link).await;
        let mut upsert = timed_upsert(account, link, provider, "owner-scope", "Scoped", 1);
        let id = upsert.event.id;
        upsert.occurrences = [
            // An overlap, both point boundaries, a non-overlap, and cancellation.
            (
                starts_at - Duration::minutes(30),
                starts_at + Duration::minutes(30),
                false,
            ),
            (starts_at, starts_at, false),
            (ends_at, ends_at, false),
            (starts_at - Duration::hours(1), starts_at, false),
            (starts_at + Duration::minutes(10), ends_at, true),
        ]
        .into_iter()
        .map(|(start, end, is_cancelled)| CalendarOccurrence {
            event_id: id,
            occurrence_key: start.to_rfc3339(),
            recurrence_id: None,
            time: EventTime::Timed {
                starts_at: start,
                ends_at: end,
                time_zone: None,
            },
            is_cancelled,
        })
        .chain(
            [date.pred_opt().unwrap(), date, date.succ_opt().unwrap()]
                .into_iter()
                .map(|start| CalendarOccurrence {
                    event_id: id,
                    occurrence_key: start.to_string(),
                    recurrence_id: None,
                    time: EventTime::AllDay {
                        start_date: start,
                        end_date: start.succ_opt().unwrap(),
                    },
                    is_cancelled: false,
                }),
        )
        .collect();
        repo.upsert_event_fixture(upsert).await.unwrap();
        ids.push(id);
        if accessible {
            visible_ids.push(id);
        }
    }
    let listed = repo
        .list_occurrences(owner, range.clone(), None, 100)
        .await
        .unwrap();
    assert_eq!(listed.len(), 6);
    for id in &visible_ids {
        let rows: Vec<_> = listed.iter().filter(|row| row.event.id == *id).collect();
        assert_eq!(rows.len(), 3);
        assert!(
            rows.iter()
                .any(|row| row.occurrence.occurrence_key == starts_at.to_rfc3339())
        );
        assert!(
            rows.iter()
                .any(|row| row.occurrence.occurrence_key == date.to_string())
        );
        assert!(
            rows.iter().any(|row| row.occurrence.occurrence_key
                == (starts_at - Duration::minutes(30)).to_rfc3339())
        );
    }
    let page = repo
        .list_occurrences(owner, range.clone(), None, 2)
        .await
        .unwrap();
    let cursor = CalendarOccurrenceCursor::from_occurrence(&page.last().unwrap().occurrence);
    let rest = repo
        .list_occurrences(owner, range.clone(), Some(cursor), 100)
        .await
        .unwrap();
    assert_eq!(rest.len(), 4);
    assert_eq!(
        page.into_iter()
            .chain(rest)
            .map(|row| (row.event.id, row.occurrence.occurrence_key))
            .collect::<Vec<_>>(),
        listed
            .into_iter()
            .map(|row| (row.event.id, row.occurrence.occurrence_key))
            .collect::<Vec<_>>()
    );
    assert!(
        repo.list_occurrences("macro|unlinked@example.com", range, None, 100)
            .await
            .unwrap()
            .is_empty()
    );

    let changes = repo.load_event_changes(owner, &ids, 100).await.unwrap();
    assert_eq!(changes.considered, 4);
    assert_eq!(changes.events.len(), 2);
    assert!(
        changes
            .events
            .iter()
            .all(|row| visible_ids.contains(&row.event.id) && row.occurrences.len() == 7)
    );
    assert!(
        repo.load_event_changes("macro|unlinked@example.com", &ids, 100)
            .await
            .unwrap()
            .events
            .is_empty()
    );
}
