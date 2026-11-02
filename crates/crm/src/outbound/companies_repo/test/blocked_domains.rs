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
