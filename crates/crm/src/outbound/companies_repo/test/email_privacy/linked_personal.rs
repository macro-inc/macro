//! Combined manual-contact and contribution contracts, using stored mailbox history.
use super::*;
use crate::domain::{
    contact_update::ContactFieldUpdate,
    model::CrmTeamSettingsPatch,
    service::{CrmService, CrmServiceImpl},
};
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use chrono::Duration;
use entity_access::{
    domain::{models::EntityType, ports::EntityAccessService, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use macro_user_id::user_id::MacroUserIdStr;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn linked_personal_parent_consent_and_domain_matrix(pool: PgPool) -> anyhow::Result<()> {
    let member = "macro|member@example.com";
    seed_team(&pool, Uuid::now_v7(), member).await?;
    let reader = MacroUserIdStr::try_from(member.to_string()).unwrap();
    let access = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    for (index, (case, parent_enabled, consent, block)) in [
        ("enabled", true, true, None),
        ("disabled-parent", false, true, None),
        ("no-consent", true, false, None),
        ("withdrawn", true, true, None),
        ("secondary", true, true, None),
        ("team-block", true, true, Some(EmailBlockScope::Team)),
        (
            "personal-block",
            true,
            true,
            Some(EmailBlockScope::Personal),
        ),
        ("mixed-subdomain", true, true, Some(EmailBlockScope::Team)),
    ]
    .into_iter()
    .enumerate()
    {
        let team = Uuid::now_v7();
        let owner = format!("macro|owner-{index}@example.com");
        seed_team(&pool, team, &owner).await?;
        sqlx::query!(
            "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
            team,
            member
        )
        .execute(&pool)
        .await?;
        let link = insert_email_link(&pool, &owner, &format!("owner-{index}@example.com")).await?;
        let repo = CompaniesRepositoryImpl::new(pool.clone());
        let service = CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver);
        let company =
            insert_company(&pool, team, parent_enabled, &["business.example.com"]).await?;
        // No settings row or consent is required for add-email/link operations.
        let initial = repo
            .create_contact_for_team(&team, None, "Manual name", Utc::now())
            .await?;
        let email = format!("person-{index}@{}", "gmail.com");
        repo.update_contact(
            &team,
            &initial.id,
            &ContactFieldUpdate::Email(email.clone()),
            true,
        )
        .await?;
        repo.update_contact(
            &team,
            &initial.id,
            &ContactFieldUpdate::Company(company),
            true,
        )
        .await?;
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT COUNT(*) FROM crm_email_consent WHERE team_id = $1",
                team
            )
            .fetch_one(&pool)
            .await?,
            Some(0)
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT email_sync FROM crm_companies WHERE id = $1",
                company
            )
            .fetch_one(&pool)
            .await?,
            parent_enabled
        );
        repo.update_team_settings(
            &team,
            &CrmTeamSettingsPatch {
                exclude_personal_emails: Some(false),
                ..Default::default()
            },
        )
        .await?;
        if consent {
            consent_to_mailbox(&pool, team, link).await?;
        }
        let at = initial.last_interaction + Duration::days(1);
        let thread = insert_interaction(&pool, link, &email, at, true).await?;
        if let Some(scope) = block {
            let domain = if case == "mixed-subdomain" {
                "excluded.example.com"
            } else {
                "gmail.com"
            };
            repo.change_email_privacy(
                team,
                &owner,
                EmailPrivacyChange::AddDomain {
                    scope,
                    domain: domain.into(),
                },
            )
            .await?;
            if case == "mixed-subdomain" {
                let recipient = Uuid::now_v7();
                sqlx::query!("INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, 'other@sub.excluded.example.com')", recipient, link).execute(&pool).await?;
                sqlx::query!("INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) SELECT id, $2, 'BCC' FROM email_messages WHERE thread_id = $1", thread, recipient).execute(&pool).await?;
            }
        }
        if case == "withdrawn" {
            repo.change_email_privacy(
                team,
                &owner,
                EmailPrivacyChange::SetConsent {
                    enabled: false,
                    link_id: Some(link),
                },
            )
            .await?;
        }
        if case == "secondary" {
            sqlx::query!(
                "UPDATE email_links SET email_address = 'secondary@example.com' WHERE id = $1",
                link
            )
            .execute(&pool)
            .await?;
        }
        // Spoofed job timestamps must not replace the stored eligible timestamp.
        service
            .populate_contact(
                &team,
                &link,
                &format!("owner-{index}@example.com"),
                &email,
                Some("Ingested name"),
                at - Duration::days(10),
                at + Duration::days(10),
                true,
            )
            .await?;
        let allowed = case == "enabled";
        let contact = repo
            .get_contact_for_team(&team, &initial.id, true)
            .await?
            .unwrap();
        assert_eq!(contact.id, initial.id, "{case}");
        assert_eq!(contact.company_id, Some(company), "{case}");
        assert_eq!(contact.name.as_deref(), Some("Manual name"), "{case}");
        assert_eq!(contact.hidden, initial.hidden, "{case}");
        assert_eq!(
            contact.last_interaction,
            if allowed {
                at
            } else {
                initial.last_interaction
            },
            "{case}"
        );
        assert_eq!(
            sqlx::query_scalar!(
                "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1",
                initial.id
            )
            .fetch_one(&pool)
            .await?,
            Some(if allowed { 1 } else { 0 }),
            "{case}"
        );
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
        let scope = repo.crm_scope_precheck(&team, &[], &[email]).await?;
        assert_eq!(scope.addresses[0].email_sync, parent_enabled, "{case}");
        // These are the list admission inputs and the actual direct-access service,
        // using a distinct member with no independent mailbox grant.
        assert_eq!(
            scope.addresses[0].email_sync && super::allowed(&pool, team, thread).await?,
            allowed,
            "{case}"
        );
        assert_eq!(
            access
                .get_access_level(Some(&reader), &thread.to_string(), EntityType::EmailThread)
                .await?
                .is_some(),
            allowed,
            "{case}"
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reassignment_waits_for_population_then_blocks_disabled_parent_writes(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    repo.update_team_settings(
        &team,
        &CrmTeamSettingsPatch {
            exclude_personal_emails: Some(false),
            ..Default::default()
        },
    )
    .await?;
    let first = insert_company(&pool, team, true, &["first.example.com"]).await?;
    let disabled = insert_company(&pool, team, false, &["disabled.example.com"]).await?;
    let email = format!("person@{}", "gmail.com");
    let contact = repo
        .create_contact_for_team(&team, Some(&email), "Manual name", Utc::now())
        .await?;
    repo.update_contact(
        &team,
        &contact.id,
        &ContactFieldUpdate::Company(first),
        true,
    )
    .await?;
    let at = contact.last_interaction + Duration::days(1);
    insert_interaction(&pool, link, &email, at, true).await?;
    let gate = std::sync::Arc::new(super::super::ContactWriteGate::default());
    let mut gated = repo.clone();
    gated.after_personal_company = Some(gate.clone());
    let sync_email = email.clone();
    let sync = tokio::spawn(async move {
        CrmServiceImpl::new(gated, NoOpCompanyMetadataResolver)
            .populate_contact(
                &team,
                &link,
                "owner@example.com",
                &sync_email,
                None,
                at,
                at,
                true,
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(10), gate.entered.notified()).await?;
    let edit_repo = repo.clone();
    let id = contact.id;
    let edit = tokio::spawn(async move {
        edit_repo
            .update_contact(&team, &id, &ContactFieldUpdate::Company(disabled), true)
            .await
    });
    let observed = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let privacy_key = format!("crm-email:{team}");
            let waiting = sqlx::query_scalar!(
                r#"SELECT EXISTS (
                SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE a.datname = current_database() AND a.wait_event_type = 'Lock'
                  AND cardinality(pg_blocking_pids(a.pid)) > 0
                  AND l.locktype = 'advisory' AND NOT l.granted AND l.mode = 'ExclusiveLock'
                  AND l.objsubid = 1
                  AND l.classid = ((hashtextextended($1, 0) >> 32) & 4294967295)::oid
                  AND l.objid = (hashtextextended($1, 0) & 4294967295)::oid
                ) AS "waiting!""#,
                privacy_key
            )
            .fetch_one(&pool)
            .await?;
            if waiting {
                return anyhow::Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await;
    // Always release the paused writer, including when a regression loses the lock.
    gate.resume.notify_one();
    let (_, changed) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        anyhow::Ok((sync.await??, edit.await??))
    })
    .await??;
    observed??;
    assert_eq!(changed.company_id, Some(disabled));
    assert_eq!(changed.id, id);
    assert_eq!(changed.name.as_deref(), Some("Manual name"));
    assert_eq!(changed.hidden, contact.hidden);
    assert_eq!(changed.last_interaction, at);
    // A second consenting member exposes forbidden new source insertion, not
    // merely the ON CONFLICT no-op of an already attached mailbox.
    let other = "macro|other@example.com";
    seed_team(&pool, Uuid::now_v7(), other).await?;
    let other_link = insert_email_link(&pool, other, "other@example.com").await?;
    consent_to_mailbox(&pool, team, other_link).await?;
    insert_interaction(&pool, other_link, &email, at + Duration::days(1), true).await?;
    CrmServiceImpl::new(repo.clone(), NoOpCompanyMetadataResolver)
        .populate_contact(
            &team,
            &other_link,
            "other@example.com",
            &email,
            None,
            at,
            at,
            true,
        )
        .await?;
    let after = repo.get_contact_for_team(&team, &id, true).await?.unwrap();
    assert_eq!(after.last_interaction, at);
    assert_eq!(after.company_id, Some(disabled));
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM crm_contact_sources WHERE contact_id = $1 AND link_id = $2",
            id,
            other_link
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}
