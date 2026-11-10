use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::CrmError;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

/// Whether another transaction holds the advisory lock on `key`.
async fn advisory_lock_held(pool: &PgPool, key: &str) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let acquired = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "acquired!""#,
        key
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.rollback().await?;
    Ok(!acquired)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn population_scans_the_mailbox_before_taking_the_domain_lock(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let now = Utc::now();
    insert_interaction(&pool, link, "pat@acme.example.com", now, true).await?;
    insert_interaction(&pool, link, "sam@acme.example.com", now, true).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let gate = std::sync::Arc::new(super::ContactWriteGate::default());
    let mut gated = repo.clone();
    gated.after_eligible_scan = Some(gate.clone());
    let parked = tokio::spawn(async move {
        gated
            .populate_contact(
                &team,
                &link,
                "acme.example.com",
                "pat@acme.example.com",
                None,
                now,
                now,
                true,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), gate.entered.notified()).await?;

    assert!(
        !advisory_lock_held(&pool, &format!("{team}:acme.example.com")).await?,
        "the domain lock must be free while a population scans the mailbox"
    );
    assert!(
        advisory_lock_held(
            &pool,
            &format!("crm-contact:{team}:{link}:pat@acme.example.com")
        )
        .await?,
        "the scan holds its contact lock, so teardown of the address waits for it"
    );
    // Another address on the same domain populates while the first is parked.
    tokio::time::timeout(
        Duration::from_secs(10),
        repo.populate_contact(
            &team,
            &link,
            "acme.example.com",
            "sam@acme.example.com",
            None,
            now,
            now,
            true,
        ),
    )
    .await??;

    gate.resume.notify_one();
    tokio::time::timeout(Duration::from_secs(10), parked).await???;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .expect("the populations created the company");
    assert!(
        fetch_contact_id(&pool, company, "pat@acme.example.com")
            .await?
            .is_some()
    );
    assert!(
        fetch_contact_id(&pool, company, "sam@acme.example.com")
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn population_behind_a_held_domain_lock_gives_up_as_contended(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let now = Utc::now();
    insert_interaction(&pool, link, "pat@acme.example.com", now, true).await?;

    let mut holder = pool.begin().await?;
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        format!("{team}:acme.example.com")
    )
    .execute(&mut *holder)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let result = tokio::time::timeout(
        Duration::from_secs(30),
        repo.populate_contact(
            &team,
            &link,
            "acme.example.com",
            "pat@acme.example.com",
            None,
            now,
            now,
            true,
        ),
    )
    .await?;
    holder.rollback().await?;

    assert!(
        matches!(result, Err(CrmError::Contended)),
        "a population must stop waiting and be retried, got {result:?}"
    );
    assert!(
        fetch_company_for_domain(&pool, team, "acme.example.com")
            .await?
            .is_none()
    );
    Ok(())
}
