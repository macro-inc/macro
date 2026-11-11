//! Email sync for personal-provider addresses, and contacts without a
//! company.

use super::helpers::*;
use crate::domain::companies_repo::CompaniesRepository;
use crate::domain::model::{CrmError, CrmTeamSettingsPatch};
use crate::domain::service::{CrmService, CrmServiceImpl};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::{Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

/// A consumer provider. Email sync files only these addresses without a
/// company, and no reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_sync_preserves_the_manually_selected_company(pool: PgPool) -> anyhow::Result<()> {
    use crate::domain::contact_update::ContactFieldUpdate;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team).await;
    let email = personal("contact");
    populate(&pool, &service, team, link, &email, true).await;
    let contact = repo
        .get_contact_by_email_for_team(&team, &email, true)
        .await?
        .unwrap();
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    repo.update_contact(
        &team,
        &contact.id,
        &ContactFieldUpdate::Company(company),
        true,
    )
    .await?;
    for sent in [true, false] {
        populate(&pool, &service, team, link, &email, sent).await;
        let count = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contacts WHERE team_id = $1 AND LOWER(email) = $2",
            team,
            email
        )
        .fetch_one(&pool)
        .await?;
        assert_eq!(count, Some(1), "sync must reuse the assigned contact");
        assert_eq!(
            repo.get_contact_for_team(&team, &contact.id, true)
                .await?
                .unwrap()
                .company_id,
            Some(company)
        );
    }
    let outcome = service.depopulate_contact(&team, &link, &email).await?;
    assert!(outcome.source_deleted);
    assert!(!outcome.contact_deleted && !outcome.company_deleted);
    assert!(
        repo.get_contact_for_team(&team, &contact.id, true)
            .await?
            .is_some()
    );
    Ok(())
}

fn personal(local: &str) -> String {
    format!("{local}@{PERSONAL_DOMAIN}")
}

async fn unfiled_contacts(pool: &PgPool, team_id: Uuid) -> sqlx::Result<Vec<(String, i64)>> {
    sqlx::query_as(
        "SELECT ct.email, (SELECT COUNT(*) FROM crm_contact_sources s WHERE s.contact_id = ct.id)
         FROM crm_contacts ct
         WHERE ct.team_id = $1 AND ct.company_id IS NULL
         ORDER BY ct.email",
    )
    .bind(team_id)
    .fetch_all(pool)
    .await
}

