use super::helpers::*;
use crate::domain::auth::CrmCompanyReceipt;
use crate::domain::companies_repo::*;
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::*;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use entity_access::domain::models::EditAccessLevel;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_toggles_flag(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team_id, &company_id, true).await?;
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));

    repo.set_company_hidden(&team_id, &company_id, false)
        .await?;
    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_returns_not_found_for_unknown_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .set_company_hidden(&team_id, &Uuid::now_v7(), true)
        .await;

    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_isolates_companies_across_teams(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|owner_a@test.com").await?;
    seed_team(&pool, team_b, "macro|owner_b@test.com").await?;
    let company_a = insert_company(&pool, team_a, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = repo.set_company_hidden(&team_b, &company_a, true).await;
    assert!(matches!(
        result,
        Err(crate::domain::model::CrmError::CompanyNotFoundForTeam)
    ));
    assert_eq!(fetch_company_hidden(&pool, company_a).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_company_hidden_true_soft_hides_contacts_and_disables_email_sync(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Hide flips the company flag, forces email_sync = false, and
    // cascades hidden = TRUE onto every contact. Contact rows AND
    // contact_sources are preserved so un-hide can restore them.
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let alice = insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    let bob = insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let access = CrmCompanyReceipt::<EditAccessLevel>::dangerously_internal(company_id, team_id);
    service.set_company_hidden(&access, true).await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(true));
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    // Contacts and sources preserved; both contacts now hidden.
    assert_eq!(count_contacts(&pool, company_id).await?, 2);
    assert_eq!(count_sources_for_company(&pool, company_id).await?, 2);
    assert_eq!(fetch_contact_hidden(&pool, alice).await?, Some(true));
    assert_eq!(fetch_contact_hidden(&pool, bob).await?, Some(true));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_company_hidden_false_cascades_contacts_visible(pool: PgPool) -> anyhow::Result<()> {
    // After un-hide, every contact under the company becomes visible —
    // including ones an admin previously hid individually. Cascade
    // overwrites individual hide state by design.
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@test.com";
    seed_team(&pool, team_id, owner_id).await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.com"]).await?;
    let link_id = insert_email_link(&pool, owner_id, "owner@macro.test").await?;
    let alice = insert_contact_with_source(&pool, company_id, "alice@acme.com", link_id).await?;
    let bob = insert_contact_with_source(&pool, company_id, "bob@acme.com", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // Individually hide `alice` before any company-level toggling.
    repo.set_contact_hidden(&team_id, &alice, true).await?;
    // Then hide the whole company (cascades `bob` to hidden too).
    repo.set_company_hidden(&team_id, &company_id, true).await?;
    assert_eq!(fetch_contact_hidden(&pool, alice).await?, Some(true));
    assert_eq!(fetch_contact_hidden(&pool, bob).await?, Some(true));

    // Un-hide cascades EVERY contact back to visible, blowing away
    // alice's individual hide too.
    repo.set_company_hidden(&team_id, &company_id, false)
        .await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));
    assert_eq!(fetch_contact_hidden(&pool, alice).await?, Some(false));
    assert_eq!(fetch_contact_hidden(&pool, bob).await?, Some(false));
    // Un-hide does NOT re-enable email_sync; that's a separate action.
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn service_set_company_hidden_false_does_not_re_enable_email_sync(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    // Start with hidden=true (via service, which also flipped sync off) then un-hide.
    let company_id = insert_company(&pool, team_id, false, &["acme.com"]).await?;
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(&pool)
        .await?;

    let service = CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    let access = CrmCompanyReceipt::<EditAccessLevel>::dangerously_internal(company_id, team_id);
    service.set_company_hidden(&access, false).await?;

    assert_eq!(fetch_company_hidden(&pool, company_id).await?, Some(false));
    // Un-hiding leaves email_sync alone — caller must re-enable it explicitly.
    assert_eq!(fetch_email_sync(&pool, company_id).await?, Some(false));
    Ok(())
}
