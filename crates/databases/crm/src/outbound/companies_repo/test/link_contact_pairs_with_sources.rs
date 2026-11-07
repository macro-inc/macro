use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

/// Sorted set form, so assertions don't depend on row order.
fn as_set(pairs: Vec<(Uuid, String)>) -> HashSet<(Uuid, String)> {
    pairs.into_iter().collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keeps_only_pairs_backed_by_a_source_row(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    // Tracked by this link.
    insert_contact_with_source(&pool, company_id, "jane@acme.com", link_id).await?;
    // In CRM, but no source row for any link.
    insert_contact(&pool, company_id, "orphan@acme.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let got = repo
        .link_contact_pairs_with_sources(&[
            (link_id, "jane@acme.com".to_string()),
            (link_id, "orphan@acme.com".to_string()),
            // Never in CRM at all — the common case the cleanup job prunes.
            (link_id, "stranger@example.com".to_string()),
        ])
        .await?;

    assert_eq!(
        as_set(got),
        HashSet::from([(link_id, "jane@acme.com".to_string())])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn does_not_match_a_source_owned_by_a_different_link(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let link_a = insert_email_link(&pool, owner_id, "a@macro.com").await?;
    let link_b = insert_email_link(&pool, owner_id, "b@macro.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    insert_contact_with_source(&pool, company_id, "jane@acme.com", link_a).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let got = repo
        .link_contact_pairs_with_sources(&[
            (link_a, "jane@acme.com".to_string()),
            (link_b, "jane@acme.com".to_string()),
        ])
        .await?;

    // link_b contributed nothing for this contact, so it has nothing to tear down.
    assert_eq!(
        as_set(got),
        HashSet::from([(link_a, "jane@acme.com".to_string())])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn matches_case_insensitively_and_returns_lowercased(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    insert_contact_with_source(&pool, company_id, "Jane@Acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let got = repo
        .link_contact_pairs_with_sources(&[(link_id, "JANE@acme.COM".to_string())])
        .await?;

    assert_eq!(
        as_set(got),
        HashSet::from([(link_id, "jane@acme.com".to_string())])
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_input_is_a_no_op(pool: PgPool) -> anyhow::Result<()> {
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    assert!(repo.link_contact_pairs_with_sources(&[]).await?.is_empty());
    Ok(())
}
