mod linked_personal;

#[cfg(feature = "inbound")]
mod http;

use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::email_privacy::{EmailBlockScope, EmailPrivacyChange, EmailPrivacyRepository};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

#[sqlx::test(migrations = false)]
async fn rollout_and_rollback_preserve_records_and_do_not_inherit_consent(
    pool: PgPool,
) -> anyhow::Result<()> {
    // This schema is owned by the disposable sqlx test database.
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(&pool)
        .await?;
    let before_privacy = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|m| m.version < 20261106021950)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_privacy.run(&pool).await?;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, false, &["acme.example.com"]).await?;
    insert_contact(&pool, company, "pat@acme.example.com").await?;
    // An old writer keeps its settings-table lock through the entire purge
    // transaction. Cutover must wait or fail atomically, never straddle it.
    let mut old_writer = pool.begin().await?;
    sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled=crm_enabled WHERE team_id=$1",
        team
    )
    .execute(&mut *old_writer)
    .await?;
    let mut cutover = pool.begin().await?;
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sqlx::raw_sql(include_str!(
            "../../../../../macro_db_client/migrations/20261106021950_crm_email_contribution.up.sql"
        ))
        .execute(&mut *cutover),
    )
    .await
    .expect("cutover lock wait is bounded")
    .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55P03")
    );
    cutover.rollback().await?;
    assert!(
        sqlx::query_scalar!("SELECT to_regclass('crm_email_consent')::text AS table_name")
            .fetch_one(&pool)
            .await?
            .is_none()
    );
    assert!(
        sqlx::query_scalar!(
            "SELECT crm_enabled FROM team_crm_settings WHERE team_id=$1",
            team
        )
        .fetch_one(&pool)
        .await?
    );
    old_writer.commit().await?;
    MACRO_DB_MIGRATIONS.run(&pool).await?;
    assert!(
        !sqlx::query_scalar!(
            "SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?
    );
    let new_team = Uuid::now_v7();
    seed_team(&pool, new_team, "macro|new-owner@example.com").await?;
    for legacy_team in [team, new_team] {
        let error = sqlx::query!(
            "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, TRUE) ON CONFLICT (team_id) DO UPDATE SET crm_enabled = EXCLUDED.crm_enabled",
            legacy_team
        ).execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("55000")
        );
    }
    // A plain legacy team-creation insert remains compatible and cannot opt in.
    assert!(!sqlx::query_scalar!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, TRUE) RETURNING crm_enabled",
        new_team
    ).fetch_one(&pool).await?);
    let error = sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled = TRUE WHERE team_id = $1",
        team
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55000")
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_consent")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    // Ordinary governance/personal-provider settings do not touch the retired
    // switch. Both the conflict and absent-row paths must remain available.
    sqlx::query!("DELETE FROM team_crm_settings WHERE team_id=$1", new_team)
        .execute(&pool)
        .await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    for settings_team in [team, new_team] {
        let settings = repo
            .update_team_settings(
                &settings_team,
                &crate::domain::model::CrmTeamSettingsPatch {
                    exclude_personal_emails: Some(false),
                    ..Default::default()
                },
            )
            .await?;
        assert!(!settings.exclude_personal_emails);
    }

    sqlx::raw_sql(include_str!(
        "../../../../../macro_db_client/migrations/20261106031523_crm_email_backfill_trace_context.down.sql"
    )).execute(&pool).await?;
    sqlx::raw_sql(include_str!(
        "../../../../../macro_db_client/migrations/20261106023717_crm_consent_mailbox_lifecycle.down.sql"
    ))
    .execute(&pool)
    .await?;
    sqlx::raw_sql(include_str!(
        "../../../../../macro_db_client/migrations/20261106021950_crm_email_contribution.down.sql"
    ))
    .execute(&pool)
    .await?;
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert!(
        sqlx::query_scalar!(
            "UPDATE team_crm_settings SET crm_enabled = TRUE WHERE team_id = $1 RETURNING crm_enabled",
            team
        )
        .fetch_one(&pool)
        .await?,
        "rollback removes the guard, allowing an explicit legacy enable decision"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_lifecycle_migration_times_out_without_blocking_writers(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Only this disposable test database is changed; production migrations
    // and previously applied development migration histories stay untouched.
    sqlx::raw_sql(include_str!(
        "../../../../../macro_db_client/migrations/20261106023717_crm_consent_mailbox_lifecycle.down.sql"
    )).execute(&pool).await?;
    let mut writer = pool.begin().await?;
    sqlx::raw_sql("LOCK TABLE email_links IN ROW EXCLUSIVE MODE")
        .execute(&mut *writer)
        .await?;
    let migration = include_str!(
        "../../../../../macro_db_client/migrations/20261106023717_crm_consent_mailbox_lifecycle.up.sql"
    );
    let mut deploy = pool.begin().await?;
    let error = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sqlx::raw_sql(migration).execute(&mut *deploy),
    )
    .await
    .expect("migration must stop waiting for the mailbox writer")
    .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55P03")
    );
    deploy.rollback().await?;
    writer.commit().await?;
    let mut retry = pool.begin().await?;
    sqlx::raw_sql(migration).execute(&mut *retry).await?;
    retry.commit().await?;
    Ok(())
}