async fn let_personal_emails_in(repo: &CompaniesRepositoryImpl, team_id: Uuid) {
    repo.update_team_settings(
        &team_id,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

async fn populate(
    pool: &PgPool,
    service: &CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>,
    team_id: Uuid,
    link_id: Uuid,
    email: &str,
    is_sent: bool,
) {
    let now = Utc::now();
    insert_interaction(pool, link_id, &email.to_ascii_lowercase(), now, is_sent)
        .await
        .unwrap();
    service
        .populate_contact(
            &team_id,
            &link_id,
            "owner@example.com",
            email,
            Some("Jane"),
            now - Duration::days(1),
            now,
            is_sent,
        )
        .await
        .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_emails_stay_out_by_default(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team_id, link_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);

    assert!(
        repo.get_team_settings(&team_id)
            .await?
            .exclude_personal_emails
    );
    populate(&pool, &service, team_id, link_id, &personal("jane"), true).await;

    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    assert_eq!(
        count_companies_for_domain(&pool, team_id, PERSONAL_DOMAIN).await?,
        0
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_emails_file_without_a_company_when_let_in(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team_id, link_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;

    // Received mail never creates a contact; sent mail does, once.
    populate(&pool, &service, team_id, link_id, &personal("jane"), false).await;
    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    populate(
        &pool,
        &service,
        team_id,
        link_id,
        &personal("Jane").to_uppercase(),
        true,
    )
    .await;
    populate(&pool, &service, team_id, link_id, &personal("jane"), true).await;
    populate(&pool, &service, team_id, link_id, &personal("jane"), false).await;
    // Vendor domains stay out even when personal emails are let in.
    populate(
        &pool,
        &service,
        team_id,
        link_id,
        "billing@vendor.example",
        true,
    )
    .await;

    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("jane"), 1)]
    );
    assert_eq!(
        count_companies_for_domain(&pool, team_id, PERSONAL_DOMAIN).await?,
        0
    );
    assert_eq!(
        count_companies_for_domain(&pool, team_id, "vendor.example").await?,
        0
    );

    // Tearing down the only source removes the synced contact.
    let outcome = service
        .depopulate_contact(&team_id, &link_id, &personal("jane"))
        .await?;
    assert!(outcome.source_deleted && outcome.contact_deleted);
    assert!(!outcome.company_deleted);
    assert!(unfiled_contacts(&pool, team_id).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn link_teardown_removes_synced_unfiled_contacts(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team_id, link_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;
    populate(&pool, &service, team_id, link_id, &personal("jane"), true).await;
    repo.create_contact_for_team(
        &team_id,
        Some(personal("john").as_str()),
        "John",
        Utc::now(),
    )
    .await?;

    repo.depopulate_link_in_team(&team_id, &link_id).await?;

    // The manually created contact survives.
    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("john"), 0)]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_contact_for_team_without_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());

    for name in ["Jane", "John"] {
        let contact = repo
            .create_contact_for_team(&team_id, None, name, Utc::now())
            .await?;
        assert_eq!(contact.company_id, None);
        assert_eq!(contact.email, None);
    }
    let contact = repo
        .create_contact_for_team(&team_id, Some("Ann@Example.org"), "Ann", Utc::now())
        .await?;
    assert_eq!(contact.email.as_deref(), Some("ann@example.org"));
    let err = repo
        .create_contact_for_team(&team_id, Some("ann@example.org"), "Ann", Utc::now())
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::ContactAlreadyExistsForCompany));

    // Team-scoped reads reach contacts without a company.
    let found = repo
        .get_contact_for_team(&team_id, &contact.id, false)
        .await?
        .expect("visible");
    assert_eq!(found.company_id, None);
    assert_eq!(
        repo.search_contacts_for_team(&team_id, "ann", 10, false)
            .await?
            .len(),
        1
    );
    repo.set_contact_name(&team_id, &contact.id, "Ann B", false)
        .await?;
    repo.set_contact_hidden(&team_id, &contact.id, true).await?;
    assert!(
        repo.get_contact_for_team(&team_id, &contact.id, false)
            .await?
            .is_none()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_shared_personal_provider_is_not_the_users_company(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    let mailbox = personal("me");
    let owner = format!("macro|{mailbox}");
    let owner = owner.as_str();
    seed_team(&pool, team_id, owner).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, owner, &mailbox).await?;
    consent_to_mailbox(&pool, team_id, link_id).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team_id).await;

    let now = Utc::now();
    insert_interaction(&pool, link_id, &personal("jane"), now, true).await?;
    service
        .populate_contact(
            &team_id,
            &link_id,
            &mailbox,
            &personal("jane"),
            Some("Jane"),
            now - Duration::days(1),
            now,
            true,
        )
        .await?;

    assert_eq!(
        unfiled_contacts(&pool, team_id).await?,
        [(personal("jane"), 1)]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn manual_unfiled_contact_does_not_mask_synced_company_contact(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, OWNER).await?;
    enable_crm_for_team(&pool, team_id).await?;
    let link_id = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let manual = repo
        .create_contact_for_team(&team_id, Some("contact@acme.test"), "Contact", Utc::now())
        .await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;
    insert_contact_with_source(&pool, company_id, "contact@acme.test", link_id).await?;

    let outcome = repo
        .depopulate_contact(&team_id, &link_id, "acme.test", "contact@acme.test")
        .await?;
    assert!(outcome.source_deleted && outcome.contact_deleted && outcome.company_deleted);
    assert!(
        repo.get_contact_for_team(&team_id, &manual.id, false)
            .await?
            .is_some()
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assigned_personal_sync_keeps_admission_archive_and_team_boundaries(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::contact_update::ContactFieldUpdate;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team).await;
    let email = personal("contact");
    let contact = repo
        .create_contact_for_team(&team, Some(&email), "Manual name", Utc::now())
        .await?;
    let first = insert_company(&pool, team, true, &["example.com"]).await?;
    let second = insert_company(&pool, team, false, &["example.org"]).await?;
    let foreign = Uuid::now_v7();
    seed_team(&pool, foreign, "macro|other@example.org").await?;
    enable_crm_for_team(&pool, foreign).await?;
    let foreign_contact = repo
        .create_contact_for_team(&foreign, Some(&email), "Other", Utc::now())
        .await?;
    for (index, company) in [first, second].into_iter().enumerate() {
        let before = repo
            .get_contact_for_team(&team, &contact.id, true)
            .await?
            .unwrap();
        let past = contact.first_interaction - Duration::days(10 + index as i64);
        let future = contact.last_interaction + Duration::days(10 + index as i64);
        insert_interaction(&pool, link, &email, past, true).await?;
        insert_interaction(&pool, link, &email, future, false).await?;
        repo.update_contact(
            &team,
            &contact.id,
            &ContactFieldUpdate::Company(company),
            true,
        )
        .await?;
        for sent in [false, true] {
            service
                .populate_contact(
                    &team,
                    &link,
                    "owner@example.com",
                    &email,
                    Some("Sync name"),
                    contact.first_interaction - Duration::days(10),
                    contact.last_interaction + Duration::days(10),
                    sent,
                )
                .await?;
            let current = repo
                .get_contact_for_team(&team, &contact.id, true)
                .await?
                .unwrap();
            assert_eq!(current.company_id, Some(company));
            assert_eq!(current.name.as_deref(), Some("Manual name"));
            assert_eq!(
                current.last_interaction,
                if company == first {
                    future
                } else {
                    before.last_interaction
                }
            );
            if sent {
                assert_eq!(
                    current.first_interaction,
                    if company == first {
                        past
                    } else {
                        before.first_interaction
                    }
                );
            }
        }
    }
    repo.set_company_hidden(&team, &second, true).await?;
    populate(&pool, &service, team, link, &email, true).await;
    assert!(
        repo.get_contact_for_team(&team, &contact.id, true)
            .await?
            .unwrap()
            .hidden
    );
    assert_eq!(
        repo.get_contact_for_team(&foreign, &foreign_contact.id, true)
            .await?
            .unwrap()
            .last_interaction,
        foreign_contact.last_interaction
    );
    repo.depopulate_link_in_team(&team, &link).await?;
    let before = repo
        .get_contact_for_team(&team, &contact.id, true)
        .await?
        .unwrap();
    for gate in ["personal", "blocked", "withdrawn"] {
        match gate {
            "personal" => {
                repo.update_team_settings(
                    &team,
                    &CrmTeamSettingsPatch {
                        exclude_personal_emails: Some(true),
                        ..Default::default()
                    },
                )
                .await?;
            }
            "blocked" => {
                let_personal_emails_in(&repo, team).await;
                repo.block_domain(&team, PERSONAL_DOMAIN).await?;
            }
            _ => {
                repo.unblock_domain(&team, PERSONAL_DOMAIN).await?;
                use crate::domain::email_privacy::{EmailPrivacyChange, EmailPrivacyRepository};
                repo.change_email_privacy(
                    team,
                    OWNER,
                    EmailPrivacyChange::SetConsent {
                        enabled: false,
                        link_id: Some(link),
                    },
                )
                .await?;
            }
        }
        for sent in [true, false] {
            service
                .populate_contact(
                    &team,
                    &link,
                    "owner@example.com",
                    &email,
                    None,
                    Utc::now(),
                    before.last_interaction + Duration::days(20),
                    sent,
                )
                .await?;
        }
        let after = repo
            .get_contact_for_team(&team, &contact.id, true)
            .await?
            .unwrap();
        assert_eq!(after.last_interaction, before.last_interaction);
        assert_eq!(after.company_id, Some(second));
        assert!(after.hidden);
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
                contact.id
            )
            .fetch_one(&pool)
            .await?,
            Some(0)
        );
    }
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contacts WHERE team_id = $1 AND LOWER(email) = $2",
            team,
            email
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ambiguous_personal_matches_are_never_selected_by_sync_or_cleanup(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    let_personal_emails_in(&repo, team).await;
    let email = personal("ambiguous");
    let standalone = repo
        .create_contact_for_team(&team, Some(&email), "Standalone", Utc::now())
        .await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let assigned = insert_contact_with_source(&pool, company, &email, link).await?;
    repo.set_contact_hidden(&team, &assigned, true).await?;
    for sent in [false, true] {
        populate(&pool, &service, team, link, &email, sent).await;
    }
    assert_eq!(
        repo.get_contact_for_team(&team, &standalone.id, true)
            .await?
            .unwrap()
            .updated_at,
        standalone.updated_at
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contacts WHERE team_id = $1 AND LOWER(email) = $2",
            team,
            email
        )
        .fetch_one(&pool)
        .await?,
        Some(2)
    );
    assert!(
        !repo
            .has_depopulate_target(&team, PERSONAL_DOMAIN, &email)
            .await?
    );
    let outcome = service.depopulate_contact(&team, &link, &email).await?;
    assert!(!outcome.source_deleted && !outcome.contact_deleted && !outcome.company_deleted);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
            assigned
        )
        .fetch_one(&pool)
        .await?,
        Some(1)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assigned_personal_population_locks_parent_before_bulk_cleanup(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::contact_update::ContactFieldUpdate;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let_personal_emails_in(&repo, team).await;
    let email = personal("contact");
    let contact = repo
        .create_contact_for_team(&team, Some(&email), "Contact", Utc::now())
        .await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    repo.update_contact(
        &team,
        &contact.id,
        &ContactFieldUpdate::Company(company),
        true,
    )
    .await?;
    let gate = std::sync::Arc::new(super::ContactWriteGate::default());
    let mut gated = repo.clone();
    gated.after_personal_company = Some(gate.clone());
    let service = CrmServiceImpl::new(gated, NoOpCompanyMetadataResolver);
    insert_interaction(&pool, link, &email, Utc::now(), true).await?;
    let sync = tokio::spawn(async move {
        service
            .populate_contact(
                &team,
                &link,
                "owner@example.com",
                &email,
                None,
                Utc::now(),
                Utc::now(),
                true,
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), gate.entered.notified()).await?;
    let locked = sqlx::query!(
        "SELECT id FROM crm_companies WHERE id = $1 FOR UPDATE NOWAIT",
        company
    )
    .fetch_optional(&pool)
    .await;
    let parent_locked = locked.as_ref().is_err_and(|e| {
        e.as_database_error()
            .is_some_and(|e| e.code().as_deref() == Some("55P03"))
    });
    let cleanup_repo = repo.clone();
    let cleanup =
        tokio::spawn(async move { cleanup_repo.depopulate_link_in_team(&team, &link).await });
    gate.resume.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        sync.await??;
        cleanup.await??;
        anyhow::Ok(())
    })
    .await??;
    assert!(
        parent_locked,
        "assigned sync must take the parent before contact/source work"
    );
    assert_eq!(
        repo.get_contact_for_team(&team, &contact.id, true)
            .await?
            .unwrap()
            .company_id,
        Some(company)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
            contact.id
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn personal_switch_survives_cleanup_after_admission_is_disabled(
    pool: PgPool,
) -> anyhow::Result<()> {
    use crate::domain::contact_update::ContactFieldUpdate;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let_personal_emails_in(&repo, team).await;
    let email = personal("contact");
    let first = insert_company(&pool, team, true, &["example.com"]).await?;
    let second = insert_company(&pool, team, true, &["example.org"]).await?;
    let contact = repo
        .create_contact_for_team(&team, Some(&email), "Contact", Utc::now())
        .await?;
    repo.update_contact(
        &team,
        &contact.id,
        &ContactFieldUpdate::Company(first),
        true,
    )
    .await?;
    let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
    populate(&pool, &service, team, link, &email, true).await;
    repo.update_team_settings(
        &team,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(true),
            ..Default::default()
        },
    )
    .await?;
    repo.block_domain(&team, PERSONAL_DOMAIN).await?;
    let gate = std::sync::Arc::new(super::ContactWriteGate::default());
    let mut gated = repo.clone();
    gated.after_depopulate_source = Some(gate.clone());
    let cleanup = tokio::spawn(async move {
        gated
            .depopulate_contact(&team, &link, PERSONAL_DOMAIN, &email)
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), gate.entered.notified()).await?;
    let switch_repo = repo.clone();
    let id = contact.id;
    let switch = tokio::spawn(async move {
        switch_repo
            .update_contact(&team, &id, &ContactFieldUpdate::Company(second), true)
            .await
    });
    gate.resume.notify_one();
    let (removed, changed) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        anyhow::Ok((cleanup.await??, switch.await??))
    })
    .await??;
    assert!(removed.source_deleted && !removed.contact_deleted && !removed.company_deleted);
    assert_eq!(changed.company_id, Some(second));
    assert_eq!(changed.id, contact.id);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
            contact.id
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}
