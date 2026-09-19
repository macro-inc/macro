use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER_WITH_TEAM: &str = "macro|document-owner@team.test";
const OWNER_WITHOUT_TEAM: &str = "macro|document-owner@personal.test";

async fn insert_user(pool: &PgPool, user_id: &str) -> anyhow::Result<()> {
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $2)
        "#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $1, $2)
        "#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn add_owner_to_team(pool: &PgPool, owner: &str, team_id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO team (id, name, owner_id)
        VALUES ($1, 'Document Owner Team', $2)
        "#,
        team_id,
        owner,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'owner')
        "#,
        owner,
        team_id,
    )
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_link_shared_document(
    pool: &PgPool,
    owner: &str,
    link_share: Option<&str>,
    link_share_access_level: Option<&str>,
) -> anyhow::Result<Uuid> {
    let document_id = Uuid::new_v4();
    let document_id_string = document_id.to_string();
    let share_permission_id = Uuid::new_v4().to_string();

    sqlx::query!(
        r#"
        INSERT INTO "Document" (id, name, owner)
        VALUES ($1, 'Link Shared Document', $2)
        "#,
        document_id_string,
        owner,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "SharePermission" (
            id,
            "linkShare",
            "linkShareAccessLevel"
        )
        VALUES ($1, $2, $3::text::"AccessLevel")
        "#,
        share_permission_id,
        link_share,
        link_share_access_level,
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        r#"
        INSERT INTO "DocumentPermission" ("documentId", "sharePermissionId")
        VALUES ($1, $2)
        "#,
        document_id_string,
        share_permission_id,
    )
    .execute(pool)
    .await?;

    Ok(document_id)
}

async fn insert_document_entity_access(
    pool: &PgPool,
    document_id: Uuid,
    source_id: &str,
    access_level: AccessLevel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO entity_access (
            entity_id,
            entity_type,
            source_id,
            source_type,
            access_level
        )
        VALUES ($1, 'document', $2, 'user', $3::text::"AccessLevel")
        "#,
        document_id,
        source_id,
        access_level.to_string(),
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_allows_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), Some("view"))
            .await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![]), None).await?;

    assert_eq!(access, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn null_link_denies_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id = insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, None, None).await?;
    let source_ids = SourceIds(vec!["macro|requester@team.test".to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids, None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_allows_same_team_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("comment")).await?;
    let source_ids = SourceIds(vec![owner_team_id.to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids, None).await?;

    assert_eq!(access, Some(AccessLevel::Comment));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_other_team_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("comment")).await?;
    let source_ids = SourceIds(vec![Uuid::new_v4().to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids, None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    let owner_team_id = Uuid::new_v4();
    insert_user(&pool, OWNER_WITH_TEAM).await?;
    add_owner_to_team(&pool, OWNER_WITH_TEAM, owner_team_id).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITH_TEAM, Some("TEAM"), Some("edit")).await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![]), None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_link_denies_access_when_owner_has_no_team(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("TEAM"), Some("edit")).await?;
    let source_ids = SourceIds(vec![Uuid::new_v4().to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids, None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn public_link_requires_an_access_level(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), None).await?;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![]), None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_highest_link_or_explicit_access_level(pool: PgPool) -> anyhow::Result<()> {
    const REQUESTER: &str = "macro|requester@team.test";

    insert_user(&pool, OWNER_WITHOUT_TEAM).await?;
    let document_id =
        insert_link_shared_document(&pool, OWNER_WITHOUT_TEAM, Some("PUBLIC"), Some("comment"))
            .await?;
    insert_document_entity_access(&pool, document_id, REQUESTER, AccessLevel::Edit).await?;
    let source_ids = SourceIds(vec![REQUESTER.to_string()]);

    let access = get_document_access(&pool, &document_id, &source_ids, None).await?;

    assert_eq!(access, Some(AccessLevel::Edit));
    Ok(())
}

// ---------------------------------------------------------------------------
// Email-attachment documents: access inherited from the linked thread
// (inbox owner, macro_user_links delegation, or a thread-level grant)
// ---------------------------------------------------------------------------

const INBOX_OWNER: &str = "macro|inbox-owner@corp.test";
const DELEGATE: &str = "macro|delegate@corp.test";
const OTHER_USER: &str = "macro|other@corp.test";

fn user(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

/// Runs `get_document_access` as an authenticated `user_id` whose only source
/// id is itself, so any grant must come through a user-keyed arm.
async fn access_as(pool: &PgPool, document_id: &Uuid, user_id: &str) -> Option<AccessLevel> {
    let requester = user(user_id);
    let source_ids = SourceIds(vec![user_id.to_string()]);
    get_document_access(pool, document_id, &source_ids, Some(&*requester))
        .await
        .unwrap()
}

/// A bare "Document" row owned by `owner` — no share permission, and no
/// entity_access rows (unlike prod, where the owner gets one at creation), so
/// tests observe the email arm alone.
async fn insert_document(pool: &PgPool, owner: &str) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner) VALUES ($1, 'Email Attachment', $2)"#,
        document_id.to_string(),
        owner,
    )
    .execute(pool)
    .await
    .unwrap();
    document_id
}

/// An inbox link for `owner_macro_id` holding one thread with one message.
/// Returns `(link_id, thread_id)`.
async fn insert_link_and_thread(pool: &PgPool, owner_macro_id: &str) -> (Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        owner_macro_id,
        format!("{link_id}@mail.test"),
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

    (link_id, thread_id)
}

