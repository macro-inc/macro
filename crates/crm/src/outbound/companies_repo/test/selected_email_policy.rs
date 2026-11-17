//! Rolling-deploy and lifecycle guarantees for dormant selected-policy storage.
//! Direct SQL below seeds states that no public API can activate in this phase.

use super::helpers::*;
use crate::domain::auth::CrmMemberAccess;
use crate::domain::email_privacy::{EmailPrivacyChange, EmailPrivacyRepository};
use crate::domain::email_rules::{
    EmailInclusionRule, EmailRuleDefinitionError, EmailRuleSet, MAX_EMAIL_RULE_BYTES,
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

async fn setup(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    let link = insert_email_link(pool, OWNER, "owner@example.com").await?;
    consent_to_mailbox(pool, team, link).await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 1, $3, 1, '{\"schema_version\":1,\"include\":[]}'::jsonb)",
        team, OWNER, link
    ).execute(pool).await?;
    Ok((team, link))
}

async fn seed_selected(pool: &PgPool, team: Uuid) -> anyhow::Result<i64> {
    let mut tx = pool.begin().await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&mut *tx)
    .await?;
    // The legacy-write trigger must see the disabling write. Selected activation
    // is a separate statement in the same transaction, never a legacy opt-in.
    let version = sqlx::query_scalar!(
        "UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = 1 WHERE team_id = $1 AND user_id = $2 RETURNING policy_version",
        team, OWNER
    ).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(version)
}

