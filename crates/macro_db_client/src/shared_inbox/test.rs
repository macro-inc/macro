use super::*;
use model_entity::EntityType;
use models_permissions::share_permission::{
    access_level::AccessLevel,
    team_share::{TeamShareLevel, TeamShareRequest, authorize_team_share},
};
use share_permission_db_utils::team_share::{apply, load_facts};
use sqlx::{Pool, Postgres};

const OWNER: &str = "macro|alice@company.test";
const CONNECTOR: &str = "macro|bob@company.test";
const MAILBOX_EMAIL: &str = "support@external.test";

async fn insert_user(pool: &Pool<Postgres>, macro_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        macro_id,
        email,
        macro_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        macro_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A data-source link for `email` owned by `macro_id` (the first connector's own macro_id).
async fn insert_data_source_link(pool: &Pool<Postgres>, macro_id: &str, email: &str) -> Uuid {
    let link_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        macro_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    link_id
}

#[sqlx::test]
async fn promote_dedups_to_single_link_with_two_edges(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "alice@company.test").await;
    insert_user(&pool, CONNECTOR, "bob@company.test").await;
    let link_id = insert_data_source_link(&pool, OWNER, MAILBOX_EMAIL).await;

    let mut conn = pool.acquire().await?;
    let result =
        promote_link_to_shared(&mut conn, link_id, OWNER, CONNECTOR, MAILBOX_EMAIL, None).await?;

    let mailbox_macro_id = format!("macro|{MAILBOX_EMAIL}");
    assert_eq!(result.mailbox_macro_id, mailbox_macro_id);
    // The link survives in place — single synced copy, id unchanged.
    assert_eq!(result.link_id, link_id);

    // Exactly one link for the mailbox email, re-homed onto the mailbox macro_id.
    let links = sqlx::query!(
        r#"SELECT id, macro_id FROM email_links WHERE email_address = $1"#,
        MAILBOX_EMAIL
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(links.len(), 1, "must remain a single link");
    assert_eq!(links[0].id, link_id);
    assert_eq!(links[0].macro_id, mailbox_macro_id);

    // is_primary is generated as `link.email == macro_id's email`. The minted macro_id
    // embeds the mailbox email, so the promoted mailbox is a real shared user, not inbox-only.
    // The returned fusion id is the minted macro_user.id, which grant relocation reuses as
    // the FusionAuth stub's id.
    let mailbox_user = sqlx::query!(
        r#"SELECT email, macro_user_id FROM "User" WHERE id = $1"#,
        mailbox_macro_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(mailbox_user.email, MAILBOX_EMAIL);
    assert_eq!(mailbox_user.macro_user_id, result.mailbox_fusion_id);

    // Both the original owner and the new connector hold an edge to the mailbox.
    let mut primaries =
        crate::macro_user_links::get_primaries_for_child(&pool, &mailbox_macro_id).await?;
    primaries.sort();
    assert_eq!(primaries, vec![OWNER.to_string(), CONNECTOR.to_string()]);

    // The minted edges are scoped to the re-homed link, not account-wide.
    let scoped_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM macro_user_links
           WHERE child_macro_id = $1 AND link_id = $2"#,
        mailbox_macro_id,
        link_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(scoped_count, 2);

    Ok(())
}

#[sqlx::test]
async fn promote_normalizes_mailbox_email_for_fusionauth_webhook(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "alice@company.test").await;
    insert_user(&pool, CONNECTOR, "bob@company.test").await;
    let mixed_case_mailbox = "Support@External.Test";
    let link_id = insert_data_source_link(&pool, OWNER, mixed_case_mailbox).await;

    let mut conn = pool.acquire().await?;
    let result = promote_link_to_shared(
        &mut conn,
        link_id,
        OWNER,
        CONNECTOR,
        mixed_case_mailbox,
        None,
    )
    .await?;

    assert_eq!(result.mailbox_macro_id, "macro|support@external.test");

    let mailbox_user = sqlx::query!(
        r#"SELECT email, macro_user_id FROM "User" WHERE id = $1"#,
        result.mailbox_macro_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(mailbox_user.email, "support@external.test");
    assert_eq!(mailbox_user.macro_user_id, result.mailbox_fusion_id);

    let link = sqlx::query!(
        r#"SELECT email_address FROM email_links WHERE id = $1"#,
        link_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(link.email_address, "support@external.test");

    Ok(())
}

#[sqlx::test]
async fn promote_is_atomic_on_rollback(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "alice@company.test").await;
    insert_user(&pool, CONNECTOR, "bob@company.test").await;
    let link_id = insert_data_source_link(&pool, OWNER, MAILBOX_EMAIL).await;

    let mut tx = pool.begin().await?;
    promote_link_to_shared(&mut tx, link_id, OWNER, CONNECTOR, MAILBOX_EMAIL, None).await?;
    // Drop the transaction without committing.
    drop(tx);

    // Nothing leaked: the link is still owned by the original connector and no mailbox user exists.
    let link = sqlx::query!(r#"SELECT macro_id FROM email_links WHERE id = $1"#, link_id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(link.macro_id, OWNER);

    let mailbox_macro_id = format!("macro|{MAILBOX_EMAIL}");
    let mailbox_user = sqlx::query!(r#"SELECT id FROM "User" WHERE id = $1"#, mailbox_macro_id)
        .fetch_optional(&pool)
        .await?;
    assert!(mailbox_user.is_none(), "rolled-back mint must not persist");

    Ok(())
}

#[sqlx::test]
async fn promote_errors_when_link_missing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "alice@company.test").await;
    insert_user(&pool, CONNECTOR, "bob@company.test").await;

    // The link vanished between lookup and promotion (e.g. owner disconnected it).
    let missing_link_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let result = promote_link_to_shared(
        &mut tx,
        missing_link_id,
        OWNER,
        CONNECTOR,
        MAILBOX_EMAIL,
        None,
    )
    .await;
    drop(tx);
    assert!(
        result.is_err(),
        "promotion must fail when no link is re-homed"
    );

    // The aborted transaction left no phantom mailbox user behind.
    let mailbox_macro_id = format!("macro|{MAILBOX_EMAIL}");
    let mailbox_user = sqlx::query!(r#"SELECT id FROM "User" WHERE id = $1"#, mailbox_macro_id)
        .fetch_optional(&pool)
        .await?;
    assert!(
        mailbox_user.is_none(),
        "phantom mailbox user must not persist"
    );

    Ok(())
}

#[sqlx::test]
async fn promote_marks_mailbox_and_teardown_removes_everything(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, OWNER, "alice@company.test").await;
    insert_user(&pool, CONNECTOR, "bob@company.test").await;
    let link_id = insert_data_source_link(&pool, OWNER, MAILBOX_EMAIL).await;

    let mut conn = pool.acquire().await?;
    let promoted =
        promote_link_to_shared(&mut conn, link_id, OWNER, CONNECTOR, MAILBOX_EMAIL, None).await?;
    let mailbox_macro_id = format!("macro|{MAILBOX_EMAIL}");

    // Promotion marks the mailbox; a regular macro_id is not marked.
    assert!(is_promoted_shared_mailbox(&mut conn, &mailbox_macro_id).await?);
    assert!(!is_promoted_shared_mailbox(&mut conn, OWNER).await?);

    // Simulate the cascading link delete that precedes minted-user teardown, then tear down.
    sqlx::query!(r#"DELETE FROM email_links WHERE id = $1"#, link_id)
        .execute(&pool)
        .await?;
    // Teardown reports the minted id so callers can recognize (and remove) the mailbox's
    // FusionAuth stub, which relocation created under the same id.
    let deleted = delete_promoted_mailbox_user(&mut conn, &mailbox_macro_id).await?;
    assert_eq!(deleted, Some(promoted.mailbox_fusion_id));

    // The minted User, its macro_user, the marker, and both edges are gone.
    let user = sqlx::query!(r#"SELECT id FROM "User" WHERE id = $1"#, mailbox_macro_id)
        .fetch_optional(&pool)
        .await?;
    assert!(user.is_none(), "minted mailbox User must be removed");
    assert!(!is_promoted_shared_mailbox(&mut conn, &mailbox_macro_id).await?);
    assert!(
        crate::macro_user_links::get_primaries_for_child(&pool, &mailbox_macro_id)
            .await?
            .is_empty(),
        "delegation edges must be cascaded away"
    );

    Ok(())
}

const SHARED_OWNER: &str = "macro|owner@example.com";
const SHARED_CONNECTOR: &str = "macro|other@example.com";
const SHARED_LINK: Uuid = Uuid::from_u128(0x30000000000000000000000000000001);
const SHARED_THREAD: Uuid = Uuid::from_u128(0x20000000000000000000000000000004);
const SECOND_THREAD: Uuid = Uuid::from_u128(0x20000000000000000000000000000007);
const OTHER_THREAD: Uuid = Uuid::from_u128(0x20000000000000000000000000000008);
const UNSHARED_THREAD: Uuid = Uuid::from_u128(0x20000000000000000000000000000009);

async fn setup_thread_shares(pool: &Pool<Postgres>) {
    let other_link = insert_data_source_link(pool, SHARED_OWNER, "other-inbox@example.com").await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2), ($3, $4), ($5, $2)",
        SECOND_THREAD,
        SHARED_LINK,
        OTHER_THREAD,
        other_link,
        UNSHARED_THREAD,
    )
    .execute(tx.as_mut())
    .await
    .unwrap();
    for (id, level) in [
        (SHARED_THREAD, AccessLevel::Edit),
        (SECOND_THREAD, AccessLevel::Comment),
        (OTHER_THREAD, AccessLevel::View),
    ] {
        let facts = load_facts(
            &mut tx,
            &EntityType::EmailThread.with_entity_string(id.to_string()),
        )
        .await
        .unwrap();
        let command = authorize_team_share(
            Some(&facts.owner),
            &facts,
            TeamShareRequest {
                access_level: Some(Some(level)),
                legacy_enabled: None,
            },
            TeamShareLevel::View,
        )
        .unwrap()
        .unwrap();
        apply(&mut tx, &command).await.unwrap();
    }
    // These independent contributions must survive promotion, including an untracked team.
    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES
            ($1, 'email_thread', 'macro|other@example.com', 'user', 'edit', NULL),
            ($1, 'email_thread', '40000000-0000-0000-0000-000000000001', 'channel', 'view', NULL),
            ($1, 'email_thread', '10000000-0000-0000-0000-000000000001', 'team', 'comment', '20000000-0000-0000-0000-000000000001'),
            ($1, 'email_thread', '10000000-0000-0000-0000-000000000002', 'team', 'view', NULL)"#,
        SHARED_THREAD,
    )
    .execute(tx.as_mut())
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

#[derive(Debug, PartialEq, Eq)]
struct ThreadGrant {
    id: i64,
    source_id: String,
    source_type: String,
    level: String,
    granted_from_project_id: Option<String>,
}

async fn thread_grants(pool: &Pool<Postgres>) -> Vec<ThreadGrant> {
    sqlx::query_as!(
        ThreadGrant,
        r#"SELECT id, source_id, source_type::text AS "source_type!", access_level::text AS "level!", granted_from_project_id
        FROM entity_access WHERE entity_type = 'email_thread' ORDER BY id"#
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[sqlx::test(fixtures(
    path = "../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn promotion_clears_only_rehomed_threads_explicit_team_shares(pool: Pool<Postgres>) {
    setup_thread_shares(&pool).await;
    let grants = thread_grants(&pool).await;
    crate::macro_user_links::insert_edge(&pool, SHARED_CONNECTOR, SHARED_OWNER, SHARED_LINK)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let other = EntityType::EmailThread.with_entity_string(OTHER_THREAD.to_string());
    let other_before = load_facts(&mut tx, &other).await.unwrap();
    let promoted = promote_link_to_shared(
        &mut tx,
        SHARED_LINK,
        SHARED_OWNER,
        SHARED_CONNECTOR,
        "alias@example.com",
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    for id in [SHARED_THREAD, SECOND_THREAD] {
        let facts = load_facts(
            &mut tx,
            &EntityType::EmailThread.with_entity_string(id.to_string()),
        )
        .await
        .unwrap();
        assert_eq!(facts.owner.as_ref(), promoted.mailbox_macro_id);
        assert_eq!(
            facts.current, None,
            "original owner's team must not follow the mailbox"
        );
        assert_eq!(facts.revision, 2);
    }
    assert_eq!(load_facts(&mut tx, &other).await.unwrap(), other_before);
    let unshared = load_facts(
        &mut tx,
        &EntityType::EmailThread.with_entity_string(UNSHARED_THREAD.to_string()),
    )
    .await
    .unwrap();
    assert_eq!(unshared.current, None);
    assert_eq!(unshared.revision, 0);
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM "EmailThreadPermission" WHERE "threadId" = $1"#,
            UNSHARED_THREAD.to_string()
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap(),
        Some(0)
    );
    tx.commit().await.unwrap();

    let after = thread_grants(&pool).await;
    let removed: Vec<_> = grants
        .iter()
        .filter(|grant| !after.contains(grant))
        .collect();
    assert_eq!(removed.len(), 2);
    assert!(removed.iter().all(
        |grant| grant.source_id == "10000000-0000-0000-0000-000000000001"
            && grant.source_type == "team"
            && grant.granted_from_project_id.is_none()
    ));
    assert_eq!(after.len(), grants.len() - 2);
    let mut delegates =
        crate::macro_user_links::get_primaries_for_child(&pool, &promoted.mailbox_macro_id)
            .await
            .unwrap();
    delegates.sort();
    assert_eq!(delegates, vec![SHARED_CONNECTOR, SHARED_OWNER]);
    assert!(
        crate::macro_user_links::edge_exists(&pool, SHARED_CONNECTOR, SHARED_OWNER, SHARED_LINK)
            .await
            .unwrap()
    );
}

#[sqlx::test(fixtures(
    path = "../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn failed_promotion_restores_canonical_state_and_grants(pool: Pool<Postgres>) {
    setup_thread_shares(&pool).await;
    let grants = thread_grants(&pool).await;
    let entity = EntityType::EmailThread.with_entity_string(SHARED_THREAD.to_string());
    let mut tx = pool.begin().await.unwrap();
    let before = load_facts(&mut tx, &entity).await.unwrap();
    tx.commit().await.unwrap();
    // Edge insertion happens after sharing cleanup and the ownership update.
    sqlx::raw_sql(
        r#"CREATE FUNCTION reject_promotion_edge() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM "SharePermission" sp
                JOIN "EmailThreadPermission" tp ON tp."sharePermissionId" = sp.id
                JOIN email_threads t ON t.id::text = tp."threadId"
                WHERE t.link_id = NEW.link_id AND sp.team_share_access_level IS NOT NULL
            ) THEN
                RAISE EXCEPTION 'sharing was not cleared';
            END IF;
            RAISE EXCEPTION 'injected edge failure';
        END $$;
        CREATE TRIGGER reject_promotion_edge BEFORE INSERT ON macro_user_links
        FOR EACH ROW EXECUTE FUNCTION reject_promotion_edge();"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let error = promote_link_to_shared(
        &mut tx,
        SHARED_LINK,
        SHARED_OWNER,
        SHARED_CONNECTOR,
        "alias@example.com",
        None,
    )
    .await
    .err()
    .expect("edge insertion must fail");
    assert!(
        error.to_string().contains("injected edge failure"),
        "{error}"
    );
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(load_facts(&mut tx, &entity).await.unwrap(), before);
    tx.commit().await.unwrap();
    assert_eq!(thread_grants(&pool).await, grants);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT macro_id FROM email_links WHERE id = $1",
            SHARED_LINK
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        SHARED_OWNER
    );
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = 'macro|alias@example.com')"#
        )
        .fetch_one(&pool)
        .await
        .unwrap()
        .unwrap()
    );
}

#[sqlx::test(fixtures(
    path = "../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn caller_rollback_restores_thread_sharing_after_successful_promotion(pool: Pool<Postgres>) {
    setup_thread_shares(&pool).await;
    let grants = thread_grants(&pool).await;
    let entity = EntityType::EmailThread.with_entity_string(SHARED_THREAD.to_string());
    let mut tx = pool.begin().await.unwrap();
    let before = load_facts(&mut tx, &entity).await.unwrap();
    promote_link_to_shared(
        &mut tx,
        SHARED_LINK,
        SHARED_OWNER,
        SHARED_CONNECTOR,
        "alias@example.com",
        None,
    )
    .await
    .unwrap();
    assert_eq!(load_facts(&mut tx, &entity).await.unwrap().current, None);
    tx.rollback().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert_eq!(load_facts(&mut tx, &entity).await.unwrap(), before);
    tx.commit().await.unwrap();
    assert_eq!(thread_grants(&pool).await, grants);
}

