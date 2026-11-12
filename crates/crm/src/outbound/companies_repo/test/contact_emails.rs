//! A contact that holds several addresses: the edits that add, remove and
//! choose them, company unlinking, and sync and teardown across them.

use super::helpers::*;
use crate::domain::{
    auth::CrmContactReceipt,
    companies_repo::CompaniesRepository,
    contact_update::ContactFieldUpdate,
    model::{CrmContact, CrmError, CrmTeamSettingsPatch},
    service::{CrmService, CrmServiceImpl},
};
use crate::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
};
use chrono::{Duration, Utc};
use entity_access::domain::models::{EditAccessLevel, TeamRole};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|user@macro.com";

/// A consumer provider; no reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

type Service = CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>;

fn personal(local: &str) -> String {
    format!("{local}@{PERSONAL_DOMAIN}")
}

/// A team whose owner contributes one mailbox to the CRM.
async fn team_with_mailbox(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Service)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    enable_crm_for_team(pool, team).await?;
    let link = insert_email_link(pool, OWNER, "user@macro.com").await?;
    consent_to_mailbox(pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    Ok((
        team,
        link,
        CrmServiceImpl::new(repo, NoOpCompanyMetadataResolver),
    ))
}

/// Store one message with `email` in the mailbox, then deliver its CRM job.
async fn sync(
    pool: &PgPool,
    service: &Service,
    team: Uuid,
    link: Uuid,
    email: &str,
    sent: bool,
) -> anyhow::Result<()> {
    let now = Utc::now();
    insert_interaction(pool, link, email, now, sent).await?;
    service
        .populate_contact(
            &team,
            &link,
            "user@macro.com",
            email,
            Some("Synced Name"),
            now - Duration::days(1),
            now,
            sent,
        )
        .await?;
    Ok(())
}

async fn team_contact_count(pool: &PgPool, team: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM crm_contacts WHERE team_id = $1"#,
        team
    )
    .fetch_one(pool)
    .await
}

async fn source_count(pool: &PgPool, contact: Uuid, link: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM crm_contact_sources
           WHERE contact_id = $1 AND link_id = $2"#,
        contact,
        link
    )
    .fetch_one(pool)
    .await
}

