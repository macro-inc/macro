use super::*;
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
