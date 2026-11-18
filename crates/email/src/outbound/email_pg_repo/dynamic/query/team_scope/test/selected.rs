//! Exercise the real scalar, ingestion and inline Team predicates together.
//! The interaction address never matches an inclusion itself: its history is
//! shared only because another participant selected the whole thread.
use super::*;

const S_TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001);
const S_LINK: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0011);
const S_COPY_LINK: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0012);
const S_THREAD: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0021);
const S_COPY: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0022);
const S_CONTACT: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0042);
const S_COMPANY: Uuid = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0041);
const S_USER: &str = "macro|member@example.com";

async fn parity(pool: &sqlx::PgPool, expected: bool) -> anyhow::Result<()> {
    let scalar = sqlx::query_scalar!("SELECT crm_email_thread_allowed($1, $2)", S_TEAM, S_THREAD)
        .fetch_one(pool)
        .await?;
    assert_eq!(scalar, Some(expected), "scalar eligibility");

    let view = all_mail();
    let filter = any_direction("peer.example");
    let mut params = params(SimpleSortMethod::UpdatedAt);
    params.team_id = Some(S_TEAM);
    params.link_ids = vec![S_LINK];
    params.resolved = resolve_filters(pool, &[S_LINK], Some(S_TEAM), &filter).await?;
    let read = team_read(&view, &filter, params).unwrap();
    let mut builder = QueryBuilder::new("");
    read.push_ctes(&mut builder, Stream::Inboxes);
    builder.push(" SELECT EXISTS (SELECT 1 FROM email_threads t WHERE t.id = ");
    builder.push_bind(S_THREAD);
    read.push_allowed(&mut builder);
    builder.push(")");
    let inline: bool = builder.build_query_scalar().fetch_one(pool).await?;
    assert_eq!(inline, expected, "inline Team eligibility");

    // Exercise candidate discovery as well as its final predicate. A live
    // target must reach the selected stream before the predicate can admit it.
    let mut page_params = super::params(SimpleSortMethod::UpdatedAt);
    page_params.team_id = Some(S_TEAM);
    page_params.link_ids = vec![S_LINK];
    page_params.user_id = S_USER.to_string();
    page_params.resolved = resolve_filters(pool, &[S_LINK], Some(S_TEAM), &filter)
        .await?
        .with_contributing_links(vec![S_LINK]);
    let page_read = team_read(&view, &filter, page_params).unwrap();
    let mut tx = pool.begin().await?;
    let rows = page_read
        .fetch(&mut tx, Instant::now() + std::time::Duration::from_secs(10))
        .await?;
    tx.rollback().await?;
    assert_eq!(
        rows.into_iter().map(|row| row.id).collect::<Vec<_>>(),
        if expected { vec![S_THREAD] } else { vec![] },
        "the selected candidate stream agrees with all three predicates"
    );

    let interactions = sqlx::query_file!(
        "../crm/src/outbound/companies_repo/email_privacy/interactions.sql",
        S_TEAM,
        S_LINK,
        "other@peer.example"
    )
    .fetch_one(pool)
    .await?;
    assert_eq!(
        interactions.is_sent,
        expected.then_some(true),
        "set-based ingestion"
    );
    assert_eq!(
        interactions.first_at,
        expected.then(|| Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap())
    );
    assert_eq!(
        interactions.last_at,
        expected.then(|| Utc.with_ymd_and_hms(2026, 1, 2, 0, 0, 0).unwrap()),
        "the later message without the selected participant shares too"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn all_five_selectors_share_the_whole_thread(pool: sqlx::PgPool) -> anyhow::Result<()> {
    parity(&pool, false).await?;
    sqlx::query!("INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_THREAD).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "DELETE FROM crm_email_rule_threads WHERE team_id = $1",
        S_TEAM
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, 'selected@client.example')", S_TEAM, S_USER).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "DELETE FROM crm_email_rule_addresses WHERE team_id = $1",
        S_TEAM
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_email_rule_contacts (team_id, user_id, revision, contact_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_CONTACT).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "DELETE FROM crm_email_rule_contacts WHERE team_id = $1",
        S_TEAM
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_email_rule_domains (team_id, user_id, revision, domain) VALUES ($1, $2, 1, 'client.example')", S_TEAM, S_USER).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "DELETE FROM crm_email_rule_domains WHERE team_id = $1",
        S_TEAM
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_email_rule_companies (team_id, user_id, revision, company_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_COMPANY).execute(&pool).await?;
    parity(&pool, true).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn contacts_resolve_live_with_record_visibility(pool: sqlx::PgPool) -> anyhow::Result<()> {
    sqlx::query!("INSERT INTO crm_email_rule_contacts (team_id, user_id, revision, contact_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_CONTACT).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!("DELETE FROM crm_contact_emails WHERE contact_id = $1 AND email = 'selected@client.example'", S_CONTACT).execute(&pool).await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "INSERT INTO crm_contact_emails (contact_id, email) VALUES ($1, 'selected@client.example')",
        S_CONTACT
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE team_user SET crm_access = FALSE WHERE user_id = $1",
        S_USER
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "UPDATE crm_contacts SET hidden = TRUE WHERE id = $1",
        S_CONTACT
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "UPDATE team_user SET team_role = 'admin' WHERE user_id = $1",
        S_USER
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "UPDATE team_user SET team_role = 'member' WHERE user_id = $1",
        S_USER
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE crm_contacts SET hidden = FALSE WHERE id = $1",
        S_CONTACT
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE crm_companies SET hidden = TRUE WHERE id = $1",
        S_COMPANY
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "UPDATE crm_companies SET hidden = FALSE WHERE id = $1",
        S_COMPANY
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!("DELETE FROM crm_contacts WHERE id = $1", S_CONTACT)
        .execute(&pool)
        .await?;
    parity(&pool, false).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn companies_resolve_live_and_domain_matches_have_dot_boundaries(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    sqlx::query!("INSERT INTO crm_email_rule_companies (team_id, user_id, revision, company_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_COMPANY).execute(&pool).await?;
    parity(&pool, true).await?;
    for (address, expected) in [
        ("selected@sub.CLIENT.example", true),
        ("selected@evilclient.example", false),
        ("selected@client.example.invalid", false),
    ] {
        sqlx::query!("UPDATE email_contacts SET email_address = $1 WHERE id = '00000000-0000-4000-8000-000000000032'", address).execute(&pool).await?;
        parity(&pool, expected).await?;
    }
    sqlx::query!(
        "UPDATE crm_domains SET domain = 'client.example.invalid' WHERE company_id = $1",
        S_COMPANY
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "UPDATE crm_companies SET hidden = TRUE WHERE id = $1",
        S_COMPANY
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "UPDATE crm_companies SET hidden = FALSE WHERE id = $1",
        S_COMPANY
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!("DELETE FROM crm_companies WHERE id = $1", S_COMPANY)
        .execute(&pool)
        .await?;
    parity(&pool, false).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn exceptions_and_domain_denials_override_all_contribution_modes(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    sqlx::query!("INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_THREAD).execute(&pool).await?;
    for selected in [true, false] {
        change_mode(&pool, selected).await?;
        parity(&pool, true).await?;
        sqlx::query!("INSERT INTO crm_email_thread_exclusions (team_id, user_id, link_id, thread_id) VALUES ($1, $2, $3, $4)", S_TEAM, S_USER, S_LINK, S_THREAD).execute(&pool).await?;
        parity(&pool, false).await?;
        assert_eq!(
            sqlx::query_scalar!("SELECT crm_email_thread_allowed($1, $2)", S_TEAM, S_COPY)
                .fetch_one(&pool)
                .await?,
            Some(true),
            "another contributor keeps their mailbox-local copy"
        );
        sqlx::query!(
            "DELETE FROM crm_email_thread_exclusions WHERE team_id = $1",
            S_TEAM
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            "INSERT INTO crm_blocked_domains (team_id, domain) VALUES ($1, 'peer.example')",
            S_TEAM
        )
        .execute(&pool)
        .await?;
        parity(&pool, false).await?;
        sqlx::query!("DELETE FROM crm_blocked_domains WHERE team_id = $1", S_TEAM)
            .execute(&pool)
            .await?;
        sqlx::query!("INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, 'client.example')", S_TEAM, S_USER).execute(&pool).await?;
        parity(&pool, false).await?;
        sqlx::query!(
            "DELETE FROM crm_personal_email_blocklist WHERE team_id = $1",
            S_TEAM
        )
        .execute(&pool)
        .await?;
        sqlx::query!(
            "UPDATE crm_companies SET email_sync = FALSE WHERE id = $1",
            S_COMPANY
        )
        .execute(&pool)
        .await?;
        parity(&pool, false).await?;
        sqlx::query!(
            "UPDATE crm_companies SET email_sync = TRUE WHERE id = $1",
            S_COMPANY
        )
        .execute(&pool)
        .await?;
        parity(&pool, true).await?;
        sqlx::query!(
            "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
            S_TEAM,
            S_USER
        )
        .execute(&pool)
        .await?;
        parity(&pool, false).await?;
    }
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn sender_to_cc_bcc_match_but_drafts_do_not(pool: sqlx::PgPool) -> anyhow::Result<()> {
    sqlx::query!("INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, 'selected@client.example')", S_TEAM, S_USER).execute(&pool).await?;
    for kind in ["TO", "CC", "BCC"] {
        sqlx::query!("UPDATE email_message_recipients SET recipient_type = $1::text::email_recipient_type WHERE contact_id = '00000000-0000-4000-8000-000000000032'", kind).execute(&pool).await?;
        parity(&pool, true).await?;
    }
    sqlx::query!("DELETE FROM email_message_recipients WHERE contact_id = '00000000-0000-4000-8000-000000000032'").execute(&pool).await?;
    sqlx::query!("UPDATE email_messages SET from_contact_id = '00000000-0000-4000-8000-000000000032' WHERE id = '00000000-0000-4000-8000-000000000051'").execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!("UPDATE email_messages SET from_contact_id = '00000000-0000-4000-8000-000000000031' WHERE id = '00000000-0000-4000-8000-000000000051'").execute(&pool).await?;
    sqlx::query!("INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, is_sent, is_draft, internal_date_ts) VALUES ('00000000-0000-4000-8000-000000000054', $1, $2, '00000000-0000-4000-8000-000000000032', TRUE, TRUE, '2026-01-03')", S_THREAD, S_LINK).execute(&pool).await?;
    parity(&pool, false).await?;
    sqlx::query!("INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_THREAD).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "UPDATE email_messages SET is_draft = TRUE WHERE thread_id = $1",
        S_THREAD
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn revisions_mailbox_copies_and_lifecycle_stay_scoped(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    sqlx::query!("INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 1, $3)", S_TEAM, S_USER, S_COPY).execute(&pool).await?;
    parity(&pool, false).await?;
    sqlx::query!("INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 2, $3, 1, '{\"schema_version\":1,\"include\":[]}'::jsonb)", S_TEAM, S_USER, S_LINK).execute(&pool).await?;
    sqlx::query!("INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 2, $3)", S_TEAM, S_USER, S_THREAD).execute(&pool).await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET active_rule_revision = 2 WHERE team_id = $1 AND user_id = $2",
        S_TEAM,
        S_USER
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!("UPDATE crm_email_consent SET mode = 'all', enabled = TRUE, selected_enabled = FALSE, active_rule_revision = NULL WHERE team_id = $1 AND user_id = $2", S_TEAM, S_USER).execute(&pool).await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = TRUE WHERE id = $1",
        S_LINK
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = FALSE WHERE id = $1",
        S_LINK
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    Ok(())
}

struct ResolutionPause {
    reached: oneshot::Sender<usize>,
    resume: oneshot::Receiver<()>,
}

tokio::task_local! {
    static RESOLUTION_PAUSE: RefCell<Option<ResolutionPause>>;
}

/// The mode decision must share the snapshot used by the probe and page.
pub(in super::super) async fn pause_after_resolution(resolved: &ResolvedFilters) {
    let Ok(Some(pause)) = RESOLUTION_PAUSE.try_with(|slot| slot.borrow_mut().take()) else {
        return;
    };
    let _ = pause
        .reached
        .send(resolved.selected_link_ids().unwrap_or_default().len());
    let _ = pause.resume.await;
}

async fn change_mode(pool: &sqlx::PgPool, selected: bool) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
        S_TEAM,
        S_USER,
    )
    .execute(&mut *tx)
    .await?;
    if selected {
        sqlx::query!(
            "UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = 1 WHERE team_id = $1 AND user_id = $2",
            S_TEAM,
            S_USER,
        )
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query!(
            "UPDATE crm_email_consent SET mode = 'all', enabled = TRUE, selected_enabled = FALSE, active_rule_revision = NULL WHERE team_id = $1 AND user_id = $2",
            S_TEAM,
            S_USER,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn selected_page(pool: &sqlx::PgPool) -> anyhow::Result<Vec<Uuid>> {
    let query = Query::new(
        None,
        SimpleSortMethod::UpdatedAt,
        Arc::new(any_direction("peer.example")),
    );
    Ok(super::super::super::dynamic_email_thread_cursor_with(
        pool,
        &[S_LINK],
        50,
        &all_mail(),
        query,
        S_USER,
        Some(S_TEAM),
        Some(TeamReadTuning::DEFAULT),
    )
    .await?
    .into_iter()
    .map(|row| row.id)
    .collect())
}

async fn mode_transition_snapshot(pool: &sqlx::PgPool, selected: bool) -> anyhow::Result<()> {
    // The second copy must not mask either a missing or an extra thread.
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND link_id = $2",
        S_TEAM,
        S_COPY_LINK,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_threads (team_id, user_id, revision, thread_id) VALUES ($1, $2, 1, $3)",
        S_TEAM, S_USER, S_THREAD,
    )
    .execute(pool)
    .await?;
    let unselected = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0023);
    sqlx::query!(
        "INSERT INTO email_threads (id, provider_id, link_id, latest_non_spam_message_ts) VALUES ($1, 'unselected-thread', $2, '2026-01-03')",
        unselected, S_LINK,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, from_contact_id, is_sent, is_draft, internal_date_ts, global_id) VALUES ('00000000-0000-4000-8000-000000000055', $1, $2, '00000000-0000-4000-8000-000000000033', FALSE, FALSE, '2026-01-03', 'unselected@example.com')",
        unselected, S_LINK,
    )
    .execute(pool)
    .await?;
    change_mode(pool, selected).await?;
    let expected = if selected {
        vec![S_THREAD]
    } else {
        vec![unselected, S_THREAD]
    };
    assert_eq!(selected_page(pool).await?, expected);

    let (reached, resolved) = oneshot::channel();
    let (resume, resumed) = oneshot::channel();
    let request = RESOLUTION_PAUSE.scope(
        RefCell::new(Some(ResolutionPause {
            reached,
            resume: resumed,
        })),
        selected_page(pool),
    );
    let change = async {
        assert_eq!(resolved.await?, usize::from(selected));
        change_mode(pool, !selected).await?;
        let _ = resume.send(());
        anyhow::Ok(())
    };
    let (actual, changed) = tokio::join!(request, change);
    changed?;
    assert_eq!(
        actual?, expected,
        "the request retains its original policy snapshot"
    );
    let next = if selected {
        vec![unselected, S_THREAD]
    } else {
        vec![S_THREAD]
    };
    assert_eq!(
        selected_page(pool).await?,
        next,
        "the next request sees the committed mode"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn selected_to_all_keeps_resolution_probe_and_page_in_one_snapshot(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    mode_transition_snapshot(&pool, true).await
}

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../../fixtures", scripts("email_crm_selected"))
)]
async fn all_to_selected_keeps_resolution_probe_and_page_in_one_snapshot(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    mode_transition_snapshot(&pool, false).await
}
