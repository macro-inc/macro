use crate::links::get::{
    fetch_inbox_details_for_macro_id, fetch_inboxes_for_macro_id, fetch_link_by_email,
    fetch_link_by_macro_id_and_email_address, fetch_owned_link_for_message,
    fetch_owned_link_for_thread,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::email::db;
use models_email::service::backfill::BackfillJobStatus;
use models_email::service::link::UserProvider;
use sqlx::types::Uuid;
use sqlx::{Pool, Postgres};

const CHILD: &str = "macro|sharedbox@corp.test"; // owns the inbox
const PRIMARY: &str = "macro|primary@corp.test"; // delegate
const STRANGER: &str = "macro|stranger@corp.test"; // no relationship

fn macro_id(s: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::try_from(s).unwrap()
}

/// macro_user + "User" rows so macro_user_links FKs resolve.
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

/// A link owned by `macro_id` with one thread and one message on it.
/// Returns `(link_id, thread_id, message_id)`.
async fn insert_inbox_with_thread_and_message(
    pool: &Pool<Postgres>,
    macro_id: &str,
    email: &str,
) -> (Uuid, Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let contact_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();

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

    sqlx::query!(
        r#"INSERT INTO email_threads (id, link_id) VALUES ($1, $2)"#,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)"#,
        contact_id,
        link_id,
        "sender@external.test",
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id)
           VALUES ($1, $2, $3, $4)"#,
        message_id,
        thread_id,
        link_id,
        contact_id,
    )
    .execute(pool)
    .await
    .unwrap();

    (link_id, thread_id, message_id)
}

