use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_enable_and_disable_abort_before_purge_with_or_without_settings(
    pool: PgPool,
) -> anyhow::Result<()> {
    let user = "macro|rollout@example.com";
    let macro_user = Uuid::now_v7();
    let team = Uuid::now_v7();
    let company = Uuid::now_v7();
    let linked = Uuid::now_v7();
    let independent = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user,
        user
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        macro_user
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Rollout fixture', $2)",
        team,
        user
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction) VALUES ($1, $2, now(), now())", company, team).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, 'example.com')",
        company,
        team
    )
    .execute(&pool)
    .await?;
    sqlx::query!("INSERT INTO crm_contacts (id, team_id, company_id, email, first_interaction, last_interaction) VALUES ($1, $2, $3, 'linked@example.com', now(), now()), ($4, $2, NULL, 'independent@example.com', now(), now())", linked, team, company, independent).execute(&pool).await?;
    // This is the concrete repository used by old deployed binaries; retain its
    // exact upsert-and-purge transaction as the compatibility regression.
    let old = TeamCrmSettingsRepositoryImpl::new(pool.clone());
    sqlx::query!("INSERT INTO team_crm_settings (team_id) VALUES ($1)", team)
        .execute(&pool)
        .await?;
    for settings_exist in [true, false] {
        if !settings_exist {
            sqlx::query!("DELETE FROM team_crm_settings WHERE team_id=$1", team)
                .execute(&pool)
                .await?;
        }
        for error in [
            old.disable_crm_and_purge_data(&team).await.unwrap_err(),
            old.enable_crm(&team).await.unwrap_err(),
        ] {
            let TeamError::StorageLayerError(error) = error else {
                panic!("expected retired-switch storage rejection")
            };
            let error = error.downcast_ref::<sqlx::Error>().unwrap();
            assert_eq!(
                error.as_database_error().and_then(|e| e.code()).as_deref(),
                Some("55000")
            );
        }
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM crm_companies WHERE id=$1", company)
                .fetch_one(&pool)
                .await?,
            Some(1)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM crm_contacts WHERE id IN ($1,$2)",
                linked,
                independent
            )
            .fetch_one(&pool)
            .await?,
            Some(2)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM crm_domains WHERE company_id=$1",
                company
            )
            .fetch_one(&pool)
            .await?,
            Some(1)
        );
        assert!(!old.get_crm_enabled(&team).await?);
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT count(*) FROM crm_email_consent WHERE team_id=$1",
                team
            )
            .fetch_one(&pool)
            .await?,
            Some(0)
        );
    }
    // Statement-level protection must apply even when no row can be updated.
    let error = sqlx::query!("UPDATE team_crm_settings SET crm_enabled=FALSE WHERE FALSE")
        .execute(&pool)
        .await
        .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55000")
    );
    // It is not a global deletion guard: ordinary record deletion and actual
    // team deletion/cascades remain available under their existing authorization.
    sqlx::query!("DELETE FROM crm_companies WHERE id=$1", company)
        .execute(&pool)
        .await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE id=$1", independent)
            .fetch_one(&pool)
            .await?,
        Some(1)
    );
    sqlx::query!("DELETE FROM team WHERE id=$1", team)
        .execute(&pool)
        .await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE id=$1", independent)
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}
