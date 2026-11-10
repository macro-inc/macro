use super::helpers::{insert_company, insert_contact, seed_team};
use crate::domain::contact_phones::{ContactPhone, ContactPhonesRepository, PhoneSource};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use phone_number::PhoneNumber;
use sqlx::PgPool;
use uuid::Uuid;

fn numbers(phones: &[ContactPhone]) -> Vec<(&str, PhoneSource)> {
    phones
        .iter()
        .map(|phone| (phone.phone.as_str(), phone.source))
        .collect()
}

fn phone(text: &str) -> PhoneNumber {
    PhoneNumber::parse(text).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn editing_a_contact_s_numbers_keeps_the_source_of_numbers_it_keeps(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.example"]).await?;
    let contact_id = insert_contact(&pool, company_id, "jane@acme.example").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    assert_eq!(
        repo.contact_phones(&team_id, &contact_id, false).await?,
        Some(vec![])
    );
    let added = repo
        .add_contact_phones(
            &team_id,
            &[(contact_id, phone("+1555010"))],
            PhoneSource::Call,
        )
        .await?;
    assert_eq!(added, 1);

    let phones = repo
        .set_contact_phones(
            &team_id,
            &contact_id,
            &[phone("+1555010"), phone("+4420123")],
            false,
        )
        .await?
        .unwrap();
    assert_eq!(
        numbers(&phones),
        [
            ("+1555010", PhoneSource::Call),
            ("+4420123", PhoneSource::Manual)
        ]
    );

    let phones = repo
        .set_contact_phones(&team_id, &contact_id, &[phone("+4420123")], false)
        .await?
        .unwrap();
    assert_eq!(numbers(&phones), [("+4420123", PhoneSource::Manual)]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn companyless_contact_phones_keep_team_and_visibility_guards(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    let contact_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@example.com").await?;
    seed_team(&pool, other_team, "macro|other@example.com").await?;
    sqlx::query!(
        r#"INSERT INTO crm_contacts (id, team_id, name, first_interaction, last_interaction)
           VALUES ($1, $2, 'Contact', now(), now())"#,
        contact_id,
        team_id,
    )
    .execute(&pool)
    .await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    assert_eq!(
        repo.contact_phones(&team_id, &contact_id, false).await?,
        Some(vec![])
    );
    assert_eq!(
        repo.add_contact_phones(
            &team_id,
            &[(contact_id, phone("+1555010"))],
            PhoneSource::Csv
        )
        .await?,
        1
    );
    let saved = repo
        .set_contact_phones(
            &team_id,
            &contact_id,
            &[phone("+1555010"), phone("+4420123")],
            false,
        )
        .await?
        .unwrap();
    assert_eq!(
        numbers(&saved),
        [
            ("+1555010", PhoneSource::Csv),
            ("+4420123", PhoneSource::Manual)
        ]
    );
    assert_eq!(
        repo.contact_phones(&other_team, &contact_id, true).await?,
        None
    );
    assert_eq!(
        repo.set_contact_phones(&other_team, &contact_id, &[], true)
            .await?,
        None
    );
    assert_eq!(
        repo.add_contact_phones(
            &other_team,
            &[(contact_id, phone("+1555011"))],
            PhoneSource::Csv
        )
        .await?,
        0
    );

    sqlx::query!(
        "UPDATE crm_contacts SET hidden = TRUE WHERE id = $1",
        contact_id
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        repo.contact_phones(&team_id, &contact_id, false).await?,
        None
    );
    assert_eq!(
        repo.set_contact_phones(&team_id, &contact_id, &[], false)
            .await?,
        None
    );
    assert_eq!(
        repo.contact_phones(&team_id, &contact_id, true).await?,
        Some(saved)
    );
    Ok(())
}