/// A message + attachment on `thread_id`, with the attachment linked to
/// `document_id` via document_email.
async fn attach_document_to_thread(
    pool: &PgPool,
    link_id: Uuid,
    thread_id: Uuid,
    document_id: Uuid,
) {
    let message_id = Uuid::new_v4();
    let attachment_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id) VALUES ($1, $2, $3)"#,
        message_id,
        thread_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type)
           VALUES ($1, $2, $3, 'report.pdf', 'application/pdf')"#,
        attachment_id,
        message_id,
        attachment_id.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO document_email (document_id, email_attachment_id) VALUES ($1, $2)"#,
        document_id.to_string(),
        attachment_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Inbox + thread + message + attachment linked to a fresh document owned by
/// `owner_macro_id`. Returns `(link_id, thread_id, document_id)`.
async fn insert_attachment_document(pool: &PgPool, owner_macro_id: &str) -> (Uuid, Uuid, Uuid) {
    let document_id = insert_document(pool, owner_macro_id).await;
    let (link_id, thread_id) = insert_link_and_thread(pool, owner_macro_id).await;
    attach_document_to_thread(pool, link_id, thread_id, document_id).await;
    (link_id, thread_id, document_id)
}

/// `primary_macro_id` is delegated `child_macro_id`'s `link_id` inbox.
async fn insert_delegation(
    pool: &PgPool,
    primary_macro_id: &str,
    child_macro_id: &str,
    link_id: Uuid,
) {
    sqlx::query!(
        r#"INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
           VALUES ($1, $2, $3)"#,
        primary_macro_id,
        child_macro_id,
        link_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_thread_entity_access(
    pool: &PgPool,
    thread_id: Uuid,
    source_id: &str,
    level: AccessLevel,
) {
    let level_str = level.to_string();
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'email_thread', $2, 'user', $3::text::"AccessLevel")"#,
        thread_id,
        source_id,
        level_str,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_delegate_gets_edit_on_attachment_document(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, DELEGATE).await?;
    let (link_id, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;
    insert_delegation(&pool, DELEGATE, INBOX_OWNER, link_id).await;

    assert_eq!(
        access_as(&pool, &document_id, DELEGATE).await,
        Some(AccessLevel::Edit)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_inbox_owner_gets_edit_without_entity_access_row(pool: PgPool) -> anyhow::Result<()> {
    // The owner normally holds an entity_access Owner row from document
    // creation; this proves the email arm alone also reaches them.
    insert_user(&pool, INBOX_OWNER).await?;
    let (_, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;

    assert_eq!(
        access_as(&pool, &document_id, INBOX_OWNER).await,
        Some(AccessLevel::Edit)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_thread_grant_gives_view_capped_below_thread_level(
    pool: PgPool,
) -> anyhow::Result<()> {
    // An Edit grant on the thread inherits as View on the attachment document.
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, OTHER_USER).await?;
    let (_, thread_id, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;
    insert_thread_entity_access(&pool, thread_id, OTHER_USER, AccessLevel::Edit).await;

    assert_eq!(
        access_as(&pool, &document_id, OTHER_USER).await,
        Some(AccessLevel::View)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_no_thread_relationship_denies_access(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, OTHER_USER).await?;
    let (_, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;

    assert_eq!(access_as(&pool, &document_id, OTHER_USER).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_delegation_on_another_link_denies_access(pool: PgPool) -> anyhow::Result<()> {
    // The delegate holds a grant on a different inbox of the same owner; the
    // link-scoped delegation must not reach this attachment.
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, DELEGATE).await?;
    let (_, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;
    let (other_link_id, _) = insert_link_and_thread(&pool, INBOX_OWNER).await;
    insert_delegation(&pool, DELEGATE, INBOX_OWNER, other_link_id).await;

    assert_eq!(access_as(&pool, &document_id, DELEGATE).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_any_linked_thread_grants_access(pool: PgPool) -> anyhow::Result<()> {
    // SHA dedupe links one document to attachments in several threads; access
    // to any one of them is enough.
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, DELEGATE).await?;
    let (_, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;
    let (second_link_id, second_thread_id) = insert_link_and_thread(&pool, INBOX_OWNER).await;
    attach_document_to_thread(&pool, second_link_id, second_thread_id, document_id).await;
    insert_delegation(&pool, DELEGATE, INBOX_OWNER, second_link_id).await;

    assert_eq!(
        access_as(&pool, &document_id, DELEGATE).await,
        Some(AccessLevel::Edit)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_arm_never_grants_anonymous_access(pool: PgPool) -> anyhow::Result<()> {
    // With no user the anonymous branch runs and consults only PUBLIC link
    // shares — the email relationship grants nothing.
    insert_user(&pool, INBOX_OWNER).await?;
    let (_, _, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;

    let access = get_document_access(&pool, &document_id, &SourceIds(vec![]), None).await?;

    assert_eq!(access, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_direct_document_grant_wins_over_inherited_view(pool: PgPool) -> anyhow::Result<()> {
    // Thread-grant inheritance contributes View; a direct document Edit grant
    // must win the max.
    insert_user(&pool, INBOX_OWNER).await?;
    insert_user(&pool, OTHER_USER).await?;
    let (_, thread_id, document_id) = insert_attachment_document(&pool, INBOX_OWNER).await;
    insert_thread_entity_access(&pool, thread_id, OTHER_USER, AccessLevel::View).await;
    insert_document_entity_access(&pool, document_id, OTHER_USER, AccessLevel::Edit).await?;

    assert_eq!(
        access_as(&pool, &document_id, OTHER_USER).await,
        Some(AccessLevel::Edit)
    );
    Ok(())
}
