use super::*;

const OWNER: &str = "macro|search-share-owner@example.com";
const MEMBER: &str = "macro|search-share-member@example.com";
const ATTENDEE: &str = "macro|search-share-attendee@example.com";
const FORMER: &str = "macro|search-share-former@example.com";
const STRANGER: &str = "macro|search-share-stranger@example.com";

async fn insert_event(
    pool: &Pool<Postgres>,
    owner_id: &str,
    ical_uid: &str,
    visibility: &str,
) -> Uuid {
    let link_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
        VALUES ($1, $2, $2, $1::text || '@example.com', 'GMAIL')
        "#,
    )
    .bind(link_id)
    .bind(owner_id)
    .execute(pool)
    .await
    .unwrap();
    let event_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendar_events (
            id, owner_id, source_link_id, ical_uid, title, visibility,
            canonical_source_kind, conference_url, starts_at, ends_at
        )
        VALUES (
            $1, $2, $3, $4, 'Pilates', $5, 'google', 'https://meet.google.com/abc-defg-hij',
            now(), now() + interval '1 hour'
        )
        "#,
    )
    .bind(event_id)
    .bind(owner_id)
    .bind(link_id)
    .bind(ical_uid)
    .bind(visibility)
    .execute(pool)
    .await
    .unwrap();
    event_id
}

async fn insert_channel(pool: &Pool<Postgres>) -> Uuid {
    let channel_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO comms_channels (id, channel_type, owner_id) VALUES ($1, 'private', $2)",
    )
    .bind(channel_id)
    .bind(OWNER)
    .execute(pool)
    .await
    .unwrap();
    for (participant, left) in [
        (OWNER, false),
        (MEMBER, false),
        (ATTENDEE, false),
        (FORMER, true),
    ] {
        sqlx::query(
            r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
            VALUES ($1, $2, 'member', CASE WHEN $3 THEN now() END)
            "#,
        )
        .bind(channel_id)
        .bind(participant)
        .bind(left)
        .execute(pool)
        .await
        .unwrap();
    }
    channel_id
}

async fn share_with_channel(pool: &Pool<Postgres>, event_id: Uuid, channel_id: Uuid) {
    sqlx::query(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'calendar_event', $2::uuid::text, 'channel', 'view')
        "#,
    )
    .bind(event_id)
    .bind(channel_id)
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test]
async fn shared_ids_cover_live_shares_the_member_holds_no_copy_of(pool: Pool<Postgres>) {
    let shared = insert_event(&pool, OWNER, "shared@example.com", "default").await;
    let attended = insert_event(&pool, OWNER, "attended@example.com", "public").await;
    insert_event(&pool, ATTENDEE, "attended@example.com", "default").await;
    let private = insert_event(&pool, OWNER, "private@example.com", "private").await;
    let confidential = insert_event(&pool, OWNER, "confidential@example.com", "confidential").await;
    insert_event(&pool, OWNER, "unshared@example.com", "default").await;
    let channel_id = insert_channel(&pool).await;
    for event_id in [shared, attended, private, confidential] {
        share_with_channel(&pool, event_id, channel_id).await;
    }

    let mut member = get_channel_shared_calendar_event_ids(&pool, MEMBER)
        .await
        .unwrap();
    member.sort();
    assert_eq!(member, vec![shared, attended]);

    // A copy of the same meeting on the attendee's own calendar is what their
    // own scope finds, so the share does not list it twice.
    assert_eq!(
        get_channel_shared_calendar_event_ids(&pool, ATTENDEE)
            .await
            .unwrap(),
        vec![shared]
    );
    // The sharer holds every event they shared.
    assert!(
        get_channel_shared_calendar_event_ids(&pool, OWNER)
            .await
            .unwrap()
            .is_empty()
    );
    for outsider in [FORMER, STRANGER] {
        assert!(
            get_channel_shared_calendar_event_ids(&pool, outsider)
                .await
                .unwrap()
                .is_empty(),
            "{outsider}"
        );
    }

    sqlx::query("UPDATE calendar_events SET status = 'cancelled' WHERE id = $1")
        .bind(shared)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        get_channel_shared_calendar_event_ids(&pool, MEMBER)
            .await
            .unwrap(),
        vec![attended]
    );
}

#[sqlx::test]
async fn search_metadata_reaches_a_channel_share_without_its_join_link(pool: Pool<Postgres>) {
    let shared = insert_event(&pool, OWNER, "shared@example.com", "default").await;
    let private = insert_event(&pool, OWNER, "private@example.com", "private").await;
    let unshared = insert_event(&pool, OWNER, "unshared@example.com", "default").await;
    let channel_id = insert_channel(&pool).await;
    share_with_channel(&pool, shared, channel_id).await;
    share_with_channel(&pool, private, channel_id).await;
    let ids = [shared, private, unshared];
    let now = Utc::now();

    let owner = get_calendar_events_for_search(&pool, OWNER, &ids, now)
        .await
        .unwrap();
    assert_eq!(owner.len(), 3);
    assert_eq!(
        owner[&shared].conference_url.as_deref(),
        Some("https://meet.google.com/abc-defg-hij")
    );

    let member = get_calendar_events_for_search(&pool, MEMBER, &ids, now)
        .await
        .unwrap();
    assert_eq!(member.keys().collect::<Vec<_>>(), vec![&shared]);
    assert_eq!(member[&shared].title, "Pilates");
    assert_eq!(member[&shared].owner_id, OWNER);
    assert_eq!(member[&shared].conference_url, None);

    for outsider in [FORMER, STRANGER] {
        assert!(
            get_calendar_events_for_search(&pool, outsider, &ids, now)
                .await
                .unwrap()
                .is_empty(),
            "{outsider}"
        );
    }

    sqlx::query("UPDATE calendar_events SET status = 'cancelled' WHERE id = $1")
        .bind(shared)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        get_calendar_events_for_search(&pool, MEMBER, &ids, now)
            .await
            .unwrap()
            .is_empty()
    );
}