async fn selected_enabled(pool: &PgPool, team: Uuid) -> sqlx::Result<bool> {
    sqlx::query_scalar!(
        "SELECT selected_enabled FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .fetch_one(pool)
    .await
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_viewing_denial_preserves_private_policy_control(pool: PgPool) -> anyhow::Result<()> {
    let (team, link) = setup(&pool).await?;
    let version = seed_selected(&pool, team).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    sqlx::query!(
        "UPDATE team_user SET crm_access = FALSE WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(!repo.member_has_crm_access(team, OWNER).await?);
    assert!(selected_enabled(&pool, team).await?);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT policy_version FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?,
        version
    );
    assert_eq!(
        repo.email_privacy(team, OWNER).await?.mailbox_link_id,
        Some(link)
    );
    // No public rule writer exists yet. The dormant storage must still allow
    // a new owner-bound revision when that owner's CRM viewing is disabled.
    sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 2, $3, 1, '{\"schema_version\":1,\"include\":[]}'::jsonb)",
        team, OWNER, link
    ).execute(&pool).await?;
    assert_eq!(
        sqlx::query_scalar!(
            "UPDATE crm_email_consent SET active_rule_revision = 2 WHERE team_id = $1 AND user_id = $2 RETURNING policy_version",
            team, OWNER
        ).fetch_one(&pool).await?,
        version + 1
    );
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    assert!(!selected_enabled(&pool, team).await?);
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_rule_revisions WHERE team_id = $1 AND user_id = $2",
            team,
            OWNER
        )
        .fetch_one(&pool)
        .await?,
        Some(2)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn address_targets_keep_the_existing_contact_byte_limit(pool: PgPool) -> anyhow::Result<()> {
    let (team, _) = setup(&pool).await?;
    let address = format!("{}@example.org", "x".repeat(308));
    assert_eq!(address.len(), 320);
    sqlx::query!(
        "INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, $3)",
        team, OWNER, address
    ).execute(&pool).await?;
    for oversized in [
        format!("x{address}"),
        format!("{}@example.org", "é".repeat(155)),
    ] {
        assert!(oversized.len() > 320);
        let error = sqlx::query!(
            "INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, $3)",
            team, OWNER, oversized
        ).execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("23514")
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rule_size_validation_agrees_with_the_storage_boundary(pool: PgPool) -> anyhow::Result<()> {
    let (team, link) = setup(&pool).await?;
    // Valid address lengths: 64-byte local + @ + 189-byte domain = 254.
    let domain = format!("{}.{}.{}", "a".repeat(63), "b".repeat(63), "c".repeat(61));
    let mut rules = EmailRuleSet {
        schema_version: 1,
        include: (0..225)
            .map(|i| EmailInclusionRule::Address {
                address: format!("{i:04}{}@{domain}", "x".repeat(60)),
            })
            .collect(),
    };
    rules.include.push(EmailInclusionRule::Address {
        address: format!("0225{}@{domain}", "x".repeat(22)),
    });
    rules.validate_shape()?;
    let definition = serde_json::to_value(&rules)?;
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT octet_length($1::jsonb::text) AS "bytes!""#,
            definition
        )
        .fetch_one(&pool)
        .await? as usize,
        MAX_EMAIL_RULE_BYTES
    );
    sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 2, $3, 1, $4)",
        team, OWNER, link, definition
    ).execute(&pool).await?;
    if let Some(EmailInclusionRule::Address { address }) = rules.include.last_mut() {
        address.insert(0, 'x');
    }
    // Compact encoding alone is still under budget, but PostgreSQL stores one
    // byte too many. Validation must reject it before attempting persistence.
    assert!(serde_json::to_vec(&rules)?.len() < MAX_EMAIL_RULE_BYTES);
    assert!(matches!(
        rules.validate_shape(),
        Err(EmailRuleDefinitionError::TooLarge)
    ));
    let definition = serde_json::to_value(&rules)?;
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT octet_length($1::jsonb::text) AS "bytes!""#,
            definition
        )
        .fetch_one(&pool)
        .await? as usize,
        MAX_EMAIL_RULE_BYTES + 1
    );
    let error = sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 3, $3, 1, $4)",
        team, OWNER, link, definition
    ).execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23514")
    );
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn foundation_preserves_existing_all_mail_consent(pool: PgPool) -> anyhow::Result<()> {
    // CI clones a fully migrated template even for migrations=false. Rebuild
    // only this disposable SQLx test database to exercise the actual upgrade.
    sqlx::raw_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        .execute(&pool)
        .await?;
    let before = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            MACRO_DB_MIGRATIONS
                .iter()
                .filter(|m| m.version < 20261116164513)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before.run(&pool).await?;
    let team = Uuid::now_v7();
    seed_team(&pool, team, OWNER).await?;
    let link = insert_email_link(&pool, OWNER, "owner@example.com").await?;
    // Seed the deployed writer's columns before the foundation exists. The
    // current repository now reads selected_enabled in its response.
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
        team, OWNER
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled) VALUES ($1, $2, $3, TRUE)",
        team, OWNER, link
    ).execute(&pool).await?;
    MACRO_DB_MIGRATIONS.run(&pool).await?;
    let state = sqlx::query!(
        "SELECT enabled, mode, selected_enabled, active_rule_revision, policy_version FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team, OWNER
    ).fetch_one(&pool).await?;
    assert!(state.enabled);
    assert_eq!(state.mode, "all");
    assert!(!state.selected_enabled);
    assert_eq!(state.active_rule_revision, None);
    assert_eq!(state.policy_version, 0);
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_rule_revisions")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn compatible_readers_recognize_selected_and_old_writes_cannot_expand_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link) = setup(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let thread =
        insert_interaction(&pool, link, "person@example.org", chrono::Utc::now(), true).await?;
    let company = insert_company(&pool, team, true, &["example.org"]).await?;
    insert_contact(&pool, company, "person@example.org").await?;
    let version = seed_selected(&pool, team).await?;
    assert!(repo.email_privacy(team, OWNER).await?.enabled);
    assert!(repo.contribution_mailbox(team, OWNER).await?.is_some());
    assert!(
        !sqlx::query_scalar!(
            r#"SELECT crm_email_thread_allowed($1, $2) AS "allowed!""#,
            team,
            thread
        )
        .fetch_one(&pool)
        .await?
    );
    assert!(
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::SetConsent {
                enabled: true,
                link_id: Some(link),
            }
        )
        .await
        .is_err(),
        "the actual legacy upsert must not broaden a selected policy"
    );
    assert!(selected_enabled(&pool, team).await?);
    // The legacy bit is already false: an UPDATE OF false must still revoke.
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    let state = sqlx::query!(
        "SELECT enabled, selected_enabled, mode, active_rule_revision, policy_version FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team, OWNER
    ).fetch_one(&pool).await?;
    assert!(!state.enabled && !state.selected_enabled);
    assert_eq!(state.mode, "selected");
    assert_eq!(state.active_rule_revision, Some(1));
    assert_eq!(state.policy_version, version + 1);
    assert_eq!(count_contacts(&pool, company).await?, 1);
    assert_eq!(fetch_company_hidden(&pool, company).await?, Some(false));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn selected_grants_bind_revision_to_member_and_mailbox(pool: PgPool) -> anyhow::Result<()> {
    let (team, _link) = setup(&pool).await?;
    let other_link = insert_email_link(&pool, OWNER, "secondary@example.com").await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 2, $3, 1, '{}')",
        team, OWNER, other_link
    ).execute(&pool).await?;
    seed_selected(&pool, team).await?;
    let error = sqlx::query!(
        "UPDATE crm_email_consent SET active_rule_revision = 2 WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23503")
    );
    let error = sqlx::query!(
        "UPDATE crm_email_consent SET active_rule_revision = NULL WHERE team_id = $1 AND user_id = $2",
        team, OWNER
    ).execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23514")
    );
    let other_team = Uuid::now_v7();
    let other_owner = "macro|other@example.com";
    seed_team(&pool, other_team, other_owner).await?;
    let other_primary = insert_email_link(&pool, other_owner, "other@example.com").await?;
    consent_to_mailbox(&pool, other_team, other_primary).await?;
    sqlx::query!(
        "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
        other_team,
        other_owner
    )
    .execute(&pool)
    .await?;
    let error = sqlx::query!(
        "UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = 1 WHERE team_id = $1 AND user_id = $2",
        other_team, other_owner
    ).execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("23503")
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mailbox_changes_revoke_selected_without_reactivation(pool: PgPool) -> anyhow::Result<()> {
    let (team, link) = setup(&pool).await?;
    let version = seed_selected(&pool, team).await?;
    // Ordinary sync metadata writes have no effect on a current policy.
    sqlx::query!(
        "UPDATE email_links SET updated_at = now() WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(selected_enabled(&pool, team).await?);
    assert_eq!(sqlx::query_scalar!(
        "UPDATE crm_email_consent SET policy_version = 999 WHERE team_id = $1 AND user_id = $2 RETURNING policy_version",
        team, OWNER
    ).fetch_one(&pool).await?, version, "callers cannot forge the CAS version");
    for disconnected in [true, false] {
        sqlx::query!(
            "UPDATE email_links SET disconnect_requested_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1",
            link, disconnected
        ).execute(&pool).await?;
        assert!(!selected_enabled(&pool, team).await?);
    }
    seed_selected(&pool, team).await?;
    for needs_reauth in [true, false] {
        sqlx::query!(
            "UPDATE email_links SET needs_reauth = $2 WHERE id = $1",
            link,
            needs_reauth
        )
        .execute(&pool)
        .await?;
        assert!(!selected_enabled(&pool, team).await?);
    }
    seed_selected(&pool, team).await?;
    for address in ["changed@example.com", "owner@example.com"] {
        sqlx::query!(
            "UPDATE email_links SET email_address = $2 WHERE id = $1",
            link,
            address
        )
        .execute(&pool)
        .await?;
        assert!(!selected_enabled(&pool, team).await?);
    }
    seed_team(&pool, Uuid::now_v7(), "macro|other@example.com").await?;
    seed_selected(&pool, team).await?;
    for owner in ["macro|other@example.com", OWNER] {
        sqlx::query!(
            "UPDATE email_links SET macro_id = $2 WHERE id = $1",
            link,
            owner
        )
        .execute(&pool)
        .await?;
        assert!(!selected_enabled(&pool, team).await?);
    }
    seed_selected(&pool, team).await?;
    for deleting in [true, false] {
        sqlx::query!(
            "UPDATE email_links SET deleting_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1",
            link, deleting
        ).execute(&pool).await?;
        assert!(!selected_enabled(&pool, team).await?);
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn membership_and_mailbox_deletion_remove_private_policy_history(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link) = setup(&pool).await?;
    seed_selected(&pool, team).await?;
    let event = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_email_policy_audit (team_id, user_id, event_id, link_id, policy_version, action, actor_kind, next_revision) VALUES ($1, $2, $3, $4, 2, 'rules_activated', 'api', 1)",
        team, OWNER, event, link
    ).execute(&pool).await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, 'person@example.org')",
        team, OWNER
    ).execute(&pool).await?;
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_rule_revisions WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_rule_addresses WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_policy_audit WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    consent_to_mailbox(&pool, team, link).await?;
    sqlx::query!(
        "INSERT INTO crm_email_rule_revisions (team_id, user_id, revision, link_id, schema_version, definition) VALUES ($1, $2, 1, $3, 1, '{}')",
        team, OWNER, link
    ).execute(&pool).await?;
    seed_selected(&pool, team).await?;
    sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
        .execute(&pool)
        .await?;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_rule_revisions WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_consent WHERE team_id = $1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

/// The migration runs before all inline readers have been upgraded. A selected
/// row at that point violates the rollout premise, even if its grant is off.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn eligibility_upgrade_refuses_preexisting_selected_mode(pool: PgPool) -> anyhow::Result<()> {
    let (team, _) = setup(&pool).await?;
    seed_selected(&pool, team).await?;
    for granted in [true, false] {
        sqlx::query!(
            "UPDATE crm_email_consent SET selected_enabled = $2 WHERE team_id = $1",
            team,
            granted
        )
        .execute(&pool)
        .await?;
        let mut tx = pool.begin().await?;
        let error = sqlx::raw_sql(include_str!("../../../../../macro_db_client/migrations/20261116223559_crm_selected_email_eligibility.sql"))
            .execute(&mut *tx).await.expect_err("old inline readers cannot coexist with selected rows during this rollout");
        assert!(
            error
                .to_string()
                .contains("selected consent exists before compatible eligibility readers")
        );
        tx.rollback().await?;
    }
    Ok(())
}