async fn setup(pool: &PgPool) -> anyhow::Result<(CompaniesRepositoryImpl, Uuid, Uuid)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        OWNER
    )
    .execute(pool)
    .await?;
    let link = insert_email_link(pool, OWNER, "owner@example.com").await?;
    Ok((CompaniesRepositoryImpl::new(pool.clone()), team, link))
}

async fn allowed(pool: &PgPool, team: Uuid, thread: Uuid) -> anyhow::Result<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT crm_email_thread_allowed($1, $2) AS "allowed!""#,
        team,
        thread
    )
    .fetch_one(pool)
    .await?)
}

async fn deliver(
    repo: &CompaniesRepositoryImpl,
    team: Uuid,
    link: Uuid,
    email: &str,
) -> anyhow::Result<()> {
    repo.populate_contact(
        &team,
        &link,
        email.split('@').nth(1).unwrap(),
        email,
        None,
        Utc::now(),
        Utc::now(),
        true,
    )
    .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consent_controls_ingestion_and_reads_without_deleting_records(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    let thread = insert_interaction(&pool, link, "pat@acme.example.com", Utc::now(), true).await?;
    assert!(!repo.email_privacy(team, OWNER).await?.enabled);
    assert!(!allowed(&pool, team, thread).await?);
    deliver(&repo, team, link, "pat@acme.example.com").await?;
    assert_eq!(
        count_companies_for_domain(&pool, team, "acme.example.com").await?,
        0
    );

    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: true,
            link_id: Some(link),
        },
    )
    .await?;
    assert!(allowed(&pool, team, thread).await?);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_backfill_outbox WHERE team_id = $1 AND user_id = $2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?,
        Some(1),
        "consent commits its historical backfill request"
    );
    deliver(&repo, team, link, "pat@acme.example.com").await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    assert_eq!(count_contacts(&pool, company).await?, 1);

    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    assert!(!allowed(&pool, team, thread).await?);
    assert!(repo.contribution_mailbox(team, OWNER).await?.is_none());
    insert_interaction(&pool, link, "new@acme.example.com", Utc::now(), true).await?;
    deliver(&repo, team, link, "new@acme.example.com").await?;
    assert_eq!(
        count_contacts(&pool, company).await?,
        1,
        "stale job after withdrawal must not write"
    );
    assert!(
        fetch_company_for_domain(&pool, team, "acme.example.com")
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blocklist_is_retroactive_and_blocks_untracked_domains_and_subdomains(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let acme = insert_interaction(&pool, link, "pat@acme.example.com", Utc::now(), true).await?;
    let sub =
        insert_interaction(&pool, link, "pat@sales.acme.example.com", Utc::now(), true).await?;
    let similar =
        insert_interaction(&pool, link, "pat@notacme.example.com", Utc::now(), true).await?;
    deliver(&repo, team, link, "pat@acme.example.com").await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Team,
            domain: "acme.example.com".into(),
        },
    )
    .await?;
    assert!(!allowed(&pool, team, acme).await?);
    assert!(!allowed(&pool, team, sub).await?);
    assert!(allowed(&pool, team, similar).await?);
    deliver(&repo, team, link, "pat@sales.acme.example.com").await?;
    assert_eq!(
        count_companies_for_domain(&pool, team, "sales.acme.example.com").await?,
        0
    );
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::RemoveDomain {
            scope: EmailBlockScope::Team,
            domain: "acme.example.com".into(),
        },
    )
    .await?;
    assert!(allowed(&pool, team, sub).await?);
    deliver(&repo, team, link, "pat@sales.acme.example.com").await?;
    assert_eq!(
        count_companies_for_domain(&pool, team, "sales.acme.example.com").await?,
        1
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_blocked_bcc_participant_excludes_the_entire_thread_and_its_timestamps(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let safe_at = "2025-01-01T00:00:00Z".parse()?;
    let blocked_at = "2026-01-01T00:00:00Z".parse()?;
    let safe = insert_interaction(&pool, link, "pat@acme.example.com", safe_at, true).await?;
    let mixed = insert_interaction(&pool, link, "pat@acme.example.com", blocked_at, true).await?;
    let contact = Uuid::now_v7();
    sqlx::query!("INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, 'secret@private.example.com')", contact, link).execute(&pool).await?;
    sqlx::query!("INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) SELECT id, $2, 'BCC' FROM email_messages WHERE thread_id = $1", mixed, contact).execute(&pool).await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Personal,
            domain: "private.example.com".into(),
        },
    )
    .await?;
    assert!(allowed(&pool, team, safe).await?);
    assert!(!allowed(&pool, team, mixed).await?);
    deliver(&repo, team, link, "pat@acme.example.com").await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    assert_eq!(
        fetch_company_interactions(&pool, company).await?,
        Some((safe_at, safe_at))
    );
    deliver(&repo, team, link, "secret@private.example.com").await?;
    assert_eq!(
        count_companies_for_domain(&pool, team, "private.example.com").await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_blocks_only_affect_the_contributors_mailbox(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let other = "macro|colleague@example.com";
    let user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        user,
        other
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        other,
        user
    )
    .execute(&pool)
    .await?;
    let other_link = insert_email_link(&pool, other, "colleague@example.com").await?;
    consent_to_mailbox(&pool, team, other_link).await?;
    let mine = insert_interaction(&pool, link, "pat@acme.example.com", Utc::now(), true).await?;
    let theirs =
        insert_interaction(&pool, other_link, "pat@acme.example.com", Utc::now(), true).await?;
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Personal,
            domain: "acme.example.com".into(),
        },
    )
    .await?;
    assert!(!allowed(&pool, team, mine).await?);
    assert!(allowed(&pool, team, theirs).await?);
    assert!(
        repo.email_privacy(team, other)
            .await?
            .personal_domains
            .is_empty()
    );
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::AddDomain {
            scope: EmailBlockScope::Team,
            domain: "acme.example.com".into(),
        },
    )
    .await?;
    assert!(!allowed(&pool, team, theirs).await?);
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::RemoveDomain {
            scope: EmailBlockScope::Team,
            domain: "acme.example.com".into(),
        },
    )
    .await?;
    assert!(!allowed(&pool, team, mine).await?, "personal block remains");
    assert!(allowed(&pool, team, theirs).await?);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consent_does_not_extend_to_secondary_mailboxes_or_survive_team_removal(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let secondary = insert_email_link(&pool, OWNER, "secondary@example.com").await?;
    let thread =
        insert_interaction(&pool, secondary, "pat@acme.example.com", Utc::now(), true).await?;
    assert!(!allowed(&pool, team, thread).await?);
    deliver(&repo, team, secondary, "pat@acme.example.com").await?;
    assert_eq!(
        count_companies_for_domain(&pool, team, "acme.example.com").await?,
        0
    );
    let primary = insert_interaction(&pool, link, "pat@acme.example.com", Utc::now(), true).await?;
    assert!(allowed(&pool, team, primary).await?);
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(!allowed(&pool, team, primary).await?);
    assert!(repo.contribution_mailbox(team, OWNER).await?.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consent_requires_the_displayed_primary_and_does_not_survive_reconnect(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    let wrong = Uuid::now_v7();
    for submitted in [None, Some(wrong)] {
        assert!(
            repo.change_email_privacy(
                team,
                OWNER,
                EmailPrivacyChange::SetConsent {
                    enabled: true,
                    link_id: submitted,
                }
            )
            .await
            .is_err()
        );
    }
    consent_to_mailbox(&pool, team, link).await?;
    assert_eq!(
        repo.email_privacy(team, OWNER).await?.mailbox_link_id,
        Some(link)
    );
    let thread = insert_interaction(&pool, link, "person@example.org", Utc::now(), true).await?;
    assert!(allowed(&pool, team, thread).await?);

    sqlx::query!(
        "UPDATE email_links SET deleting_at = now() WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(!allowed(&pool, team, thread).await?);
    assert!(repo.contribution_mailbox(team, OWNER).await?.is_none());
    assert!(
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetConsent {
                enabled: true,
                link_id: Some(link),
            }
        )
        .await
        .is_err()
    );
    // Even a reused row cannot silently restore the prior grant.
    sqlx::query!(
        "UPDATE email_links SET deleting_at = NULL WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(!repo.email_privacy(team, OWNER).await?.enabled);
    assert!(!allowed(&pool, team, thread).await?);
    consent_to_mailbox(&pool, team, link).await?;
    sqlx::query!(
        "UPDATE email_links SET email_address = 'secondary@example.com' WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "UPDATE email_links SET email_address = 'owner@example.com' WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(!allowed(&pool, team, thread).await?);
    assert!(!repo.email_privacy(team, OWNER).await?.enabled);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn consent_admission_rechecks_mailbox_after_a_concurrent_disconnect(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    let mut disconnect = pool.begin().await?;
    sqlx::query!(
        "UPDATE email_links SET deleting_at = now() WHERE id = $1",
        link
    )
    .execute(&mut *disconnect)
    .await?;
    let task = tokio::spawn(async move {
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetConsent {
                enabled: true,
                link_id: Some(link),
            },
        )
        .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0) AS "waiting!""#
            ).fetch_one(&pool).await?;
            if waiting { return anyhow::Ok(()); }
            assert!(!task.is_finished(), "consent must wait for mailbox lifecycle");
            tokio::task::yield_now().await;
        }
    }).await??;
    disconnect.commit().await?;
    assert!(task.await?.is_err());
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_consent WHERE team_id = $1 AND enabled",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_less_capture_rechecks_consent_and_eligible_message_direction(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::model::CrmTeamSettingsPatch;
    let (repo, team, link) = setup(&pool).await?;
    repo.update_team_settings(
        &team,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await?;
    let provider = "gmail.com";
    let address = format!("person@{provider}");
    let address = address.as_str();
    let received = Utc::now();
    insert_interaction(&pool, link, address, received, false).await?;
    let deliver = || {
        repo.populate_unfiled_contact(
            &team,
            &link,
            "gmail.com",
            address,
            Some("Person"),
            received,
            received,
            true,
        )
    };
    deliver().await?;
    assert!(
        repo.get_contact_by_email_for_team(&team, address, false)
            .await?
            .is_none()
    );
    consent_to_mailbox(&pool, team, link).await?;
    // A stale sent=true job cannot promote a received-only interaction.
    deliver().await?;
    assert!(
        repo.get_contact_by_email_for_team(&team, address, false)
            .await?
            .is_none()
    );
    insert_interaction(&pool, link, address, received, true).await?;
    deliver().await?;
    let contact = repo
        .get_contact_by_email_for_team(&team, address, false)
        .await?
        .expect("consented sent email creates a person");
    assert_eq!(contact.company_id, None);
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    deliver().await?;
    assert_eq!(
        repo.get_contact_by_email_for_team(&team, address, false)
            .await?
            .unwrap()
            .id,
        contact.id
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ingestion_waits_for_disconnect_and_rechecks_before_writing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    insert_interaction(&pool, link, "person@example.org", Utc::now(), true).await?;
    let mut disconnect = pool.begin().await?;
    sqlx::query!(
        "UPDATE email_links SET deleting_at = now() WHERE id = $1",
        link
    )
    .execute(&mut *disconnect)
    .await?;
    let task = tokio::spawn(async move { deliver(&repo, team, link, "person@example.org").await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0) AS "waiting!""#
            ).fetch_one(&pool).await?;
            if waiting { return anyhow::Ok(()); }
            assert!(!task.is_finished(), "ingestion must wait for mailbox lifecycle");
            tokio::task::yield_now().await;
        }
    }).await??;
    disconnect.commit().await?;
    task.await??;
    assert_eq!(
        count_companies_for_domain(&pool, team, "example.org").await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ingestion_waits_for_membership_removal_before_writing(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    insert_interaction(&pool, link, "person@example.org", Utc::now(), true).await?;
    let mut removal = pool.begin().await?;
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&mut *removal)
    .await?;
    let task = tokio::spawn(async move { deliver(&repo, team, link, "person@example.org").await });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0) AS "waiting!""#
            ).fetch_one(&pool).await?;
            if waiting { return anyhow::Ok(()); }
            assert!(!task.is_finished(), "ingestion must wait for membership lifecycle");
            tokio::task::yield_now().await;
        }
    }).await??;
    removal.commit().await?;
    task.await??;
    assert_eq!(
        count_companies_for_domain(&pool, team, "example.org").await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ordinary_refresh_keeps_consent_but_reauthentication_requires_new_opt_in(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    sqlx::query!(
        "UPDATE email_links SET updated_at = now(), needs_reauth = FALSE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(repo.email_privacy(team, OWNER).await?.enabled);
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = TRUE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(!repo.email_privacy(team, OWNER).await?.enabled);
    assert!(
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetConsent {
                enabled: true,
                link_id: Some(link)
            }
        )
        .await
        .is_err()
    );
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = FALSE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(!repo.email_privacy(team, OWNER).await?.enabled);
    consent_to_mailbox(&pool, team, link).await?;
    assert!(repo.email_privacy(team, OWNER).await?.enabled);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unavailable_primary_is_not_offered_for_consent(pool: PgPool) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    for needs_reauth in [true, false] {
        sqlx::query!("UPDATE email_links SET needs_reauth = $2, disconnect_requested_at = CASE WHEN $2 THEN NULL ELSE now() END WHERE id = $1", link, needs_reauth).execute(&pool).await?;
        let settings = repo.email_privacy(team, OWNER).await?;
        assert!(settings.mailbox_link_id.is_none());
        assert!(settings.mailbox_email.is_none());
        assert!(!settings.enabled);
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetConsent {
                enabled: false,
                link_id: None,
            },
        )
        .await?;
    }
    Ok(())
}
