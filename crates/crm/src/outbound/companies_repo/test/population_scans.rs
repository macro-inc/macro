use super::ContactWriteGate;
use super::helpers::*;
use crate::domain::{
    model::CrmError,
    service::{CrmService, CrmServiceImpl},
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::{DateTime, Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::{future::Future, sync::Arc};
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";
const CONTACT: &str = "person@client.example.com";
const PERSONAL_DOMAIN: &str = "gmail.com";

async fn setup(
    pool: &PgPool,
) -> anyhow::Result<(
    Uuid,
    Uuid,
    Arc<ContactWriteGate>,
    CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>,
)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    enable_crm_for_team(pool, team).await?;
    let link = insert_email_link(pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(pool, team, link).await?;
    let gate = Arc::new(ContactWriteGate::default());
    let mut repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.after_eligible_scan = Some(gate.clone());
    Ok((
        team,
        link,
        gate,
        CrmServiceImpl::new(repo, NoOpCompanyMetadataResolver),
    ))
}

/// Runs one population to completion and returns how many mailbox history
/// scans it ran: each scan that finds history stops at the gate until resumed.
async fn scans_during(
    gate: &ContactWriteGate,
    population: impl Future<Output = Result<(), CrmError>>,
) -> anyhow::Result<usize> {
    tokio::pin!(population);
    let mut scans = 0;
    loop {
        tokio::select! {
            outcome = &mut population => {
                outcome?;
                return Ok(scans);
            }
            () = gate.entered.notified() => {
                scans += 1;
                gate.resume.notify_one();
            }
        }
    }
}

async fn contact_interactions(
    pool: &PgPool,
    team: Uuid,
) -> anyhow::Result<Vec<(DateTime<Utc>, DateTime<Utc>)>> {
    Ok(sqlx::query!(
        "SELECT first_interaction, last_interaction FROM crm_contacts WHERE team_id = $1",
        team
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| (row.first_interaction, row.last_interaction))
    .collect())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_job_that_writes_scans_the_mailbox_history_once(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, gate, service) = setup(&pool).await?;
    let first = Utc::now() - Duration::days(30);
    let last = Utc::now() - Duration::days(1);
    insert_interaction(&pool, link, CONTACT, first, true).await?;
    insert_interaction(&pool, link, CONTACT, last, true).await?;

    let scans = scans_during(
        &gate,
        service.populate_contact(
            &team,
            &link,
            "owner@example.com",
            CONTACT,
            None,
            last,
            last,
            true,
        ),
    )
    .await?;

    assert_eq!(scans, 1);
    // The one scan still records the whole eligible history, not the job's date.
    let recorded = contact_interactions(&pool, team).await?;
    assert_eq!(recorded.len(), 1);
    assert_eq!(recorded[0].0.timestamp_micros(), first.timestamp_micros());
    assert_eq!(recorded[0].1.timestamp_micros(), last.timestamp_micros());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_job_that_changes_nothing_scans_no_history(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, gate, service) = setup(&pool).await?;
    let first = Utc::now() - Duration::days(30);
    let middle = Utc::now() - Duration::days(10);
    let last = Utc::now() - Duration::days(1);
    insert_interaction(&pool, link, CONTACT, first, true).await?;
    insert_interaction(&pool, link, CONTACT, last, true).await?;
    scans_during(
        &gate,
        service.populate_contact(
            &team,
            &link,
            "owner@example.com",
            CONTACT,
            None,
            first,
            last,
            true,
        ),
    )
    .await?;
    let recorded = contact_interactions(&pool, team).await?;

    // Another message's job inside the recorded range is a duplicate.
    insert_interaction(&pool, link, CONTACT, middle, true).await?;
    let duplicate = scans_during(
        &gate,
        service.populate_contact(
            &team,
            &link,
            "owner@example.com",
            CONTACT,
            None,
            middle,
            middle,
            true,
        ),
    )
    .await?;
    // Received mail from a domain the team doesn't track cannot file anyone.
    insert_interaction(&pool, link, "sender@untracked.example.com", last, false).await?;
    let untracked = scans_during(
        &gate,
        service.populate_contact(
            &team,
            &link,
            "owner@example.com",
            "sender@untracked.example.com",
            None,
            last,
            last,
            false,
        ),
    )
    .await?;

    assert_eq!((duplicate, untracked), (0, 0));
    assert_eq!(contact_interactions(&pool, team).await?, recorded);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_personal_address_the_team_keeps_out_scans_no_history(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, gate, service) = setup(&pool).await?;
    let personal = format!("jane@{PERSONAL_DOMAIN}");
    let at = Utc::now() - Duration::days(1);
    insert_interaction(&pool, link, &personal, at, true).await?;

    // Teams keep personal-provider addresses out of the CRM by default.
    let scans = scans_during(
        &gate,
        service.populate_contact(
            &team,
            &link,
            "owner@example.com",
            &personal,
            None,
            at,
            at,
            true,
        ),
    )
    .await?;

    assert_eq!(scans, 0);
    assert!(contact_interactions(&pool, team).await?.is_empty());
    Ok(())
}