async fn add(
    repo: &CompaniesRepositoryImpl,
    team: Uuid,
    contact: Uuid,
    email: &str,
) -> Result<CrmContact, CrmError> {
    repo.update_contact(
        &team,
        &contact,
        &ContactFieldUpdate::AddEmail(email.to_owned()),
        true,
    )
    .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn addresses_are_added_chosen_and_removed_without_touching_the_record(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team, true, &["example.org"]).await?;
    let first = personal("first");
    let second = personal("second");
    let id = insert_contact_with_source(&pool, company, &first, link).await?;
    let before = repo.get_contact_for_team(&team, &id, true).await?.unwrap();
    assert_eq!(before.emails, std::slice::from_ref(&first));
    let access = CrmContactReceipt::<EditAccessLevel>::dangerously_internal(id, team);

    let added = service
        .add_contact_email(&access, &format!(" {} ", second.to_uppercase()))
        .await?;
    assert_eq!(added.email.as_deref(), Some(first.as_str()));
    assert_eq!(added.emails, [first.clone(), second.clone()]);
    assert_eq!(
        service.add_contact_email(&access, &second).await?.emails,
        added.emails,
        "an identical retry changes nothing"
    );
    let found = repo
        .get_contact_by_email_for_team(&team, &second, true)
        .await?
        .unwrap();
    assert_eq!(found.id, id);

    let chosen = service.set_contact_email(&access, &second).await?;
    assert_eq!(chosen.email.as_deref(), Some(second.as_str()));
    assert_eq!(chosen.emails, [second.clone(), first.clone()]);

    // Removing the primary promotes the oldest address left.
    let removed = service.remove_contact_email(&access, &second).await?;
    assert_eq!(removed.email.as_deref(), Some(first.as_str()));
    assert_eq!(removed.emails, std::slice::from_ref(&first));
    assert!(
        repo.get_contact_by_email_for_team(&team, &second, true)
            .await?
            .is_none(),
        "a removed address no longer finds the contact"
    );
    assert_eq!(
        service.remove_contact_email(&access, &second).await?.emails,
        removed.emails,
        "an identical retry changes nothing"
    );

    let emptied = service.remove_contact_email(&access, &first).await?;
    assert_eq!(emptied.email, None);
    assert!(emptied.emails.is_empty());

    assert_eq!(emptied.id, before.id);
    assert_eq!(emptied.company_id, before.company_id);
    assert_eq!(emptied.created_at, before.created_at);
    assert_eq!(emptied.first_interaction, before.first_interaction);
    assert_eq!(source_count(&pool, id, link).await?, 1);
    assert!(matches!(
        service.add_contact_email(&access, "not an address").await,
        Err(CrmError::InvalidRequest(_))
    ));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_added_address_must_be_free_across_the_team(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other_company = insert_company(&pool, team, true, &["example.org"]).await?;
    let id = insert_contact(&pool, company, "first@example.com").await?;
    let other = insert_contact(&pool, other_company, "second@example.org").await?;
    add(&repo, team, other, "alias@example.net").await?;

    // Neither another contact's primary nor one of its further addresses.
    for taken in ["second@example.org", "alias@example.net"] {
        assert!(matches!(
            add(&repo, team, id, taken).await,
            Err(CrmError::ContactAlreadyExistsForTeam)
        ));
        assert!(matches!(
            repo.update_contact(&team, &id, &ContactFieldUpdate::Email(taken.into()), true)
                .await,
            Err(CrmError::ContactAlreadyExistsForTeam)
        ));
    }
    assert_eq!(
        repo.get_contact_for_team(&team, &id, true)
            .await?
            .unwrap()
            .emails,
        ["first@example.com"]
    );

    // A member is not told that a restricted contact holds the address.
    repo.set_contact_hidden(&team, &other, true).await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let member = CrmContactReceipt::<EditAccessLevel>::dangerously_internal_with_role(
        id,
        team,
        TeamRole::Member,
    );
    assert!(matches!(
        service.add_contact_email(&member, "alias@example.net").await,
        Err(CrmError::InvalidRequest(message)) if message == "contact change unavailable"
    ));

    // Another team's contacts never conflict.
    let foreign = Uuid::now_v7();
    seed_team(&pool, foreign, "macro|other@example.org").await?;
    enable_crm_for_team(&pool, foreign).await?;
    let foreign_contact = repo
        .create_contact_for_team(&foreign, None, "Other", Utc::now())
        .await?;
    assert!(
        add(&repo, foreign, foreign_contact.id, "alias@example.net")
            .await
            .is_ok()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_adds_of_one_address_reach_one_contact(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let first = repo
        .create_contact_for_team(&team, Some("first@example.com"), "First", Utc::now())
        .await?;
    let second = repo
        .create_contact_for_team(&team, Some("second@example.org"), "Second", Utc::now())
        .await?;

    let (a, b) = tokio::join!(
        add(&repo, team, first.id, "shared@example.net"),
        add(&repo, team, second.id, "shared@example.net")
    );

    assert_ne!(a.is_ok(), b.is_ok());
    assert!(matches!(
        a.and(b),
        Err(CrmError::ContactAlreadyExistsForTeam)
    ));
    let holders = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM crm_contact_emails
           WHERE email = 'shared@example.net'"#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(holders, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_company_domain_contact_stays_linked_and_keeps_its_tie(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other = insert_company(&pool, team, true, &["example.org"]).await?;
    let id = insert_contact(&pool, company, "jane@example.com").await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let access = CrmContactReceipt::<EditAccessLevel>::dangerously_internal(id, team);
    let alias = personal("jane");

    // It can gain a further address and even make it the primary.
    service.add_contact_email(&access, &alias).await?;
    let tied = service.set_contact_email(&access, &alias).await?;
    assert_eq!(tied.company_domain_emails, ["jane@example.com"]);
    assert!(tied.has_personal_email());

    assert!(matches!(
        service.unlink_contact_company(&access).await,
        Err(CrmError::InvalidRequest(message))
            if message == "a contact on its company's domain cannot be unlinked"
    ));
    assert!(matches!(
        service.set_contact_company(&access, other).await,
        Err(CrmError::InvalidRequest(message))
            if message == "a contact on its company's domain cannot change company"
    ));
    assert!(matches!(
        service.remove_contact_email(&access, "jane@example.com").await,
        Err(CrmError::InvalidRequest(message))
            if message == "this address links the contact to its company and cannot be removed"
    ));

    // A second address on the company's domain frees the first.
    service
        .add_contact_email(&access, "j.doe@example.com")
        .await?;
    let freed = service
        .remove_contact_email(&access, "jane@example.com")
        .await?;
    assert_eq!(freed.company_domain_emails, ["j.doe@example.com"]);
    assert_eq!(freed.company_id, Some(company));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_linked_personal_contact_can_be_unlinked(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let email = personal("contact");
    let id = insert_contact_with_source(&pool, company, &email, link).await?;
    let access = CrmContactReceipt::<EditAccessLevel>::dangerously_internal(id, team);

    let unlinked = service.unlink_contact_company(&access).await?;

    assert_eq!(unlinked.company_id, None);
    assert_eq!(unlinked.id, id);
    assert_eq!(unlinked.email.as_deref(), Some(email.as_str()));
    assert_eq!(source_count(&pool, id, link).await?, 1);
    assert_eq!(
        service.unlink_contact_company(&access).await?.company_id,
        None,
        "an identical retry changes nothing"
    );
    // Teardown of the mailbox keeps an edited contact.
    repo.depopulate_link_in_team(&team, &link).await?;
    assert!(repo.get_contact_for_team(&team, &id, true).await?.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unlinking_cannot_reveal_or_duplicate_a_contact(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other = insert_company(&pool, team, true, &["example.org"]).await?;
    let email = personal("contact");
    let id = insert_contact(&pool, company, &email).await?;

    // The same address under another company predates the rule; unlinking
    // would leave two contacts that sync cannot tell apart.
    let duplicate = insert_contact(&pool, other, &email).await?;
    assert!(matches!(
        repo.update_contact(&team, &id, &ContactFieldUpdate::NoCompany, true)
            .await,
        Err(CrmError::ContactAlreadyExistsForTeam)
    ));
    sqlx::query!("DELETE FROM crm_contacts WHERE id = $1", duplicate)
        .execute(&pool)
        .await?;

    // Leaving an archived company would restore a visible contact.
    repo.set_company_hidden(&team, &company, true).await?;
    repo.set_contact_hidden(&team, &id, false).await?;
    assert!(matches!(
        repo.update_contact(&team, &id, &ContactFieldUpdate::NoCompany, true)
            .await,
        Err(CrmError::CompanyHidden)
    ));
    assert!(matches!(
        repo.update_contact(&team, &id, &ContactFieldUpdate::NoCompany, false)
            .await,
        Err(CrmError::ContactNotFoundForTeam)
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
async fn company_sync_refreshes_the_contact_that_holds_a_further_address(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    let id = fetch_contact_id(&pool, company, "jane@acme.example.com")
        .await?
        .unwrap();
    add(&repo, team, id, "j.doe@acme.example.com").await?;
    let before = repo.get_contact_for_team(&team, &id, true).await?.unwrap();

    // Mail from the further address, in both directions.
    for sent in [true, false] {
        sync(&pool, &service, team, link, "j.doe@acme.example.com", sent).await?;
        assert_eq!(count_contacts(&pool, company).await?, 1);
    }
    let after = repo.get_contact_for_team(&team, &id, true).await?.unwrap();
    assert!(after.last_interaction > before.last_interaction);
    assert_eq!(after.email.as_deref(), Some("jane@acme.example.com"));

    // After the primary changes, mail from the previous primary still
    // reaches the same contact.
    repo.update_contact(
        &team,
        &id,
        &ContactFieldUpdate::Email("j.doe@acme.example.com".into()),
        true,
    )
    .await?;
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert_eq!(team_contact_count(&pool, team).await?, 1);
    assert_eq!(source_count(&pool, id, link).await?, 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_sync_reaches_a_further_address_held_outside_its_domain(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let contact = repo
        .create_contact_for_team(&team, Some("jane@example.net"), "Jane", Utc::now())
        .await?;
    add(&repo, team, contact.id, "jane@acme.example.com").await?;

    // Received mail alone never files a contact, but it refreshes one.
    for sent in [false, true] {
        sync(&pool, &service, team, link, "jane@acme.example.com", sent).await?;
        assert_eq!(team_contact_count(&pool, team).await?, 1);
        assert_eq!(
            fetch_company_for_domain(&pool, team, "acme.example.com").await?,
            None,
            "the address belongs to a person, not to a company to create"
        );
        assert_eq!(source_count(&pool, contact.id, link).await?, 1);
    }
    let after = repo
        .get_contact_for_team(&team, &contact.id, true)
        .await?
        .unwrap();
    assert!(after.last_interaction > contact.last_interaction);
    assert_eq!(after.name.as_deref(), Some("Jane"));

    // Teardown finds the same contact once the mailbox has no such mail.
    assert!(
        service
            .has_depopulate_target(&team, "jane@acme.example.com")
            .await?
    );
    let outcome = service
        .depopulate_contact(&team, &link, "jane@acme.example.com")
        .await?;
    assert!(outcome.source_deleted && !outcome.contact_deleted);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn company_sync_without_further_addresses_files_as_before(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    // The same address was added by hand under another company.
    let elsewhere = insert_company(&pool, team, true, &["example.org"]).await?;
    let manual = repo
        .create_contact_for_company(
            &team,
            &elsewhere,
            Some("jane@acme.example.com"),
            "Jane",
            Utc::now(),
            true,
        )
        .await?;

    // Mail still files a contact under the company its domain names.
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    let synced = fetch_contact_id(&pool, company, "jane@acme.example.com")
        .await?
        .unwrap();
    assert_ne!(synced, manual.id);
    assert_eq!(team_contact_count(&pool, team).await?, 2);
    assert_eq!(source_count(&pool, manual.id, link).await?, 0);

    // Later mail refreshes that contact and leaves the manual one alone.
    sync(&pool, &service, team, link, "jane@acme.example.com", false).await?;
    assert_eq!(team_contact_count(&pool, team).await?, 2);
    assert_eq!(source_count(&pool, synced, link).await?, 1);
    assert_eq!(source_count(&pool, manual.id, link).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_sync_refreshes_a_company_contact_through_an_added_address(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.update_team_settings(
        &team,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await?;
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    let id = fetch_contact_id(&pool, company, "jane@acme.example.com")
        .await?
        .unwrap();
    let alias = personal("jane");
    add(&repo, team, id, &alias).await?;
    let before = repo.get_contact_for_team(&team, &id, true).await?.unwrap();

    sync(&pool, &service, team, link, &alias, false).await?;

    assert_eq!(team_contact_count(&pool, team).await?, 1);
    let after = repo.get_contact_for_team(&team, &id, true).await?.unwrap();
    assert!(after.last_interaction > before.last_interaction);
    assert_eq!(after.company_id, Some(company));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teardown_keeps_a_source_another_address_still_justifies(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    let company = fetch_company_for_domain(&pool, team, "acme.example.com")
        .await?
        .unwrap();
    let id = fetch_contact_id(&pool, company, "jane@acme.example.com")
        .await?
        .unwrap();
    let alias = personal("jane");
    add(&repo, team, id, &alias).await?;
    // The mailbox holds mail with the alias, received only.
    insert_interaction(&pool, link, &alias, Utc::now(), false).await?;

    // The last message with the first address is gone.
    sqlx::query!(
        "DELETE FROM email_messages WHERE link_id = $1 AND id IN (
             SELECT r.message_id FROM email_message_recipients r
             JOIN email_contacts ec ON ec.id = r.contact_id
             WHERE ec.email_address = 'jane@acme.example.com')",
        link
    )
    .execute(&pool)
    .await?;
    let outcome = service
        .depopulate_contact(&team, &link, "jane@acme.example.com")
        .await?;
    assert!(!outcome.removed_anything());
    assert_eq!(source_count(&pool, id, link).await?, 1);

    // Once the alias has no mail either, the source goes.
    sqlx::query!("DELETE FROM email_messages WHERE link_id = $1", link)
        .execute(&pool)
        .await?;
    let outcome = service.depopulate_contact(&team, &link, &alias).await?;
    assert!(outcome.source_deleted);
    assert!(!outcome.contact_deleted && !outcome.company_deleted);
    assert_eq!(source_count(&pool, id, link).await?, 0);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn teardown_of_a_single_address_contact_is_unchanged(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    sync(&pool, &service, team, link, "jane@acme.example.com", true).await?;
    // Mail with an address the contact does not hold justifies nothing.
    insert_interaction(&pool, link, "someone@acme.example.com", Utc::now(), true).await?;

    let outcome = service
        .depopulate_contact(&team, &link, "jane@acme.example.com")
        .await?;

    assert!(outcome.source_deleted && outcome.contact_deleted && outcome.company_deleted);
    assert_eq!(team_contact_count(&pool, team).await?, 0);
    Ok(())
}
