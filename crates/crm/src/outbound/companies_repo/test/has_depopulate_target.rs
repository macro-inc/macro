use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn true_only_for_a_contact_on_a_tracked_domain(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@owner.test";
    seed_team(&pool, team_id, owner_id).await?;
    let other_team_id = Uuid::now_v7();
    seed_team(&pool, other_team_id, "macro|other@other.test").await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;
    insert_contact_with_source(&pool, company_id, "Jane@Acme.test", link_id).await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    assert!(
        repo.has_depopulate_target(&team_id, "acme.test", "jane@acme.test")
            .await?
    );
    assert!(
        repo.has_depopulate_target(&team_id, "ACME.test", "JANE@acme.TEST")
            .await?
    );
    // Never in CRM: the common case for a fresh cleanup candidate.
    assert!(
        !repo
            .has_depopulate_target(&team_id, "acme.test", "stranger@acme.test")
            .await?
    );
    assert!(
        !repo
            .has_depopulate_target(&team_id, "example.com", "jane@example.com")
            .await?
    );
    assert!(
        !repo
            .has_depopulate_target(&other_team_id, "acme.test", "jane@acme.test")
            .await?
    );
    Ok(())
}

/// A contact no link sources is still a target: `depopulate_contact`
/// deletes it as an orphan even when the calling link never contributed it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn agrees_with_depopulate_contact(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let owner_id = "macro|owner@owner.test";
    seed_team(&pool, team_id, owner_id).await?;
    let link_id = insert_email_link(&pool, owner_id, "user@macro.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;
    insert_contact(&pool, company_id, "orphan@acme.test").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    assert!(
        repo.has_depopulate_target(&team_id, "acme.test", "orphan@acme.test")
            .await?
    );
    let outcome = repo
        .depopulate_contact(&team_id, &link_id, "acme.test", "orphan@acme.test")
        .await?;
    assert!(outcome.contact_deleted);
    assert!(outcome.company_deleted);

    assert!(
        !repo
            .has_depopulate_target(&team_id, "acme.test", "orphan@acme.test")
            .await?
    );
    let outcome = repo
        .depopulate_contact(&team_id, &link_id, "acme.test", "orphan@acme.test")
        .await?;
    assert!(!outcome.removed_anything());
    Ok(())
}

/// Without the domain lock the check would read past a populate's
/// uncommitted contact and report `false`, where `depopulate_contact`
/// would wait for the commit and tear the contact down.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn waits_for_an_in_flight_populate(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@owner.test").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;

    let mut populate = pool.begin().await?;
    let populate_pid = sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
        .fetch_one(&mut *populate)
        .await?;
    sqlx::query!(
        r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
        format!("{team_id}:acme.test"),
    )
    .execute(&mut *populate)
    .await?;
    sqlx::query!(
        r#"INSERT INTO crm_contacts (company_id, email, first_interaction, last_interaction)
           VALUES ($1, 'jane@acme.test', now(), now())"#,
        company_id,
    )
    .execute(&mut *populate)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let check = tokio::spawn(async move {
        repo.has_depopulate_target(&team_id, "acme.test", "jane@acme.test")
            .await
    });

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))
                ) AS "waiting!""#,
                populate_pid,
            )
            .fetch_one(&pool)
            .await?;
            if waiting {
                return anyhow::Ok(());
            }
            assert!(
                !check.is_finished(),
                "check did not wait for the domain lock"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;

    populate.commit().await?;
    assert!(check.await??);
    Ok(())
}
