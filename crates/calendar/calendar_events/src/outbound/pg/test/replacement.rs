use super::*;
use crate::domain::replacement::*;
use serde_json::json;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacement_journal_serializes_confirmation_preserves_privacy_and_survives_source_retirement(
    pool: PgPool,
) {
    let user = "macro|replacement@example.com";
    insert_user(&pool, user).await;
    let other = "macro|other@example.com";
    insert_user(&pool, other).await;
    let link = insert_link(&pool, user).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link).await;
    let event = timed_upsert(user, link, provider, "original", "Reviewed", 0).event;
    let operation = CalendarReplacement {
        id: Uuid::now_v7(),
        user_id: user.into(),
        calendar_id: provider.1,
        event_id: event.id,
        master_id: "master".into(),
        recurrence_id: None,
        snapshot: ReplacementSnapshot {
            source_id: "original".into(),
            is_organizer: true,
            title: event.title.clone(),
            time: event.time.clone(),
            attendee_count: 2,
            is_series: false,
            remove_conference: true,
            provider_url: None,
            payload: json!({}),
            occurrences: vec![],
        },
        next_step: 0,
        command: None,
        replacement_provider_id: None,
        result: None,
    };
    let (first, second) = tokio::join!(
        repo.prepare_replacement(operation.clone()),
        repo.prepare_replacement(CalendarReplacement {
            id: Uuid::now_v7(),
            ..operation.clone()
        })
    );
    let saved = first.unwrap();
    assert_eq!(saved.id, second.unwrap().id);
    assert!(repo.replacement(other, saved.id).await.unwrap().is_none());
    assert!(
        repo.prepare_replacement(CalendarReplacement {
            user_id: other.into(),
            ..operation
        })
        .await
        .is_err()
    );
    assert!(
        repo.claim_pending_replacements(10)
            .await
            .unwrap()
            .is_empty()
    );
    let command = json!({"kind":"create"});
    let (a, b) = tokio::join!(
        repo.start_replacement_step(saved.id, 0, &command),
        repo.start_replacement_step(saved.id, 0, &command)
    );
    assert_ne!(a.unwrap(), b.unwrap());
    assert!(!repo.discard_replacement(user, saved.id).await.unwrap());
    sqlx::query!(
        "UPDATE calendar_event_replacements SET updated_at=now()-interval '1 minute' WHERE id=$1",
        saved.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.claim_pending_replacements(10).await.unwrap(),
        vec![(user.to_owned(), saved.id)]
    );
    assert!(
        repo.claim_pending_replacements(10)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.finish_replacement_step(saved.id, 0, Some("new"))
            .await
            .unwrap()
    );
    assert!(
        !repo
            .finish_replacement_step(saved.id, 0, Some("wrong"))
            .await
            .unwrap()
    );
    assert_eq!(
        repo.replacement(user, saved.id)
            .await
            .unwrap()
            .unwrap()
            .replacement_provider_id
            .as_deref(),
        Some("new")
    );
    assert!(
        repo.start_replacement_step(saved.id, 1, &json!({"kind":"delete"}))
            .await
            .unwrap()
    );
    assert!(
        repo.finish_replacement_step(saved.id, 1, None)
            .await
            .unwrap()
    );
    repo.complete_replacement(saved.id, &event).await.unwrap();
    assert_eq!(
        repo.replacement(user, saved.id)
            .await
            .unwrap()
            .unwrap()
            .result
            .unwrap()
            .id,
        event.id
    );
    assert!(
        repo.active_replacement(user, provider.1, "master")
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query!("DELETE FROM calendars WHERE id=$1", provider.1)
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo.replacement(user, saved.id).await.unwrap().is_none());
}
