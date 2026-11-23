use super::helpers::seed_team;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writer_protects_parent_without_requiring_email_settings(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let mut writer = pool.begin().await?;
    assert!(CompaniesRepositoryImpl::team_exists(&mut writer, &team_id).await?);
    let error = sqlx::query!(
        "SELECT id FROM team WHERE id = $1 FOR UPDATE NOWAIT",
        team_id
    )
    .fetch_one(&pool)
    .await
    .expect_err("team deletion waits for the writer");
    assert_eq!(
        error
            .as_database_error()
            .and_then(|error| error.code())
            .as_deref(),
        Some("55P03")
    );
    writer.commit().await?;
    let mut deletion = pool.begin().await?;
    sqlx::query!(
        "SELECT id FROM team WHERE id = $1 FOR UPDATE NOWAIT",
        team_id
    )
    .fetch_one(&mut *deletion)
    .await?;
    deletion.rollback().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn missing_parent_cannot_admit_a_writer(pool: PgPool) -> anyhow::Result<()> {
    let mut writer = pool.begin().await?;
    assert!(!CompaniesRepositoryImpl::team_exists(&mut writer, &Uuid::now_v7()).await?);
    Ok(())
}
