use super::*;
use crate::domain::models::NotificationAction;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn persisted_transitions_match_domain_policy(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("user@test.com");
    let id = uuid::uuid!("0193b1ea-a542-7589-893b-2b4a509c1e76");
    for before in [
        NotificationState::Unseen,
        NotificationState::Seen,
        NotificationState::Done,
    ] {
        for action in [
            NotificationAction::MarkSeen,
            NotificationAction::MarkDone,
            NotificationAction::Reopen,
        ] {
            sqlx::query!(
                "UPDATE user_notification SET state = $3, seen_at = NULL WHERE user_id = $1 AND notification_id = $2",
                user.as_ref(), id, before as _,
            ).execute(&pool).await?;
            let expected = before.apply(action);
            let mut first_viewed_at = None;
            for attempt in 0..2 {
                let rows = match action {
                    NotificationAction::MarkSeen => {
                        pool.mark_notifications_seen(&user, &[id]).await?
                    }
                    NotificationAction::MarkDone => {
                        pool.mark_notifications_done(&user, &[id], true).await?
                    }
                    NotificationAction::Reopen => {
                        pool.mark_notifications_done(&user, &[id], false).await?
                    }
                };
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].state, expected, "{before:?} + {action:?}");
                if attempt == 0 {
                    first_viewed_at = rows[0].viewed_at;
                } else {
                    assert_eq!(
                        rows[0].viewed_at, first_viewed_at,
                        "retries must retain the viewing timestamp"
                    );
                }
                let stored = sqlx::query_scalar!(
                    r#"SELECT state as "state!: NotificationState" FROM user_notification WHERE user_id = $1 AND notification_id = $2"#,
                    user.as_ref(), id,
                ).fetch_one(&pool).await?;
                assert_eq!(stored, expected);
                for filter_state in [
                    NotificationState::Unseen,
                    NotificationState::Seen,
                    NotificationState::Done,
                ] {
                    let matching = pool
                        .get_user_notifications::<serde_json::Value>(
                            user.clone(),
                            10,
                            Query::Sort(CreatedAt, ()),
                            crate::domain::models::request::NotificationListFilters {
                                states: vec![filter_state],
                                include_types: vec![],
                                entities: vec![],
                            },
                        )
                        .await?;
                    assert_eq!(matching.len(), usize::from(expected == filter_state));
                }
            }
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entity_updates_skip_noops_and_retries(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("entity-transitions@test.com");
    let original_viewed_at = chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    for (status, action) in [
        (NotificationStatus::Seen, NotificationAction::MarkSeen),
        (NotificationStatus::Done(true), NotificationAction::MarkDone),
        (NotificationStatus::Done(false), NotificationAction::Reopen),
    ] {
        let entity = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
        let mut expected = HashSet::new();
        let mut initial = Vec::new();
        for before in [
            NotificationState::Unseen,
            NotificationState::Seen,
            NotificationState::Done,
        ] {
            for viewed_at in [None, Some(original_viewed_at)] {
                let id = Uuid::now_v7();
                pool.create_notification(
                    SendNotificationRequestBuilder {
                        notification_entity: entity.clone(),
                        secondary_notification_entity: None,
                        notification: TaggedContent::new(TestNotification {
                            message: "history".to_string(),
                        }),
                        sender_id: None,
                        recipient_ids: HashSet::from([user.clone()]),
                    },
                    id,
                    "test_service",
                    None,
                )
                .await?;
                sqlx::query!(
                    "UPDATE user_notification SET state = $3, seen_at = $4 WHERE user_id = $1 AND notification_id = $2",
                    user.as_ref(), id, before as _, viewed_at.map(|time| time.naive_utc()),
                ).execute(&pool).await?;
                if before.apply(action) != before
                    || (matches!(action, NotificationAction::MarkSeen) && viewed_at.is_none())
                {
                    expected.insert(id);
                }
                initial.push((id, before, viewed_at));
            }
        }
        let ids = pool
            .get_notification_ids_for_entities(&user, std::slice::from_ref(&entity), &status)
            .await?;
        assert_eq!(ids.iter().copied().collect::<HashSet<_>>(), expected);
        let updated = match status {
            NotificationStatus::Seen => pool.mark_notifications_seen(&user, &ids).await?,
            NotificationStatus::Done(done) => {
                pool.mark_notifications_done(&user, &ids, done).await?
            }
        };
        assert_eq!(updated.len(), expected.len());
        assert!(
            pool.get_notification_ids_for_entities(&user, &[entity], &status)
                .await?
                .is_empty()
        );
        for (id, before, viewed_at) in initial {
            let row = pool
                .get_user_notification_by_id::<serde_json::Value>(user.clone(), id)
                .await?
                .unwrap();
            assert_eq!(row.state, before.apply(action));
            if matches!(action, NotificationAction::MarkSeen) && viewed_at.is_none() {
                assert!(row.viewed_at.is_some());
            } else {
                assert_eq!(row.viewed_at, viewed_at);
            }
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn concurrent_seen_and_done_do_not_reopen(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("user@test.com");
    let ids = [uuid::uuid!("0193b1ea-a542-7589-893b-2b4a509c1e76")];
    let (seen, done) = tokio::join!(
        pool.mark_notifications_seen(&user, &ids),
        pool.mark_notifications_done(&user, &ids, true),
    );
    seen?;
    done?;
    let row = pool
        .get_user_notification_by_id::<serde_json::Value>(user, ids[0])
        .await?
        .unwrap();
    assert_eq!(row.state, NotificationState::Done);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn done_without_a_view_is_not_digest_eligible(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("user@test.com");
    let ids = [uuid::uuid!("0193b1ea-a542-7589-893b-2b4a509c1e76")];
    let rows = pool.mark_notifications_done(&user, &ids, true).await?;
    assert_eq!(rows[0].state, NotificationState::Done);
    assert_eq!(rows[0].viewed_at, None);
    assert!(
        pool.get_digest_eligible_notification_ids(&user, &ids)
            .await?
            .is_empty()
    );
    let rows = pool.mark_notifications_done(&user, &ids, false).await?;
    assert_eq!(rows[0].state, NotificationState::Seen);
    assert_eq!(rows[0].viewed_at, None);
    assert!(
        pool.get_digest_eligible_notification_ids(&user, &ids)
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn mark_seen_preserves_the_original_view_time(pool: Pool<Postgres>) -> Result<(), Report> {
    let user = test_user("user@test.com");
    let ids = [uuid::uuid!("0193b1ea-a542-7589-893b-2b4a509c1e76")];
    let viewed_at = chrono::DateTime::parse_from_rfc3339("2020-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    sqlx::query!(
        "UPDATE user_notification SET state = 'done', seen_at = $3 WHERE user_id = $1 AND notification_id = $2",
        user.as_ref(), ids[0], viewed_at.naive_utc(),
    ).execute(&pool).await?;
    let rows = pool.mark_notifications_seen(&user, &ids).await?;
    assert_eq!(rows[0].state, NotificationState::Done);
    assert_eq!(rows[0].viewed_at, Some(viewed_at));
    Ok(())
}
