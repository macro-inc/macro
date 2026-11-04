//! The team blocklist: blocked domains stay out of email sync, and what
//! the CRM already holds for them is hidden until unblocked.

use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmTeamSettingsPatch;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

/// A consumer provider, so email sync would admit it if it weren't
/// blocked. No reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

fn personal(local: &str) -> String {
    format!("{local}@{PERSONAL_DOMAIN}")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blocking_hides_existing_records_and_stops_sync(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "user@macro.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let acme = insert_company(&pool, team_id, true, &["example.com"]).await?;
    let jane = insert_contact(&pool, acme, "jane@example.com").await?;
    repo.update_team_settings(
        &team_id,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await?;
    let solo = repo
        .create_contact_for_team(&team_id, Some(personal("sam").as_str()), "Sam", Utc::now())
        .await?;

    repo.block_domain(&team_id, "example.com").await?;
    repo.block_domain(&team_id, "example.com").await?;
    repo.block_domain(&team_id, PERSONAL_DOMAIN).await?;

    assert_eq!(
        repo.list_blocked_domains(&team_id)
            .await?
            .into_iter()
            .map(|blocked| blocked.domain)
            .collect::<Vec<_>>(),
        ["example.com", PERSONAL_DOMAIN]
    );
    assert!(fetch_company_hidden(&pool, acme).await? == Some(true));
    assert!(fetch_contact_hidden(&pool, jane).await? == Some(true));
    assert!(fetch_contact_hidden(&pool, solo.id).await? == Some(true));

    // Sync skips blocked domains: no new company, no new contact.
    for email in ["bob@example.com".to_owned(), personal("ann")] {
        service
            .populate_contact(
                &team_id,
                &link_id,
                "user@macro.com",
                &email,
                None,
                Utc::now(),
                Utc::now(),
                true,
            )
            .await?;
    }
    assert_eq!(count_contacts(&pool, acme).await?, 1);
    let unfiled: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM crm_contacts WHERE team_id = $1 AND company_id IS NULL",
    )
    .bind(team_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(unfiled, 1);

    repo.unblock_domain(&team_id, "example.com").await?;
    assert!(fetch_company_hidden(&pool, acme).await? == Some(false));
    assert!(fetch_contact_hidden(&pool, jane).await? == Some(false));
    assert!(fetch_contact_hidden(&pool, solo.id).await? == Some(true));
    assert_eq!(
        repo.list_blocked_domains(&team_id).await?.len(),
        1,
        "the personal domain stays blocked"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn blocklists_are_per_team(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@example.com").await?;
    seed_team(&pool, team_b, "macro|b@example.com").await?;
    let acme_b = insert_company(&pool, team_b, true, &["example.com"]).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    repo.block_domain(&team_a, "example.com").await?;

    assert!(fetch_company_hidden(&pool, acme_b).await? == Some(false));
    assert!(repo.list_blocked_domains(&team_b).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_company_stays_hidden_while_any_of_its_domains_is_blocked(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let acme = insert_company(&pool, team_id, true, &["example.com", "example.org"]).await?;
    let jane = insert_contact(&pool, acme, "jane@example.com").await?;

    repo.block_domain(&team_id, "example.com").await?;
    repo.block_domain(&team_id, "example.org").await?;
    repo.unblock_domain(&team_id, "example.com").await?;

    assert!(fetch_company_hidden(&pool, acme).await? == Some(true));
    assert!(fetch_contact_hidden(&pool, jane).await? == Some(true));

    repo.unblock_domain(&team_id, "example.org").await?;

    assert!(fetch_company_hidden(&pool, acme).await? == Some(false));
    assert!(fetch_contact_hidden(&pool, jane).await? == Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_domain_changes_keep_company_and_contacts_consistent(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team_id, true, &["example.com", "example.org"]).await?;
    let contact = insert_contact(&pool, company, "contact@example.com").await?;
    repo.block_domain(&team_id, "example.com").await?;
    repo.block_domain(&team_id, "example.org").await?;

    change_domains_while_company_locked(&pool, team_id, company, false).await?;

    assert!(repo.list_blocked_domains(&team_id).await?.is_empty());
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    assert_eq!(fetch_contact_hidden(&pool, contact).await?, Some(false));

    repo.block_domain(&team_id, "example.com").await?;
    change_domains_while_company_locked(&pool, team_id, company, true).await?;

    assert_eq!(
        repo.list_blocked_domains(&team_id)
            .await?
            .into_iter()
            .map(|entry| entry.domain)
            .collect::<Vec<_>>(),
        ["example.org"]
    );
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(true));
    assert_eq!(fetch_contact_hidden(&pool, contact).await?, Some(true));
    Ok(())
}

async fn change_domains_while_company_locked(
    pool: &PgPool,
    team_id: Uuid,
    company_id: Uuid,
    block_second: bool,
) -> anyhow::Result<()> {
    let mut barrier = pool.begin().await?;
    sqlx::query!(
        "SELECT id FROM crm_companies WHERE id = $1 FOR UPDATE",
        company_id,
    )
    .fetch_one(&mut *barrier)
    .await?;

    let first_repo = CompaniesRepositoryImpl::new(pool.clone());
    let first =
        tokio::spawn(async move { first_repo.unblock_domain(&team_id, "example.com").await });
    let second_repo = CompaniesRepositoryImpl::new(pool.clone());
    let second = tokio::spawn(async move {
        if block_second {
            second_repo.block_domain(&team_id, "example.org").await
        } else {
            second_repo.unblock_domain(&team_id, "example.org").await
        }
    });

    // Both operations must reach their company-row wait before either can
    // commit. An UPDATE that starts its snapshot before this wait is stale.
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT COUNT(*) AS "waiting!" FROM pg_stat_activity
                   WHERE datname = current_database()
                     AND wait_event_type = 'Lock'
                     AND cardinality(pg_blocking_pids(pid)) > 0"#,
            )
            .fetch_one(pool)
            .await?;
            if waiting == 2 {
                return anyhow::Ok(());
            }
            assert!(!first.is_finished() && !second.is_finished());
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await??;
    barrier.commit().await?;
    first.await??;
    second.await??;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unblocking_a_domain_that_was_never_blocked_keeps_hand_hidden_records(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let acme = insert_company(&pool, team_id, true, &["example.com"]).await?;
    let jane = insert_contact(&pool, acme, "jane@example.com").await?;
    repo.set_company_hidden(&team_id, &acme, true).await?;
    repo.set_contact_hidden(&team_id, &jane, true).await?;

    repo.unblock_domain(&team_id, "example.com").await?;

    assert!(fetch_company_hidden(&pool, acme).await? == Some(true));
    assert!(fetch_contact_hidden(&pool, jane).await? == Some(true));
    Ok(())
}
