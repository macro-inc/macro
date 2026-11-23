//! Adding and removing a company's domains: who may, which domains, the
//! company's name and primary domain, and where later mail is filed.

use super::helpers::*;
use crate::domain::{
    auth::CrmCompanyReceipt,
    companies_repo::CompaniesRepository,
    model::{CompanyDomainHolder, CrmCompanyWithContacts, CrmError, DomainMetadata},
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
const MAILBOX: &str = "user@macro.com";

type Service = CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>;

/// A team whose owner contributes one mailbox to the CRM.
async fn team_with_mailbox(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Service)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    enable_crm_for_team(pool, team).await?;
    let link = insert_email_link(pool, OWNER, MAILBOX).await?;
    consent_to_mailbox(pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    Ok((
        team,
        link,
        CrmServiceImpl::new(repo, NoOpCompanyMetadataResolver),
    ))
}

fn receipt(company: Uuid, team: Uuid, role: TeamRole) -> CrmCompanyReceipt<EditAccessLevel> {
    CrmCompanyReceipt::dangerously_internal_with_role(company, team, role)
}

fn domains(company: &CrmCompanyWithContacts) -> Vec<&str> {
    company
        .company
        .domains
        .iter()
        .map(|domain| domain.domain.as_str())
        .collect()
}

async fn name_directory(pool: &PgPool, domain: &str, name: &str) -> anyhow::Result<()> {
    let metadata = DomainMetadata {
        name: Some(name.into()),
        ..Default::default()
    };
    CompaniesRepositoryImpl::new(pool.clone())
        .upsert_domain_metadata(domain, &metadata)
        .await?;
    Ok(())
}

async fn directory_name(pool: &PgPool, domain: &str) -> sqlx::Result<Option<Option<String>>> {
    sqlx::query_scalar!(
        "SELECT name FROM crm_domain_directory WHERE LOWER(domain) = LOWER($1)",
        domain
    )
    .fetch_optional(pool)
    .await
}

async fn team_company_count(pool: &PgPool, team: Uuid) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM crm_companies WHERE team_id = $1"#,
        team
    )
    .fetch_one(pool)
    .await
}

