use super::helpers::*;
use crate::domain::auth::CrmTeamReceipt;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::company_metadata_resolver::{CompanyMetadataResolver, DomainResolution};
use crate::domain::model::DomainMetadata;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::models::MemberTeamRole;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
struct FixedResolver(DomainResolution);

impl CompanyMetadataResolver for FixedResolver {
    async fn resolve(&self, _domain: &str) -> DomainResolution {
        self.0.clone()
    }
}

/// `(name, icon_url, enriched_at, enrichment_attempts)` of the domain's
/// directory row.
type DirectoryRow = (Option<String>, Option<String>, Option<DateTime<Utc>>, i16);

async fn fetch_directory(pool: &PgPool, domain: &str) -> sqlx::Result<Option<DirectoryRow>> {
    sqlx::query_as(
        r#"SELECT name, icon_url, enriched_at, enrichment_attempts
           FROM crm_domain_directory WHERE LOWER(domain) = LOWER($1)"#,
    )
    .bind(domain)
    .fetch_optional(pool)
    .await
}

fn acme_metadata() -> DomainMetadata {
    DomainMetadata {
        name: Some("Acme Inc.".to_string()),
        icon_url: Some("https://acme.com/logo.png".to_string()),
        ..Default::default()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn upsert_fills_pending_entry_but_keeps_resolved_entry(pool: PgPool) -> anyhow::Result<()> {
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    repo.insert_pending_domain("Acme.com").await?;
    let (name, _, enriched_at, _) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(name, None);
    assert_eq!(enriched_at, None);

    repo.upsert_domain_metadata("acme.com", &acme_metadata())
        .await?;
    let (name, icon_url, enriched_at, _) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(name.as_deref(), Some("Acme Inc."));
    assert_eq!(icon_url.as_deref(), Some("https://acme.com/logo.png"));
    assert!(enriched_at.is_some());

    // A resolved entry is first-write-wins: neither a later resolve nor a
    // pending insert replaces it.
    repo.upsert_domain_metadata(
        "acme.com",
        &DomainMetadata {
            name: Some("Other".to_string()),
            ..Default::default()
        },
    )
    .await?;
    repo.insert_pending_domain("acme.com").await?;
    let (name, _, enriched_at, _) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(name.as_deref(), Some("Acme Inc."));
    assert!(enriched_at.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claim_pending_domains_is_bounded(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    insert_company(
        &pool,
        team_id,
        true,
        &["acme.com", "globex.com", "exhausted.com"],
    )
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.insert_pending_domain("acme.com").await?;
    // Pending, but no team tracks the domain any more.
    repo.insert_pending_domain("orphan.com").await?;
    repo.upsert_domain_metadata("globex.com", &DomainMetadata::default())
        .await?;
    repo.insert_pending_domain("exhausted.com").await?;
    sqlx::query(
        "UPDATE crm_domain_directory SET enrichment_attempts = 5 WHERE domain = 'exhausted.com'",
    )
    .execute(&pool)
    .await?;

    let retry_cutoff = Utc::now() - TimeDelta::hours(6);
    let claimed = repo.claim_pending_domains(10, 5, retry_cutoff).await?;
    assert_eq!(claimed, vec!["acme.com".to_string()]);
    let (_, _, _, attempts) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(attempts, 1);

    // The fresh attempt holds the entry until the retry gap passes.
    assert!(
        repo.claim_pending_domains(10, 5, retry_cutoff)
            .await?
            .is_empty()
    );
    let after_gap = Utc::now() + TimeDelta::seconds(1);
    assert_eq!(
        repo.claim_pending_domains(10, 5, after_gap).await?,
        vec!["acme.com".to_string()]
    );
    let (_, _, _, attempts) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(attempts, 2);
    Ok(())
}

/// A company created where no resolver is available (DSS, MCP, agent tools)
/// leaves a pending entry instead of a permanent empty one, and the
/// enrichment worker later fills it for every team tracking the domain —
/// without touching a team's own name for the company.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_company_is_enriched_later_and_keeps_team_names(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner-a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner-b@test.com").await?;
    enable_crm_for_team(&pool, team_a).await?;
    enable_crm_for_team(&pool, team_b).await?;

    let manual = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let renamed = manual
        .create_company(
            &CrmTeamReceipt::<MemberTeamRole>::dangerously_internal(team_a),
            "Acme (ours)",
            "acme.com",
        )
        .await?;
    let unnamed = insert_company(&pool, team_b, true, &["acme.com"]).await?;
    let (name, _, enriched_at, _) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(name, None);
    assert_eq!(enriched_at, None);

    let unavailable = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        FixedResolver(DomainResolution::Unavailable),
    );
    assert_eq!(unavailable.enrich_pending_domains().await?, 1);
    let (_, _, enriched_at, attempts) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(enriched_at, None);
    assert_eq!(attempts, 1);

    sqlx::query("UPDATE crm_domain_directory SET enrichment_attempted_at = NULL")
        .execute(&pool)
        .await?;
    let worker = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        FixedResolver(DomainResolution::Resolved(Box::new(acme_metadata()))),
    );
    assert_eq!(worker.enrich_pending_domains().await?, 1);
    assert_eq!(worker.enrich_pending_domains().await?, 0);

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let team_a_company = repo
        .get_company_for_team(&team_a, &renamed.company.id, false)
        .await?
        .unwrap();
    assert_eq!(team_a_company.name.as_deref(), Some("Acme (ours)"));
    let team_b_company = repo
        .get_company_for_team(&team_b, &unnamed, false)
        .await?
        .unwrap();
    assert_eq!(team_b_company.name.as_deref(), Some("Acme Inc."));
    let (_, icon_url, enriched_at, _) = fetch_directory(&pool, "acme.com").await?.unwrap();
    assert_eq!(icon_url.as_deref(), Some("https://acme.com/logo.png"));
    assert!(enriched_at.is_some());
    Ok(())
}