async fn insert_settings(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    signature_on_replies_forwards: bool,
    signature: Option<&str>,
) {
    sqlx::query!(
        r#"INSERT INTO email_settings (link_id, signature_on_replies_forwards, signature)
           VALUES ($1, $2, $3)"#,
        link_id,
        signature_on_replies_forwards,
        signature,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A backfill job created `age_minutes` ago, so tests can control which job is latest.
async fn insert_backfill_job(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    macro_id: &str,
    status: db::backfill::BackfillJobStatus,
    age_minutes: i32,
) {
    sqlx::query!(
        r#"INSERT INTO email_backfill_jobs (id, link_id, fusionauth_user_id, status, created_at)
           VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5))"#,
        Uuid::new_v4(),
        link_id,
        macro_id,
        status as _,
        age_minutes,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Backdates a link so tests can control the newest-first ordering.
async fn age_link(pool: &Pool<Postgres>, link_id: Uuid, age_minutes: i32) {
    sqlx::query!(
        r#"UPDATE email_links SET created_at = now() - make_interval(mins => $2) WHERE id = $1"#,
        link_id,
        age_minutes,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_contact_with_photo(
    pool: &Pool<Postgres>,
    link_id: Uuid,
    email: &str,
    sfs_photo_url: Option<&str>,
) {
    sqlx::query!(
        r#"INSERT INTO email_contacts (id, link_id, email_address, sfs_photo_url)
           VALUES ($1, $2, $3, $4)"#,
        Uuid::new_v4(),
        link_id,
        email,
        sfs_photo_url,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_delegation(pool: &Pool<Postgres>, primary: &str, child: &str, link_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        primary,
        child,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_inbox_for_owner_and_delegate(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    let (link_id, thread_id, message_id) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_delegation(&pool, PRIMARY, CHILD, link_id).await;

    // Delegate resolves the shared inbox from both thread and message.
    assert_eq!(
        fetch_owned_link_for_thread(&pool, PRIMARY, thread_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );
    assert_eq!(
        fetch_owned_link_for_message(&pool, PRIMARY, message_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );

    // Owner still resolves their own inbox.
    assert_eq!(
        fetch_owned_link_for_thread(&pool, CHILD, thread_id)
            .await?
            .map(|l| l.id),
        Some(link_id)
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_nothing_for_unrelated_caller(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    insert_user(&pool, STRANGER, "stranger@corp.test").await;
    let (link_id, thread_id, message_id) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_delegation(&pool, PRIMARY, CHILD, link_id).await;

    // STRANGER is a real user who neither owns nor is delegated the inbox.
    assert!(
        fetch_owned_link_for_thread(&pool, STRANGER, thread_id)
            .await?
            .is_none()
    );
    assert!(
        fetch_owned_link_for_message(&pool, STRANGER, message_id)
            .await?
            .is_none()
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scoped_delegation_sees_only_its_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    let (link_a, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_delegation(&pool, PRIMARY, CHILD, link_a).await;

    // The child connects a second inbox after the grant; the scoped delegate
    // must not see it.
    let (link_b, thread_b, message_b) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "second@corp.test").await;

    let inbox_ids: Vec<Uuid> = fetch_inboxes_for_macro_id(&pool, PRIMARY)
        .await?
        .into_iter()
        .map(|l| l.id)
        .collect();
    assert_eq!(inbox_ids, vec![link_a]);

    assert!(
        fetch_owned_link_for_thread(&pool, PRIMARY, thread_b)
            .await?
            .is_none()
    );
    assert!(
        fetch_owned_link_for_message(&pool, PRIMARY, message_b)
            .await?
            .is_none()
    );

    // The child still owns both inboxes.
    let mut child_inboxes: Vec<Uuid> = fetch_inboxes_for_macro_id(&pool, CHILD)
        .await?
        .into_iter()
        .map(|l| l.id)
        .collect();
    child_inboxes.sort();
    let mut expected = vec![link_a, link_b];
    expected.sort();
    assert_eq!(child_inboxes, expected);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_joins_settings_backfill_and_photo(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_settings(&pool, link_id, true, Some("<p>sig</p>")).await;

    // Older Complete job then a newer Failed one — the latest wins.
    insert_backfill_job(
        &pool,
        link_id,
        CHILD,
        db::backfill::BackfillJobStatus::Complete,
        60,
    )
    .await;
    insert_backfill_job(
        &pool,
        link_id,
        CHILD,
        db::backfill::BackfillJobStatus::Failed,
        0,
    )
    .await;

    // The self-contact carries the inbox photo and must match case-insensitively;
    // the helper's unrelated sender contact must not bleed in.
    insert_contact_with_photo(
        &pool,
        link_id,
        "SharedBox@Corp.Test",
        Some("https://sfs/photo.png"),
    )
    .await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), 1);
    let inbox = &details[0];
    assert_eq!(inbox.link.id, link_id);
    assert!(inbox.settings.signature_on_replies_forwards);
    assert_eq!(inbox.settings.signature.as_deref(), Some("<p>sig</p>"));
    assert_eq!(
        inbox.latest_backfill_status,
        Some(BackfillJobStatus::Failed)
    );
    assert_eq!(inbox.photo_url.as_deref(), Some("https://sfs/photo.png"));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_includes_delegated_inbox_with_optional_fields_absent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_settings(&pool, link_id, false, None).await;
    insert_delegation(&pool, PRIMARY, CHILD, link_id).await;

    // No backfill jobs and no self-contact — the delegate still sees the inbox,
    // with the optional details absent.
    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(PRIMARY)).await?;
    assert_eq!(details.len(), 1);
    let inbox = &details[0];
    assert_eq!(inbox.link.id, link_id);
    assert!(!inbox.settings.signature_on_replies_forwards);
    assert!(inbox.settings.signature.is_none());
    assert!(inbox.latest_backfill_status.is_none());
    assert!(inbox.photo_url.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_orders_newest_first_and_pairs_rows_per_inbox(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    let (link_a, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    age_link(&pool, link_a, 60).await;
    let (link_b, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "second@corp.test").await;

    insert_settings(&pool, link_a, true, Some("<p>sig-a</p>")).await;
    insert_settings(&pool, link_b, false, None).await;

    // Details must attach only to their own inbox: photo on A, backfill job on B.
    insert_contact_with_photo(
        &pool,
        link_a,
        "sharedbox@corp.test",
        Some("https://sfs/a.png"),
    )
    .await;
    insert_backfill_job(
        &pool,
        link_b,
        CHILD,
        db::backfill::BackfillJobStatus::InProgress,
        0,
    )
    .await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    let ids: Vec<Uuid> = details.iter().map(|d| d.link.id).collect();
    assert_eq!(ids, vec![link_b, link_a]);

    let (newer, older) = (&details[0], &details[1]);
    assert!(!newer.settings.signature_on_replies_forwards);
    assert!(newer.settings.signature.is_none());
    assert_eq!(
        newer.latest_backfill_status,
        Some(BackfillJobStatus::InProgress)
    );
    assert!(newer.photo_url.is_none());

    assert!(older.settings.signature_on_replies_forwards);
    assert_eq!(older.settings.signature.as_deref(), Some("<p>sig-a</p>"));
    assert!(older.latest_backfill_status.is_none());
    assert_eq!(older.photo_url.as_deref(), Some("https://sfs/a.png"));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_dedupes_inbox_that_is_both_owned_and_delegated(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, PRIMARY, "primary@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_settings(&pool, link_id, false, None).await;

    // CHILD owns the inbox AND appears as its delegate via macro_user_links
    // (the check constraint forbids self-rows, so the grant's child is another
    // user). Both UNION branches match and must collapse to one row.
    insert_delegation(&pool, CHILD, PRIMARY, link_id).await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), 1);
    assert_eq!(details[0].link.id, link_id);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_photo_ignores_matching_email_on_other_link(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_user(&pool, STRANGER, "stranger@corp.test").await;
    let (own_link, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_settings(&pool, own_link, false, None).await;

    // The inbox's address exists as a contact with a photo — but on someone
    // else's link, so it must not be picked up as the inbox photo.
    let (other_link, _, _) =
        insert_inbox_with_thread_and_message(&pool, STRANGER, "stranger@corp.test").await;
    insert_settings(&pool, other_link, false, None).await;
    insert_contact_with_photo(
        &pool,
        other_link,
        "sharedbox@corp.test",
        Some("https://sfs/other.png"),
    )
    .await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), 1);
    assert!(details[0].photo_url.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_photo_absent_when_self_contact_has_no_photo(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    insert_settings(&pool, link_id, false, None).await;

    // Self-contact row exists but has no SFS photo yet.
    insert_contact_with_photo(&pool, link_id, "sharedbox@corp.test", None).await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), 1);
    assert!(details[0].photo_url.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_maps_each_backfill_status(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;

    // One inbox per status — the uq_active_backfill_job_per_link index allows
    // only a single Init/InProgress job per link.
    let statuses = vec![
        (
            db::backfill::BackfillJobStatus::Init,
            BackfillJobStatus::Init,
        ),
        (
            db::backfill::BackfillJobStatus::InProgress,
            BackfillJobStatus::InProgress,
        ),
        (
            db::backfill::BackfillJobStatus::Complete,
            BackfillJobStatus::Complete,
        ),
        (
            db::backfill::BackfillJobStatus::Cancelled,
            BackfillJobStatus::Cancelled,
        ),
        (
            db::backfill::BackfillJobStatus::Failed,
            BackfillJobStatus::Failed,
        ),
    ];
    let mut expected_by_link = Vec::new();
    for (i, (db_status, expected)) in statuses.into_iter().enumerate() {
        let email = format!("inbox{i}@corp.test");
        let (link_id, _, _) = insert_inbox_with_thread_and_message(&pool, CHILD, &email).await;
        insert_settings(&pool, link_id, false, None).await;
        insert_backfill_job(&pool, link_id, CHILD, db_status, 0).await;
        expected_by_link.push((link_id, expected));
    }

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), expected_by_link.len());
    for (link_id, expected) in expected_by_link {
        let inbox = details.iter().find(|d| d.link.id == link_id).unwrap();
        assert_eq!(inbox.latest_backfill_status, Some(expected));
    }

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_empty_for_user_without_inboxes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;

    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert!(details.is_empty());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_inbox_details_defaults_settings_when_row_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;

    // A legacy link with no email_settings row must still be listed, with
    // default settings.
    let details = fetch_inbox_details_for_macro_id(&pool, &macro_id(CHILD)).await?;
    assert_eq!(details.len(), 1);
    let inbox = &details[0];
    assert_eq!(inbox.link.id, link_id);
    assert!(!inbox.settings.signature_on_replies_forwards);
    assert!(inbox.settings.signature.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_link_by_email_finds_link_owned_by_another_macro_user(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // A shared external mailbox connected by one macro user as a data-source link
    // (owner's macro_id, mailbox email). A second user connecting the same mailbox
    // discovers it across all macro_ids — the trigger for the 409 / shared-inbox promote.
    insert_user(&pool, CHILD, "support@external.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "support@external.test").await;

    let found = fetch_link_by_email(&pool, "support@external.test", UserProvider::Gmail).await?;
    assert_eq!(
        found.map(|l| (l.id, l.macro_id.as_ref().to_string())),
        Some((link_id, CHILD.to_string()))
    );

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_link_by_email_none_when_mailbox_unconnected(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // No link for this mailbox → connect takes the plain data-source path, no dedup.
    let found = fetch_link_by_email(&pool, "nobody@external.test", UserProvider::Gmail).await?;
    assert!(found.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_link_by_macro_id_and_email_address_picks_own_inbox_not_newest(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // A user with two inboxes under one macro_id. CRM backfill must resolve the
    // inbox that IS the user (address == the macro_id email), not the newest
    // link — which is what a plain macro_id lookup would return.
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;

    // Own inbox first...
    let (own_link, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "sharedbox@corp.test").await;
    // ...then a second, newer inbox on the same macro_id.
    let (other_link, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "other@corp.test").await;
    assert_ne!(own_link, other_link);

    let found =
        fetch_link_by_macro_id_and_email_address(&pool, CHILD, "sharedbox@corp.test").await?;
    assert_eq!(found.map(|l| l.id), Some(own_link));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_link_by_macro_id_and_email_address_is_case_insensitive(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // The macro_id email is always lowercased, but a stored email_address may
    // preserve its original casing — the match must still succeed.
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    let (link_id, _, _) =
        insert_inbox_with_thread_and_message(&pool, CHILD, "SharedBox@Corp.Test").await;

    let found =
        fetch_link_by_macro_id_and_email_address(&pool, CHILD, "sharedbox@corp.test").await?;
    assert_eq!(found.map(|l| l.id), Some(link_id));

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fetch_link_by_macro_id_and_email_address_none_when_no_match(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    // Macro_id has a link, but none whose address matches the macro_id email.
    insert_user(&pool, CHILD, "sharedbox@corp.test").await;
    insert_inbox_with_thread_and_message(&pool, CHILD, "delegated@corp.test").await;

    let found =
        fetch_link_by_macro_id_and_email_address(&pool, CHILD, "sharedbox@corp.test").await?;
    assert!(found.is_none());

    Ok(())
}
