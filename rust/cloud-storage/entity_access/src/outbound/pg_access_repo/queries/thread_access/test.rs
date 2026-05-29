#[allow(unused_imports)]
use super::*;
use crate::domain::models::AccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@corp.test";
const REQUESTER: &str = "macro|requester@corp.test";
const OTHER: &str = "macro|other@corp.test";

fn user(s: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(s.to_string()).unwrap()
}

/// Runs `get_thread_access` as `REQUESTER` (authenticated, so the unauthenticated
/// share-only branch is skipped).
async fn access_as_requester(pool: &PgPool, thread_id: &Uuid) -> Option<AccessLevel> {
    let requester = user(REQUESTER);
    let source_ids = SourceIds(vec![REQUESTER.to_string()]);
    get_thread_access(pool, thread_id, &source_ids, Some(&*requester))
        .await
        .unwrap()
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// macro_user + "User" rows so team / team_user FKs resolve.
async fn insert_user(pool: &PgPool, user_id: &str, email: &str) {
    let macro_uuid = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, $2, $3, $4)"#,
        macro_uuid,
        user_id,
        email,
        user_id,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user_id,
        email,
        macro_uuid,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A team row only (no CRM settings). `owner_user_id` must already exist in "User".
async fn insert_team_row(pool: &PgPool, team_id: Uuid, owner_user_id: &str) {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Test Team', $2)"#,
        team_id,
        owner_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_crm_settings(pool: &PgPool, team_id: Uuid, crm_enabled: bool) {
    sqlx::query!(
        r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, $2)"#,
        team_id,
        crm_enabled,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A team plus its CRM settings row.
async fn insert_team(pool: &PgPool, team_id: Uuid, owner_user_id: &str, crm_enabled: bool) {
    insert_team_row(pool, team_id, owner_user_id).await;
    insert_crm_settings(pool, team_id, crm_enabled).await;
}

async fn add_team_member(pool: &PgPool, team_id: Uuid, user_id: &str) {
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        user_id,
        team_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_entity_access(pool: &PgPool, thread_id: Uuid, source_id: &str, level: AccessLevel) {
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

async fn insert_email_contact(pool: &PgPool, link_id: Uuid, email: &str) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)"#,
        id,
        link_id,
        email,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

/// An empty link + thread owned by `owner_macro_id`. Returns `(link_id, thread_id)`.
async fn create_link_and_thread(pool: &PgPool, owner_macro_id: &str) -> (Uuid, Uuid) {
    let link_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();

    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $2, $3, 'GMAIL')"#,
        link_id,
        owner_macro_id,
        format!("{owner_macro_id}@mail.test"),
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

/// Adds one message to a thread: `from_email` as sender and each
/// `(email, "TO"|"CC"|"BCC")` as a recipient. Contacts are created under `link_id`.
async fn add_message(
    pool: &PgPool,
    link_id: Uuid,
    thread_id: Uuid,
    from_email: &str,
    recipients: &[(&str, &str)],
) {
    let message_id = Uuid::new_v4();
    let from_contact = insert_email_contact(pool, link_id, from_email).await;

    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, from_contact_id)
           VALUES ($1, $2, $3, $4)"#,
        message_id,
        thread_id,
        link_id,
        from_contact,
    )
    .execute(pool)
    .await
    .unwrap();

    for (email, rtype) in recipients {
        let contact_id = insert_email_contact(pool, link_id, email).await;
        sqlx::query!(
            r#"INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
               VALUES ($1, $2, $3::text::email_recipient_type)"#,
            message_id,
            contact_id,
            rtype,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

/// Convenience: link + thread + a single message. Returns thread id.
async fn create_thread(
    pool: &PgPool,
    owner_macro_id: &str,
    from_email: &str,
    recipients: &[(&str, &str)],
) -> Uuid {
    let (link_id, thread_id) = create_link_and_thread(pool, owner_macro_id).await;
    add_message(pool, link_id, thread_id, from_email, recipients).await;
    thread_id
}

async fn insert_crm_company(pool: &PgPool, team_id: Uuid, email_sync: bool, hidden: bool) -> Uuid {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO crm_companies (id, team_id, email_sync, hidden, first_interaction, last_interaction)
           VALUES ($1, $2, $3, $4, now(), now())"#,
        id,
        team_id,
        email_sync,
        hidden,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

/// `email` must be lowercase — the query matches `crm_contacts.email` against the
/// lowercased participant address (emails are stored lowercased in prod).
async fn insert_crm_contact(pool: &PgPool, company_id: Uuid, email: &str, hidden: bool) {
    sqlx::query!(
        r#"INSERT INTO crm_contacts (company_id, email, hidden, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
        company_id,
        email,
        hidden,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// OWNER + REQUESTER on the same team (with a CRM settings row).
async fn setup_shared_team(pool: &PgPool, crm_enabled: bool) -> Uuid {
    let team_id = Uuid::new_v4();
    insert_user(pool, OWNER, "owner@corp.test").await;
    insert_user(pool, REQUESTER, "requester@corp.test").await;
    insert_team(pool, team_id, OWNER, crm_enabled).await;
    add_team_member(pool, team_id, OWNER).await;
    add_team_member(pool, team_id, REQUESTER).await;
    team_id
}

/// Synced CRM team + thread where every participant resolves to a non-hidden
/// contact in a synced+visible company, EXCEPT `unsynced`, which gets no CRM
/// contact. Used to prove each address slot (from/to/cc/bcc) is enforced.
async fn access_with_one_unsynced(
    pool: &PgPool,
    from_email: &str,
    recipients: &[(&str, &str)],
    unsynced: &str,
) -> Option<AccessLevel> {
    let team_id = setup_shared_team(pool, true).await;
    let thread_id = create_thread(pool, OWNER, from_email, recipients).await;
    let company = insert_crm_company(pool, team_id, true, false).await;

    let mut all = vec![from_email];
    all.extend(recipients.iter().map(|(e, _)| *e));
    for email in all {
        if email != unsynced {
            insert_crm_contact(pool, company, email, false).await;
        }
    }

    access_as_requester(pool, &thread_id).await
}

// ---------------------------------------------------------------------------
// Owner / existence
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_gets_owner_access(pool: PgPool) -> anyhow::Result<()> {
    // Requester owns the thread (link.macro_id == requester) — short-circuits to
    // Owner before any team/CRM logic.
    insert_user(&pool, REQUESTER, "requester@corp.test").await;
    let thread_id = create_thread(
        &pool,
        REQUESTER,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Owner)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn owner_access_wins_even_when_crm_would_deny(pool: PgPool) -> anyhow::Result<()> {
    // Requester is the thread owner AND on a CRM team whose only participant is
    // hidden (CRM path would deny). The owner short-circuit must still win.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, REQUESTER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, true).await; // hidden company
    insert_crm_contact(&pool, company, "alice@client.test", true).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Owner)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn returns_none_when_thread_does_not_exist(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, REQUESTER, "requester@corp.test").await;

    assert_eq!(access_as_requester(&pool, &Uuid::new_v4()).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unauthenticated_user_never_gets_crm_access(pool: PgPool) -> anyhow::Result<()> {
    // Even a fully-synced thread is invisible to an unauthenticated caller: with
    // no user_id there are no source_ids, so the share-only branch returns before
    // the CRM path runs.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;

    let source_ids = SourceIds(vec![]);
    let result = get_thread_access(&pool, &thread_id, &source_ids, None).await?;

    assert_eq!(result, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_comment_when_teammate_and_all_participants_synced(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Participants span TWO synced+visible companies and cover from/to/cc/bcc,
    // proving every recipient type is checked and multi-company resolution works.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "alice@client.test",
        &[
            ("bob@client.test", "TO"),
            ("carol@vendor.test", "CC"),
            ("dave@vendor.test", "BCC"),
        ],
    )
    .await;

    let client = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, client, "alice@client.test", false).await;
    insert_crm_contact(&pool, client, "bob@client.test", false).await;

    let vendor = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, vendor, "carol@vendor.test", false).await;
    insert_crm_contact(&pool, vendor, "dave@vendor.test", false).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_when_synced_participants_span_multiple_messages(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Participants introduced across two messages must all be collected.
    let team_id = setup_shared_team(&pool, true).await;
    let (link_id, thread_id) = create_link_and_thread(&pool, OWNER).await;
    add_message(
        &pool,
        link_id,
        thread_id,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;
    add_message(
        &pool,
        link_id,
        thread_id,
        "carol@client.test",
        &[("dave@client.test", "CC")],
    )
    .await;

    let company = insert_crm_company(&pool, team_id, true, false).await;
    for email in [
        "alice@client.test",
        "bob@client.test",
        "carol@client.test",
        "dave@client.test",
    ] {
        insert_crm_contact(&pool, company, email, false).await;
    }

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_when_participant_has_qualifying_mapping_despite_hidden_duplicate(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Same address resolves to two contacts in the team: one hidden, one valid.
    // The existence semantics grant as long as a qualifying mapping exists.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;

    let hidden_company = insert_crm_company(&pool, team_id, true, true).await;
    insert_crm_contact(&pool, hidden_company, "alice@client.test", true).await;

    let good_company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, good_company, "alice@client.test", false).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_with_mixed_case_participant_address(pool: PgPool) -> anyhow::Result<()> {
    // Participant address is mixed-case; the CRM contact is lowercased. The
    // query lowercases the participant side, so it still matches.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "Alice@Client.TEST", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Combination with the share-permission / entity_access source
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_comment_combines_with_lower_entity_access_view(pool: PgPool) -> anyhow::Result<()> {
    // entity_access grants View, CRM grants Comment → max is Comment.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;
    insert_entity_access(&pool, thread_id, REQUESTER, AccessLevel::View).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn higher_entity_access_edit_wins_over_crm_comment(pool: PgPool) -> anyhow::Result<()> {
    // entity_access grants Edit, CRM grants Comment → max is Edit.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;
    insert_entity_access(&pool, thread_id, REQUESTER, AccessLevel::Edit).await;

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Edit)
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Team / CRM-enabled gating
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_requester_not_on_owners_team(pool: PgPool) -> anyhow::Result<()> {
    // Owner on team A, requester on team B (both CRM-enabled). No shared team.
    insert_user(&pool, OWNER, "owner@corp.test").await;
    insert_user(&pool, REQUESTER, "requester@corp.test").await;

    let team_a = Uuid::new_v4();
    insert_team(&pool, team_a, OWNER, true).await;
    add_team_member(&pool, team_a, OWNER).await;

    let team_b = Uuid::new_v4();
    insert_team(&pool, team_b, REQUESTER, true).await;
    add_team_member(&pool, team_b, REQUESTER).await;

    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_a, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_crm_disabled_for_team(pool: PgPool) -> anyhow::Result<()> {
    let team_id = setup_shared_team(&pool, false).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_team_crm_settings_row_missing(pool: PgPool) -> anyhow::Result<()> {
    // No team_crm_settings row at all — treated as disabled (the JOIN finds nothing).
    let team_id = Uuid::new_v4();
    insert_user(&pool, OWNER, "owner@corp.test").await;
    insert_user(&pool, REQUESTER, "requester@corp.test").await;
    insert_team_row(&pool, team_id, OWNER).await;
    add_team_member(&pool, team_id, OWNER).await;
    add_team_member(&pool, team_id, REQUESTER).await;

    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_contact_belongs_to_a_different_teams_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    // alice resolves to a contact, but only under a company owned by a team the
    // requester is not on. The shared team has no mapping for her → deny.
    // Shared CRM-enabled team for owner + requester, but it has no alice contact.
    let _shared_team = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(&pool, OWNER, "alice@client.test", &[]).await;

    insert_user(&pool, OTHER, "other@corp.test").await;
    let other_team = Uuid::new_v4();
    insert_team(&pool, other_team, OTHER, true).await;
    let other_company = insert_crm_company(&pool, other_team, true, false).await;
    insert_crm_contact(&pool, other_company, "alice@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Per-company / per-contact CRM gating (C + D), using a TO recipient
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_company_has_email_sync_off(pool: PgPool) -> anyhow::Result<()> {
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;

    let synced = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, synced, "alice@client.test", false).await;

    let unsynced = insert_crm_company(&pool, team_id, false, false).await;
    insert_crm_contact(&pool, unsynced, "bob@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_company_is_hidden(pool: PgPool) -> anyhow::Result<()> {
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;

    let visible = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, visible, "alice@client.test", false).await;

    let hidden_company = insert_crm_company(&pool, team_id, true, true).await;
    insert_crm_contact(&pool, hidden_company, "bob@client.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_contact_is_hidden(pool: PgPool) -> anyhow::Result<()> {
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;

    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;
    // bob's contact is hidden even though the company is synced + visible.
    insert_crm_contact(&pool, company, "bob@client.test", true).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Strict: an unsynced participant in ANY address slot denies access
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_the_from_sender_is_unsynced(pool: PgPool) -> anyhow::Result<()> {
    let result = access_with_one_unsynced(
        &pool,
        "alice@client.test",
        &[("bob@client.test", "TO")],
        "alice@client.test",
    )
    .await;
    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_to_participant_is_unsynced(pool: PgPool) -> anyhow::Result<()> {
    let result = access_with_one_unsynced(
        &pool,
        "alice@client.test",
        &[("bob@client.test", "TO")],
        "bob@client.test",
    )
    .await;
    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_cc_participant_is_unsynced(pool: PgPool) -> anyhow::Result<()> {
    let result = access_with_one_unsynced(
        &pool,
        "alice@client.test",
        &[("bob@client.test", "CC")],
        "bob@client.test",
    )
    .await;
    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_a_bcc_participant_is_unsynced(pool: PgPool) -> anyhow::Result<()> {
    let result = access_with_one_unsynced(
        &pool,
        "alice@client.test",
        &[("bob@client.test", "BCC")],
        "bob@client.test",
    )
    .await;
    assert_eq!(result, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_unsynced_participant_in_a_later_message(pool: PgPool) -> anyhow::Result<()> {
    // First message is fully synced; a second message introduces an unsynced
    // participant. Strict deny must still apply.
    let team_id = setup_shared_team(&pool, true).await;
    let (link_id, thread_id) = create_link_and_thread(&pool, OWNER).await;
    add_message(
        &pool,
        link_id,
        thread_id,
        "alice@client.test",
        &[("bob@client.test", "TO")],
    )
    .await;
    add_message(
        &pool,
        link_id,
        thread_id,
        "carol@client.test",
        &[("zed@unknown.test", "CC")],
    )
    .await;

    let company = insert_crm_company(&pool, team_id, true, false).await;
    for email in ["alice@client.test", "bob@client.test", "carol@client.test"] {
        insert_crm_contact(&pool, company, email, false).await;
    }
    // zed@unknown.test intentionally absent from CRM.

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}

// ---------------------------------------------------------------------------
// Requester's own domain is exempt from the CRM-contact requirement
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grants_when_only_unsynced_participant_is_on_requesters_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    // A colleague on the requester's own domain (corp.test) is a participant but
    // has no CRM contact. Internal addresses are exempt, so the external
    // participant (alice) being synced is enough to grant.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "alice@client.test",
        &[("colleague@corp.test", "TO")],
    )
    .await;

    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "alice@client.test", false).await;
    // colleague@corp.test intentionally has no CRM contact.

    assert_eq!(
        access_as_requester(&pool, &thread_id).await,
        Some(AccessLevel::Comment)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn denies_when_every_participant_is_on_requesters_domain(pool: PgPool) -> anyhow::Result<()> {
    // Purely-internal thread: all participants share the requester's domain, so
    // there's no external participant to anchor CRM access. Deny even though the
    // internal addresses would be exempt from the contact check.
    let team_id = setup_shared_team(&pool, true).await;
    let thread_id = create_thread(
        &pool,
        OWNER,
        "boss@corp.test",
        &[("colleague@corp.test", "TO")],
    )
    .await;

    // Even with a qualifying contact for an internal address, the absence of any
    // external participant must deny.
    let company = insert_crm_company(&pool, team_id, true, false).await;
    insert_crm_contact(&pool, company, "boss@corp.test", false).await;

    assert_eq!(access_as_requester(&pool, &thread_id).await, None);
    Ok(())
}
