use super::helpers::*;
use crate::domain::{
    email_policy::{EmailPolicyRepository, EmailPolicyTransaction, OpenEmailPolicy},
    email_policy_work::{EmailHistoryAuthority, EmailHistoryPopulationRepository},
    email_privacy::{EmailPrivacyChange, EmailPrivacyRepository},
    model::CrmError,
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn population_defers_when_scanned_message_evidence_is_deleted(
    pool: PgPool,
) -> anyhow::Result<()> {
    for missing in [false, true] {
        for remove_sent in [false, true] {
            let team = Uuid::now_v7();
            let address = format!("owner{missing}{remove_sent}@example.com");
            let owner = format!("macro|{address}");
            seed_team(&pool, team, &owner).await?;
            enable_crm_for_team(&pool, team).await?;
            let link = insert_email_link(&pool, &owner, &address).await?;
            consent_to_mailbox(&pool, team, link).await?;
            let sent_at = Utc::now() - chrono::Duration::days(1);
            let sent =
                insert_interaction(&pool, link, "contact@example.com", sent_at, true).await?;
            let received =
                insert_interaction(&pool, link, "contact@example.com", Utc::now(), false).await?;
            let gate = Arc::new(super::ContactWriteGate::default());
            let mut gated = CompaniesRepositoryImpl::new(pool.clone());
            gated.after_eligible_scan = Some(gate.clone());
            let population = tokio::spawn(async move {
                gated
                    .populate_company_contact(
                        &team,
                        &link,
                        "example.com",
                        "contact@example.com",
                        None,
                        None,
                    )
                    .await
            });
            tokio::time::timeout(Duration::from_secs(10), gate.entered.notified()).await?;

            // Model the provider's absence transaction: it owns the mailbox,
            // removes one boundary message, and commits before the recheck.
            let mut deletion = pool.begin().await?;
            sqlx::query!(
                "SELECT id FROM email_links WHERE id = $1 FOR UPDATE NOWAIT",
                link
            )
            .fetch_one(&mut *deletion)
            .await?;
            let thread = if remove_sent { sent } else { received };
            if missing {
                sqlx::query!("UPDATE email_messages SET mailbox_state = '{\"provider_missing\":true}'::jsonb WHERE thread_id = $1", thread)
                    .execute(&mut *deletion).await?;
            } else {
                sqlx::query!("DELETE FROM email_messages WHERE thread_id = $1", thread)
                    .execute(&mut *deletion)
                    .await?;
            }
            deletion.commit().await?;
            gate.resume.notify_one();
            let outcome = tokio::time::timeout(Duration::from_secs(10), population).await??;
            assert!(
                matches!(outcome, Err(CrmError::Contended)),
                "stale evidence must defer: {outcome:?}"
            );
            assert_eq!(
                sqlx::query_scalar!(
                    "SELECT count(*) FROM crm_companies WHERE team_id = $1",
                    team
                )
                .fetch_one(&pool)
                .await?,
                Some(0)
            );

            // The deferred attempt rescans without a mailbox lock. Remaining
            // received mail cannot create a company; remaining sent mail can.
            CompaniesRepositoryImpl::new(pool.clone())
                .populate_company_contact(
                    &team,
                    &link,
                    "example.com",
                    "contact@example.com",
                    None,
                    None,
                )
                .await?;
            assert_eq!(
                sqlx::query_scalar!(
                    "SELECT count(*) FROM crm_companies WHERE team_id = $1",
                    team
                )
                .fetch_one(&pool)
                .await?,
                Some(i64::from(!remove_sent))
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_scan_rejects_a_regranted_policy_generation(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@example.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let link = insert_email_link(&pool, owner, "owner@example.com").await?;
    consent_to_mailbox(&pool, team, link).await?;
    insert_interaction(&pool, link, "contact@example.com", Utc::now(), true).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let policy = repo
        .open_email_policy(
            team,
            owner,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .expect("existing consent");
    let generation = policy.state().generation;
    policy.commit().await?;

    let gate = Arc::new(super::ContactWriteGate::default());
    let mut gated = repo.clone();
    gated.after_eligible_scan = Some(gate.clone());
    let scan = tokio::spawn(async move {
        gated
            .history_interactions(
                team,
                link,
                "contact@example.com",
                EmailHistoryAuthority::Policy(generation),
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), gate.entered.notified()).await?;
    // Admission before enrichment holds no team privacy guard. A complete
    // withdrawal and new grant may commit while its old history is being read.
    for enabled in [false, true] {
        repo.change_email_privacy(
            team,
            owner,
            EmailPrivacyChange::SetConsent {
                enabled,
                link_id: Some(link),
            },
        )
        .await?;
    }
    gate.resume.notify_one();
    let result = tokio::time::timeout(Duration::from_secs(10), scan).await???;
    assert!(
        result.is_none(),
        "old generation must not authorize enrichment after a new grant"
    );
    let current = sqlx::query!(
        "SELECT enabled, policy_version FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team,
        owner
    )
    .fetch_one(&pool)
    .await?;
    assert!(current.enabled);
    assert!(current.policy_version > generation.policy_version);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn population_rechecks_authority_after_the_unlocked_scan(pool: PgPool) -> anyhow::Result<()> {
    for (index, change) in [
        "primary",
        "deleting",
        "disconnect",
        "reauth",
        "membership",
        "delete",
        "withdraw",
    ]
    .into_iter()
    .enumerate()
    {
        for legacy in [false, true] {
            let team = Uuid::now_v7();
            let address = format!("owner{index}{legacy}@example.com");
            let owner = format!("macro|{address}");
            seed_team(&pool, team, &owner).await?;
            enable_crm_for_team(&pool, team).await?;
            let link = insert_email_link(&pool, &owner, &address).await?;
            consent_to_mailbox(&pool, team, link).await?;
            insert_interaction(&pool, link, "contact@example.com", Utc::now(), true).await?;
            let gate = Arc::new(super::ContactWriteGate::default());
            let mut repo = CompaniesRepositoryImpl::new(pool.clone());
            repo.after_eligible_scan = Some(gate.clone());
            let population = tokio::spawn(async move {
                repo.populate_company_contact(
                    &team,
                    &link,
                    "example.com",
                    "contact@example.com",
                    None,
                    legacy.then_some(EmailHistoryAuthority::Legacy),
                )
                .await
            });
            tokio::time::timeout(Duration::from_secs(10), gate.entered.notified()).await?;

            let mut mutation = pool.begin().await?;
            sqlx::query!("SET LOCAL lock_timeout = '250ms'")
                .execute(&mut *mutation)
                .await?;
            let changed = match change {
                "membership" => sqlx::query!("DELETE FROM team_user WHERE team_id = $1 AND user_id = $2", team, owner)
                    .execute(&mut *mutation).await,
                "delete" => sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
                    .execute(&mut *mutation).await,
                "withdraw" => sqlx::query!("UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND link_id = $2", team, link)
                    .execute(&mut *mutation).await,
                _ => sqlx::query!(
                    "UPDATE email_links SET email_address = CASE WHEN $2 = 'primary' THEN 'other@example.com' ELSE email_address END, deleting_at = CASE WHEN $2 = 'deleting' THEN now() END, disconnect_requested_at = CASE WHEN $2 = 'disconnect' THEN now() END, needs_reauth = $2 = 'reauth' WHERE id = $1",
                    link, change
                ).execute(&mut *mutation).await,
            };
            if changed.is_ok() {
                mutation.commit().await?;
            } else {
                mutation.rollback().await?;
            }
            gate.resume.notify_one();
            tokio::time::timeout(Duration::from_secs(10), population).await???;
            assert!(
                changed.is_ok(),
                "{change}, legacy={legacy}: scan blocked lifecycle write: {changed:?}"
            );
            let contacts =
                sqlx::query_scalar!("SELECT count(*) FROM crm_contacts WHERE team_id = $1", team)
                    .fetch_one(&pool)
                    .await?;
            let companies = sqlx::query_scalar!(
                "SELECT count(*) FROM crm_companies WHERE team_id = $1",
                team
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(
                contacts,
                Some(0),
                "{change}, legacy={legacy}: stale scan created a contact"
            );
            assert_eq!(
                companies,
                Some(0),
                "{change}, legacy={legacy}: stale scan created a company"
            );
        }
    }
    Ok(())
}
