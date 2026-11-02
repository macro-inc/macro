use super::helpers::{enable_crm_for_team, seed_team};
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writer_protects_parent_and_settings_until_commit(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team_id).await?;

    let mut writer = pool.begin().await?;
    assert!(CompaniesRepositoryImpl::team_crm_enabled(&mut writer, &team_id).await?);
    let parent_error = sqlx::query!(
        "SELECT id FROM team WHERE id = $1 FOR UPDATE NOWAIT",
        team_id,
    )
    .fetch_one(&pool)
    .await
    .expect_err("team deletion must wait before cascading to settings");
    assert_eq!(
        parent_error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("55P03")
    );

    let now = Utc::now();
    let (company_id, created) = CompaniesRepositoryImpl::insert_company(
        &mut writer,
        &team_id,
        None,
        Some("Acme"),
        true,
        now,
        now,
    )
    .await?;
    assert!(created);

    // Other writers can share the settings lock while this write is uncommitted.
    assert!(
        sqlx::query_scalar!(
            "SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1 FOR SHARE NOWAIT",
            team_id,
        )
        .fetch_one(&pool)
        .await?
    );

    // Disable updates a non-key settings column; KEY SHARE would not protect it.
    let settings_error = sqlx::query!(
        "SELECT team_id FROM team_crm_settings WHERE team_id = $1 FOR NO KEY UPDATE NOWAIT",
        team_id,
    )
    .fetch_one(&pool)
    .await
    .expect_err("disable must wait for the writer's settings lock");
    assert_eq!(
        settings_error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("55P03")
    );

    writer.commit().await?;

    // Once creation commits, disable can flip the flag and purge that company.
    let mut disable = pool.begin().await?;
    sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled = FALSE WHERE team_id = $1",
        team_id,
    )
    .execute(&mut *disable)
    .await?;
    let purged = sqlx::query!("DELETE FROM crm_companies WHERE team_id = $1", team_id)
        .execute(&mut *disable)
        .await?;
    assert_eq!(purged.rows_affected(), 1);
    disable.commit().await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    assert!(
        repo.get_company_for_team(&team_id, &company_id, true)
            .await?
            .is_none()
    );
    assert!(matches!(
        repo.create_company_for_team(&team_id, None, "Acme", now)
            .await,
        Err(CrmError::CrmDisabledForTeam)
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creation_observes_concurrent_disable(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let mut disable = pool.begin().await?;
    sqlx::query!(
        "UPDATE team_crm_settings SET crm_enabled = FALSE WHERE team_id = $1",
        team_id,
    )
    .execute(&mut *disable)
    .await?;
    sqlx::query!("DELETE FROM crm_companies WHERE team_id = $1", team_id)
        .execute(&mut *disable)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let (creation, committed) = tokio::join!(
        repo.create_company_for_team(&team_id, None, "Acme", Utc::now()),
        disable.commit(),
    );
    committed?;
    assert!(matches!(creation, Err(CrmError::CrmDisabledForTeam)));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_companies WHERE team_id = $1",
            team_id
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creation_observes_concurrent_team_deletion(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team_id).await?;
    let mut deletion = pool.begin().await?;
    sqlx::query!("DELETE FROM team WHERE id = $1", team_id)
        .execute(&mut *deletion)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let (creation, committed) = tokio::join!(
        repo.create_company_for_team(&team_id, None, "Acme", Utc::now()),
        deletion.commit(),
    );
    committed?;
    assert!(matches!(creation, Err(CrmError::CrmDisabledForTeam)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_parent_or_settings_is_disabled(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let mut missing_parent = pool.begin().await?;
    assert!(!CompaniesRepositoryImpl::team_crm_enabled(&mut missing_parent, &team_id).await?);
    missing_parent.rollback().await?;

    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let mut missing_settings = pool.begin().await?;
    assert!(!CompaniesRepositoryImpl::team_crm_enabled(&mut missing_settings, &team_id).await?);
    missing_settings.rollback().await?;
    Ok(())
}
