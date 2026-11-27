//! The operator-run pass that files a team's manual contacts under the
//! companies for their email domains.

use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::contact_filing::{ContactFilingBatch, ContactFilingService};
use crate::domain::contact_update::ContactFieldUpdate;
use crate::domain::service::CrmServiceImpl;
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

fn service(pool: &PgPool) -> CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver> {
    CrmServiceImpl::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    )
}

async fn company_of(pool: &PgPool, contact: Uuid) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar("SELECT company_id FROM crm_contacts WHERE id = $1")
        .bind(contact)
        .fetch_one(pool)
        .await
}

async fn count(pool: &PgPool, table: &str, team: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE team_id = $1"))
        .bind(team)
        .fetch_one(pool)
        .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn files_each_contact_by_its_domain_and_counts_what_it_left(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    seed_team(&pool, other_team, "macro|other@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    enable_crm_for_team(&pool, other_team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let now = Utc::now();

    let tracked = insert_company(&pool, team, true, &["tracked.example.com"]).await?;
    let hidden = insert_company(&pool, team, true, &["hidden.example.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await?;
    repo.block_domain(&team, "blocked.example.com").await?;
    insert_contact(&pool, tracked, "taken@tracked.example.com").await?;

    let mut made = Vec::new();
    for email in [
        "joins@tracked.example.com",
        "first@new.example.com",
        "second@new.example.com",
        concat!("person@", "gmail.com"),
        concat!("bot@", "github.com"),
        "x@blocked.example.com",
        "x@hidden.example.com",
        "taken@tracked.example.com",
    ] {
        let contact = repo
            .create_contact_for_team(&team, Some(email), "Contact", now)
            .await?;
        made.push(contact.id);
    }
    let nameless = repo
        .create_contact_for_team(&team, None, "Nameless", now)
        .await?;
    let foreign = repo
        .create_contact_for_team(&other_team, Some("x@new.example.com"), "Foreign", now)
        .await?;
    let archived = repo
        .create_contact_for_team(&team, Some("archived@tracked.example.com"), "Archived", now)
        .await?;
    repo.set_contact_hidden(&team, &archived.id, true).await?;

    // Email sync files a personal address without a company. Such a contact
    // is sync's decision, even if its address were a company's.
    let synced: Uuid = sqlx::query_scalar(
        "INSERT INTO crm_contacts (team_id, email, first_interaction, last_interaction)
         VALUES ($1, 'synced@tracked.example.com', now(), now()) RETURNING id",
    )
    .bind(team)
    .fetch_one(&pool)
    .await?;

    let expected = ContactFilingBatch {
        examined: 10,
        filed: 3,
        companies_created: 1,
        skipped_not_manual: 1,
        skipped_archived: 1,
        skipped_provider_domain: 2,
        skipped_blocked_domain: 1,
        skipped_hidden_company: 1,
        skipped_duplicate_address: 1,
        skipped_changed: 0,
        failed: 0,
        next_after: None,
    };

    // A dry run reports the same counts and writes nothing.
    let dry = service(&pool)
        .file_unfiled_contacts(team, None, 100, true)
        .await?;
    assert_eq!(dry, expected);
    for id in &made {
        assert_eq!(company_of(&pool, *id).await?, None);
    }
    assert_eq!(count(&pool, "crm_companies", team).await?, 2);
    let directory: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM crm_domain_directory WHERE domain = 'new.example.com'",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(directory, 0);

    let run = service(&pool)
        .file_unfiled_contacts(team, None, 100, false)
        .await?;
    assert_eq!(run, expected);

    let created = fetch_company_for_domain(&pool, team, "new.example.com")
        .await?
        .expect("company created for new.example.com");
    assert_eq!(company_of(&pool, made[0]).await?, Some(tracked));
    assert_eq!(company_of(&pool, made[1]).await?, Some(created));
    assert_eq!(company_of(&pool, made[2]).await?, Some(created));
    for left in &made[3..] {
        assert_eq!(company_of(&pool, *left).await?, None);
    }
    assert_eq!(company_of(&pool, nameless.id).await?, None);
    assert_eq!(company_of(&pool, foreign.id).await?, None);
    assert_eq!(company_of(&pool, synced).await?, None);

    // An archived contact is left as it is, even at a tracked domain.
    assert_eq!(company_of(&pool, archived.id).await?, None);
    assert_eq!(fetch_contact_hidden(&pool, archived.id).await?, Some(true));

    // Filing reads no mail.
    let sources: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM crm_contact_sources")
        .fetch_one(&pool)
        .await?;
    assert_eq!(sources, 0);

    // A second run finds only the contacts the first one left.
    let again = service(&pool)
        .file_unfiled_contacts(team, None, 100, false)
        .await?;
    assert_eq!(
        again,
        ContactFilingBatch {
            examined: 7,
            filed: 0,
            companies_created: 0,
            ..expected
        }
    );
    assert_eq!(count(&pool, "crm_companies", team).await?, 3);
    assert_eq!(count(&pool, "crm_companies", other_team).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batches_page_through_the_team(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    for email in [
        concat!("a@", "gmail.com"),
        "b@one.example.com",
        concat!("c@", "gmail.com"),
        "d@two.example.com",
        "e@one.example.com",
    ] {
        repo.create_contact_for_team(&team, Some(email), "Contact", Utc::now())
            .await?;
    }

    let mut after = None;
    let mut filed = 0;
    let mut examined = 0;
    let mut batches = 0;
    loop {
        let batch = service(&pool)
            .file_unfiled_contacts(team, after.as_deref(), 2, false)
            .await?;
        filed += batch.filed;
        examined += batch.examined;
        batches += 1;
        after = batch.next_after;
        if after.is_none() {
            break;
        }
    }

    assert_eq!((batches, examined, filed), (3, 5, 3));
    assert_eq!(count(&pool, "crm_companies", team).await?, 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_filed_contact_is_tied_to_its_company_like_a_synced_one(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let contact = repo
        .create_contact_for_team(&team, Some("jane@example.com"), "Jane", Utc::now())
        .await?;

    service(&pool)
        .file_unfiled_contacts(team, None, 100, false)
        .await?;

    let filed = repo
        .get_contact_for_team(&team, &contact.id, true)
        .await?
        .expect("contact kept");
    assert_eq!(filed.id, contact.id);
    assert_eq!(filed.company_domain_emails, ["jane@example.com"]);
    assert!(
        repo.update_contact(&team, &contact.id, &ContactFieldUpdate::NoCompany, true)
            .await
            .is_err()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_archived_contact_stays_without_a_company(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@example.com").await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let archived = repo
        .create_contact_for_team(
            &team,
            Some("archived@gone.example.com"),
            "Archived",
            Utc::now(),
        )
        .await?;
    repo.set_contact_hidden(&team, &archived.id, true).await?;

    for dry_run in [true, false] {
        let batch = service(&pool)
            .file_unfiled_contacts(team, None, 100, dry_run)
            .await?;
        assert_eq!(
            (batch.examined, batch.filed, batch.companies_created),
            (1, 0, 0)
        );
        assert_eq!(batch.skipped_archived, 1);
    }

    // Email sync never creates a company for an archived contact, and
    // neither does filing: no company appears for the domain.
    assert_eq!(company_of(&pool, archived.id).await?, None);
    assert_eq!(
        fetch_company_for_domain(&pool, team, "gone.example.com").await?,
        None
    );
    assert_eq!(fetch_contact_hidden(&pool, archived.id).await?, Some(true));
    Ok(())
}
