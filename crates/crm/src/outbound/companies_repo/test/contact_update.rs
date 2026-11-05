use super::helpers::*;
use crate::domain::{
    auth::CrmContactReceipt,
    companies_repo::CompaniesRepository,
    contact_update::ContactFieldUpdate,
    model::CrmError,
    service::{CrmService, CrmServiceImpl},
};
use crate::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
};
use entity_access::domain::models::{EditAccessLevel, TeamRole};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edits_preserve_contact_identity_history_archive_and_sources(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other = insert_company(&pool, team, true, &["example.org"]).await?;
    let link = insert_email_link(&pool, "macro|owner@example.com", "owner@example.com").await?;
    let id = insert_contact_with_source(&pool, company, "person@example.com", link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_contact_hidden(&team, &id, true).await?;
    let before = repo.get_contact_for_team(&team, &id, true).await?.unwrap();
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let access = CrmContactReceipt::<EditAccessLevel>::dangerously_internal(id, team);
    let edited = service
        .set_contact_email(&access, Some(" Changed@Example.org "))
        .await?;
    assert_eq!(edited.email.as_deref(), Some("changed@example.org"));
    assert_eq!(edited.id, before.id);
    assert_eq!(edited.company_id, before.company_id);
    assert_eq!(edited.first_interaction, before.first_interaction);
    assert_eq!(edited.last_interaction, before.last_interaction);
    assert_eq!(edited.created_at, before.created_at);
    assert!(edited.hidden);
    let moved = service.set_contact_company(&access, Some(other)).await?;
    assert_eq!(moved.company_id, Some(other));
    assert_eq!(moved.id, id);
    assert!(moved.hidden);
    let unlinked = service.set_contact_company(&access, None).await?;
    assert_eq!(unlinked.company_id, None);
    assert!(unlinked.hidden);
    let cleared = service.set_contact_email(&access, None).await?;
    assert_eq!(cleared.email, None);
    assert_eq!(cleared.id, id);
    let row = sqlx::query!(
        "SELECT team_id, manually_created FROM crm_contacts WHERE id = $1",
        id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(row.team_id, team);
    assert!(row.manually_created);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
            id
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    repo.depopulate_link_in_team(&team, &link).await?;
    assert!(repo.get_contact_for_team(&team, &id, true).await?.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edits_reject_duplicate_addresses_without_merging(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let id = insert_contact(&pool, company, "first@example.com").await?;
    let duplicate = insert_contact(&pool, company, "second@example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let error = repo
        .update_contact(
            &team,
            &id,
            &ContactFieldUpdate::Email(Some("second@example.com".into())),
            false,
        )
        .await;
    assert!(matches!(
        error,
        Err(CrmError::ContactAlreadyExistsForCompany)
    ));
    assert_eq!(
        repo.get_contact_for_team(&team, &id, false)
            .await?
            .unwrap()
            .email
            .as_deref(),
        Some("first@example.com")
    );
    assert!(
        repo.get_contact_for_team(&team, &duplicate, false)
            .await?
            .is_some()
    );
    repo.create_contact_for_team(
        &team,
        Some("first@example.com"),
        "Standalone",
        chrono::Utc::now(),
    )
    .await?;
    let error = repo
        .update_contact(&team, &id, &ContactFieldUpdate::Company(None), false)
        .await;
    assert!(matches!(
        error,
        Err(CrmError::ContactAlreadyExistsForCompany)
    ));
    assert_eq!(
        repo.get_contact_for_team(&team, &id, false)
            .await?
            .unwrap()
            .company_id,
        Some(company)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn edits_enforce_team_visibility_and_disabled_crm(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let foreign_team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    seed_team(&pool, foreign_team, "macro|other@example.org").await?;
    enable_crm_for_team(&pool, team).await?;
    enable_crm_for_team(&pool, foreign_team).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let foreign_company = insert_company(&pool, foreign_team, true, &["example.org"]).await?;
    let id = insert_contact(&pool, company, "person@example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let error = repo
        .update_contact(&foreign_team, &id, &ContactFieldUpdate::Email(None), true)
        .await;
    assert!(matches!(error, Err(CrmError::ContactNotFoundForTeam)));
    let error = repo
        .update_contact(
            &team,
            &id,
            &ContactFieldUpdate::Company(Some(foreign_company)),
            true,
        )
        .await;
    assert!(matches!(error, Err(CrmError::CompanyNotFoundForTeam)));
    repo.set_contact_hidden(&team, &id, true).await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let member = CrmContactReceipt::<EditAccessLevel>::dangerously_internal_with_role(
        id,
        team,
        TeamRole::Member,
    );
    assert!(matches!(
        service.set_contact_email(&member, None).await,
        Err(CrmError::ContactNotFoundForTeam)
    ));
    let owner = CrmContactReceipt::<EditAccessLevel>::dangerously_internal(id, team);
    assert!(matches!(
        service.set_contact_email(&owner, Some("invalid")).await,
        Err(CrmError::InvalidRequest(_))
    ));
    sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled = FALSE WHERE team_id = $1",
        team
    )
    .execute(&pool)
    .await?;
    assert!(matches!(
        service.set_contact_email(&owner, None).await,
        Err(CrmError::CrmDisabledForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn moving_cannot_reveal_a_contact_below_an_archived_company(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let destination = insert_company(&pool, team, true, &["example.org"]).await?;
    let id = insert_contact(&pool, company, "person@example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.set_company_hidden(&team, &destination, true).await?;
    assert!(matches!(
        repo.update_contact(
            &team,
            &id,
            &ContactFieldUpdate::Company(Some(destination)),
            true
        )
        .await,
        Err(CrmError::CompanyHidden)
    ));
    repo.set_company_hidden(&team, &company, true).await?;
    repo.set_contact_hidden(&team, &id, false).await?;
    assert!(matches!(
        repo.update_contact(&team, &id, &ContactFieldUpdate::Company(None), true)
            .await,
        Err(CrmError::CompanyHidden)
    ));
    assert_eq!(
        repo.get_contact_for_team(&team, &id, true)
            .await?
            .unwrap()
            .company_id,
        Some(company)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn single_and_bulk_teardown_keep_company_before_source_lock_order(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let link = insert_email_link(&pool, "macro|owner@example.com", "owner@example.com").await?;
    let id = insert_contact_with_source(&pool, company, "person@example.com", link).await?;
    let gate = std::sync::Arc::new(super::DepopulateSourceGate::default());
    let mut single_repo = CompaniesRepositoryImpl::new(pool.clone());
    single_repo.after_depopulate_source = Some(gate.clone());
    let single = tokio::spawn(async move {
        single_repo
            .depopulate_contact(&team, &link, "example.com", "person@example.com")
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), gate.entered.notified()).await?;
    // A source deletion must already hold the parent company lock. Otherwise
    // bulk teardown could take that lock and wait for this uncommitted source.
    let locked = sqlx::query!(
        "SELECT id FROM crm_companies WHERE id = $1 FOR UPDATE NOWAIT",
        company
    )
    .fetch_optional(&pool)
    .await;
    let parent_is_locked = locked.as_ref().is_err_and(|error| {
        error
            .as_database_error()
            .is_some_and(|db| db.code().as_deref() == Some("55P03"))
    });
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let bulk_repo = repo.clone();
    let bulk = tokio::spawn(async move { bulk_repo.depopulate_link_in_team(&team, &link).await });
    gate.resume.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        single.await??;
        bulk.await??;
        anyhow::Ok(())
    })
    .await??;
    assert!(
        parent_is_locked,
        "source deletion must hold its company lock"
    );
    assert!(repo.get_contact_for_team(&team, &id, true).await?.is_none());
    Ok(())
}