#[sqlx::test(fixtures(
    path = "../../../share_permission_db_utils/fixtures",
    scripts("team_share")
))]
async fn promotion_waits_for_common_guard_before_writing(pool: Pool<Postgres>) {
    setup_thread_shares(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    share_permission_db_utils::team_share::acquire_guard(&mut tx)
        .await
        .unwrap();
    let other_pool = pool.clone();
    let promotion = tokio::spawn(async move {
        let mut conn = other_pool.acquire().await.unwrap();
        promote_link_to_shared(
            &mut conn,
            SHARED_LINK,
            SHARED_OWNER,
            SHARED_CONNECTOR,
            "alias@example.com",
            None,
        )
        .await
        .unwrap();
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))"
            ).fetch_one(tx.as_mut()).await.unwrap();
            if waiting == Some(true) {
                break;
            }
            assert!(!promotion.is_finished(), "promotion bypassed the guard");
            tokio::task::yield_now().await;
        }
    }).await.unwrap();
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM "User" WHERE id = 'macro|alias@example.com')"#
        )
        .fetch_one(tx.as_mut())
        .await
        .unwrap()
        .unwrap()
    );
    // A share committed while promotion waits must be seen and cleared, not carried forward.
    let entity = EntityType::EmailThread.with_entity_string(UNSHARED_THREAD.to_string());
    let facts = load_facts(&mut tx, &entity).await.unwrap();
    let command = authorize_team_share(
        Some(&facts.owner),
        &facts,
        TeamShareRequest {
            access_level: Some(Some(AccessLevel::View)),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    apply(&mut tx, &command).await.unwrap();
    tx.commit().await.unwrap();
    promotion.await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    let facts = load_facts(&mut tx, &entity).await.unwrap();
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 2);
    assert_eq!(facts.owner.as_ref(), "macro|alias@example.com");
}

#[sqlx::test]
async fn delete_promoted_mailbox_user_is_noop_for_real_account(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // OWNER is a real account, not a promoted mailbox — teardown must never delete it.
    insert_user(&pool, OWNER, "alice@company.test").await;

    let mut conn = pool.acquire().await?;
    let deleted = delete_promoted_mailbox_user(&mut conn, OWNER).await?;
    assert_eq!(deleted, None, "no-op must report that nothing was deleted");

    let user = sqlx::query!(r#"SELECT id FROM "User" WHERE id = $1"#, OWNER)
        .fetch_optional(&pool)
        .await?;
    assert!(user.is_some(), "a real account must not be torn down");

    Ok(())
}