/// Store one message with `email` in the mailbox, then deliver its CRM job.
async fn sync(
    pool: &PgPool,
    service: &Service,
    team: Uuid,
    link: Uuid,
    email: &str,
) -> anyhow::Result<()> {
    let now = Utc::now();
    insert_interaction(pool, link, email, now, true).await?;
    service
        .populate_contact(
            &team,
            &link,
            MAILBOX,
            email,
            Some("Synced Name"),
            now - Duration::days(1),
            now,
            true,
        )
        .await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_from_an_added_domain_is_filed_under_the_company(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    name_directory(&pool, "example.com", "Example").await?;
    name_directory(&pool, "example.org", "Example Organization").await?;

    let updated = service
        .add_company_domain(&receipt(company, team, TeamRole::Member), " Example.ORG. ")
        .await?;

    assert_eq!(domains(&updated), ["example.com", "example.org"]);
    assert_eq!(updated.name.as_deref(), Some("Example"));
    assert_eq!(
        directory_name(&pool, "example.org").await?,
        Some(Some("Example Organization".into())),
        "the shared directory keeps its entry"
    );

    sync(&pool, &service, team, link, "pat@example.org").await?;

    assert_eq!(team_company_count(&pool, team).await?, 1);
    assert!(
        fetch_contact_id(&pool, company, "pat@example.org")
            .await?
            .is_some()
    );
    let read = CompaniesRepositoryImpl::new(pool.clone())
        .get_company_for_team(&team, &company, false, false)
        .await?
        .expect("visible to members");
    assert_eq!(read.name.as_deref(), Some("Example"));
    assert_eq!(domains(&read), ["example.com", "example.org"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_added_domain_stays_after_a_primary_dated_later(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    // A primary written by a transaction that started after the edit's.
    sqlx::query!(
        "UPDATE crm_domains SET created_at = now() + INTERVAL '1 hour' WHERE company_id = $1",
        company
    )
    .execute(&pool)
    .await?;

    let updated = service
        .add_company_domain(&receipt(company, team, TeamRole::Member), "example.org")
        .await?;

    assert_eq!(domains(&updated), ["example.com", "example.org"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unknown_domain_gets_a_pending_directory_entry_as_creation_gives(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;

    service
        .add_company_domain(&receipt(company, team, TeamRole::Member), "example.net")
        .await?;

    assert_eq!(directory_name(&pool, "example.net").await?, Some(None));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_domain_another_company_tracks_is_refused_naming_it(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other = insert_company(&pool, team, true, &["example.org"]).await?;
    name_directory(&pool, "example.org", "Example Organization").await?;
    let add = |role| {
        let service = &service;
        async move {
            service
                .add_company_domain(&receipt(company, team, role), "example.org")
                .await
        }
    };

    let err = add(TeamRole::Member).await.expect_err("tracked elsewhere");
    assert_eq!(
        format!("{err:?}"),
        format!(
            "{:?}",
            CrmError::CompanyDomainTaken(Some(CompanyDomainHolder {
                company_id: other,
                name: Some("Example Organization".into()),
                hidden: false,
            }))
        )
    );

    // Archived: a member learns only that an archived company holds it.
    CompaniesRepositoryImpl::new(pool.clone())
        .set_company_hidden(&team, &other, true)
        .await?;
    let member = add(TeamRole::Member).await.expect_err("tracked elsewhere");
    assert!(matches!(member, CrmError::CompanyDomainTaken(None)));
    let admin = add(TeamRole::Admin).await.expect_err("tracked elsewhere");
    assert!(matches!(
        admin,
        CrmError::CompanyDomainTaken(Some(CompanyDomainHolder { company_id, hidden: true, .. }))
            if company_id == other
    ));

    assert_eq!(
        fetch_company_for_domain(&pool, team, "example.org").await?,
        Some(other)
    );
    let read = CompaniesRepositoryImpl::new(pool.clone())
        .get_company_for_team(&team, &company, false, false)
        .await?
        .expect("visible to members");
    assert_eq!(domains(&read), ["example.com"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_same_domain_on_another_team_is_independent(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let other_team = Uuid::now_v7();
    seed_team(&pool, other_team, "macro|someone@example.net").await?;
    insert_company(&pool, other_team, true, &["example.org"]).await?;

    let updated = service
        .add_company_domain(&receipt(company, team, TeamRole::Member), "example.org")
        .await?;
    assert_eq!(domains(&updated), ["example.com", "example.org"]);

    // A receipt naming this company under another team reaches nothing.
    let err = service
        .add_company_domain(
            &receipt(company, other_team, TeamRole::Owner),
            "example.net",
        )
        .await
        .expect_err("another team's company");
    assert!(matches!(err, CrmError::CompanyNotFoundForTeam));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_and_malformed_domains_are_refused(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;

    for domain in [
        "gmail.com",
        "Outlook.com",
        "pat@example.org",
        "https://example.org",
        "example",
    ] {
        let err = service
            .add_company_domain(&receipt(company, team, TeamRole::Owner), domain)
            .await
            .expect_err(domain);
        assert!(matches!(err, CrmError::InvalidRequest(_)), "{domain}");
    }
    assert_eq!(directory_name(&pool, "gmail.com").await?, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_a_domain_keeps_its_contacts_and_mail(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let member = receipt(company, team, TeamRole::Member);
    service.add_company_domain(&member, "example.org").await?;
    sync(&pool, &service, team, link, "pat@example.org").await?;
    let contact = fetch_contact_id(&pool, company, "pat@example.org")
        .await?
        .expect("filed under the company");
    let messages = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM email_messages WHERE link_id = $1"#,
        link
    )
    .fetch_one(&pool)
    .await?;

    let updated = service
        .remove_company_domain(&member, "example.org")
        .await?;
    let again = service
        .remove_company_domain(&member, "example.org")
        .await?;

    assert_eq!(domains(&updated), ["example.com"]);
    assert_eq!(domains(&again), ["example.com"]);
    assert_eq!(
        fetch_contact_id(&pool, company, "pat@example.org").await?,
        Some(contact)
    );
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) AS "count!" FROM email_messages WHERE link_id = $1"#,
            link
        )
        .fetch_one(&pool)
        .await?,
        messages
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_domain_that_names_the_company_stays_until_it_is_renamed(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    name_directory(&pool, "example.com", "Example").await?;
    let owner = receipt(company, team, TeamRole::Owner);
    service.add_company_domain(&owner, "example.org").await?;

    let err = service
        .remove_company_domain(&owner, "example.com")
        .await
        .expect_err("the company is named after it");
    assert!(matches!(err, CrmError::InvalidRequest(_)));

    CompaniesRepositoryImpl::new(pool.clone())
        .set_company_custom_name(&team, &company, "Example", true)
        .await?;
    let updated = service.remove_company_domain(&owner, "example.com").await?;
    assert_eq!(domains(&updated), ["example.org"]);
    assert_eq!(updated.name.as_deref(), Some("Example"));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_company_whose_sync_is_off_keeps_added_domains_out_and_needs_an_admin_to_remove_one(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, false, &["example.com"]).await?;
    let blocked = |domain: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar!(
                r#"SELECT crm_email_domain_blocked($1, $2, $3) AS "blocked!""#,
                team,
                OWNER,
                domain
            )
            .fetch_one(&pool)
            .await
        }
    };
    // Consent already requested one; a new request moves its time.
    let backfill_requested = || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar!(
                "SELECT MAX(requested_at) FROM crm_email_backfill_outbox WHERE team_id = $1",
                team
            )
            .fetch_one(&pool)
            .await
        }
    };
    let member = receipt(company, team, TeamRole::Member);

    assert!(!blocked("example.org").await?);
    service.add_company_domain(&member, "example.org").await?;
    assert!(blocked("example.org").await?);

    let err = service
        .remove_company_domain(&member, "example.org")
        .await
        .expect_err("a member cannot let the domain's mail back in");
    assert!(matches!(err, CrmError::CompanyDomainAdminRequired));
    assert!(blocked("example.org").await?);

    let before = backfill_requested().await?;
    service
        .remove_company_domain(&receipt(company, team, TeamRole::Admin), "example.org")
        .await?;
    assert!(!blocked("example.org").await?);
    assert!(
        backfill_requested().await? > before,
        "earlier mail is gathered again"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_members_mailbox_domain_cannot_join_a_company_whose_sync_is_off(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, false, &["example.com"]).await?;

    let err = service
        .add_company_domain(&receipt(company, team, TeamRole::Owner), "macro.com")
        .await
        .expect_err("would keep a member's own mailbox out of sync");
    assert!(matches!(err, CrmError::BlocksConnectedMailbox(_)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn members_cannot_change_an_archived_companys_domains(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    CompaniesRepositoryImpl::new(pool.clone())
        .set_company_hidden(&team, &company, true)
        .await?;

    let err = service
        .add_company_domain(&receipt(company, team, TeamRole::Member), "example.org")
        .await
        .expect_err("archived companies are hidden from members");
    assert!(matches!(err, CrmError::CompanyNotFoundForTeam));

    let updated = service
        .add_company_domain(&receipt(company, team, TeamRole::Admin), "example.org")
        .await?;
    assert_eq!(domains(&updated), ["example.com", "example.org"]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_edited_company_survives_sync_cleanup(pool: PgPool) -> anyhow::Result<()> {
    let (team, _, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;

    service
        .add_company_domain(&receipt(company, team, TeamRole::Member), "example.org")
        .await?;

    let manual = sqlx::query_scalar!(
        "SELECT manually_created FROM crm_companies WHERE id = $1",
        company
    )
    .fetch_one(&pool)
    .await?;
    assert!(manual, "orphan cleanup keeps the team's domains");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn selected_contribution_rules_see_a_domain_change(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, service) = team_with_mailbox(&pool).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    sqlx::query!(
        r#"INSERT INTO crm_email_rule_revisions(team_id,user_id,revision,link_id,schema_version,definition)
           VALUES($1,$2,1,$3,1,'{"schema_version":1,"include":[]}'::jsonb)"#,
        team,
        OWNER,
        link
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_companies(team_id,user_id,revision,company_id) VALUES($1,$2,1,$3)",
        team,
        OWNER,
        company
    )
    .execute(&pool)
    .await?;
    let events = || {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar!(
                r#"SELECT source_id AS "source_id!" FROM crm_email_policy_source_events
                   WHERE team_id = $1 AND source_kind = 'company'"#,
                team
            )
            .fetch_all(&pool)
            .await
        }
    };
    let member = receipt(company, team, TeamRole::Member);

    service.add_company_domain(&member, "example.org").await?;
    assert_eq!(events().await?, [company]);

    service.add_company_domain(&member, "example.org").await?;
    assert_eq!(events().await?.len(), 1, "a repeated add changes nothing");

    service
        .remove_company_domain(&member, "example.org")
        .await?;
    assert_eq!(events().await?.len(), 2);
    Ok(())
}
