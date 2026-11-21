mod all_mail;
#[cfg(feature = "inbound")]
mod api;
mod envelopes;
mod history;
mod source_changes;
mod sources;
mod targets;

use super::helpers::*;
use crate::{
    domain::{
        email_policy::*,
        email_privacy::{EmailPrivacyChange, EmailPrivacyRepository},
        email_rules::*,
    },
    outbound::companies_repo::CompaniesRepositoryImpl,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const OWNER: &str = "macro|owner@example.com";

async fn setup(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, CompaniesRepositoryImpl)> {
    let team = Uuid::now_v7();
    seed_team(pool, team, OWNER).await?;
    let link = insert_email_link(pool, OWNER, "owner@example.com").await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        OWNER
    )
    .execute(pool)
    .await?;
    Ok((team, link, CompaniesRepositoryImpl::new(pool.clone())))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_initialization_preserves_grant_version_and_private_access(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    sqlx::query!(
        "UPDATE team_user SET crm_access = FALSE WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    let before = sqlx::query!("SELECT policy_version, consent_incarnation FROM crm_email_consent WHERE team_id = $1 AND user_id = $2", team, OWNER).fetch_one(&pool).await?;
    assert!(before.consent_incarnation.is_none());
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .expect("existing grant");
    let generation = tx.state().generation;
    assert!(tx.state().enabled);
    assert!(!tx.state().selected_enabled);
    assert_eq!(tx.state().mode, EmailContributionMode::All);
    assert_eq!(generation.policy_version, before.policy_version);
    tx.commit().await?;

    // Lifecycle revocation still works, and inspection/withdrawal identity is
    // retained even though a new activation would require a healthy primary.
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = TRUE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .expect("disconnected existing consent");
    assert!(!tx.state().enabled);
    assert_eq!(
        tx.state().generation.consent_incarnation,
        generation.consent_incarnation
    );
    assert_eq!(
        tx.state().generation.policy_version,
        generation.policy_version + 1
    );
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn absent_consent_requires_a_current_member_and_exact_connected_primary(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: Uuid::now_v7()
            }
        )
        .await?
        .is_none()
    );
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None
            }
        )
        .await?
        .is_none()
    );
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(Uuid::now_v7())
            }
        )
        .await?
        .is_none()
    );
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = TRUE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link)
            }
        )
        .await?
        .is_none()
    );
    sqlx::query!(
        "UPDATE email_links SET needs_reauth = FALSE WHERE id = $1",
        link
    )
    .execute(&pool)
    .await?;
    let other_team = Uuid::now_v7();
    seed_team(&pool, other_team, "macro|other@example.com").await?;
    assert!(
        repo.open_email_policy(
            other_team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link)
            }
        )
        .await?
        .is_none()
    );
    assert!(
        repo.open_email_policy(
            team,
            "macro|other@example.com",
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link)
            }
        )
        .await?
        .is_none()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_consent")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );

    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("fresh disabled consent");
    assert!(!tx.state().enabled);
    assert!(!tx.state().selected_enabled);
    assert_eq!(tx.state().generation.policy_version, 0);
    assert_eq!(tx.state().mode, EmailContributionMode::All);
    assert!(tx.state().active_rule_revision.is_none());
    tx.commit().await?;
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_backfill_outbox")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_recreate_and_leave_rejoin_never_reuse_a_consent_token(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("initialize");
    let first = tx.state().generation;
    tx.commit().await?;
    sqlx::query!(
        "DELETE FROM crm_email_consent WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: first.consent_incarnation
            }
        )
        .await?
        .is_none()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM crm_email_consent")
            .fetch_one(&pool)
            .await?,
        Some(0)
    );
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("new lifetime");
    let second = tx.state().generation;
    tx.commit().await?;
    assert_ne!(first.consent_incarnation, second.consent_incarnation);
    assert_eq!(first.policy_version, second.policy_version);
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: first.consent_incarnation
            }
        )
        .await?
        .is_none()
    );
    sqlx::query!(
        "DELETE FROM team_user WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link)
            }
        )
        .await?
        .is_none()
    );
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        OWNER
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: second.consent_incarnation
            }
        )
        .await?
        .is_none()
    );
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: Some(link),
            },
        )
        .await?
        .expect("rejoined lifetime");
    assert_ne!(
        tx.state().generation.consent_incarnation,
        first.consent_incarnation
    );
    assert_ne!(
        tx.state().generation.consent_incarnation,
        second.consent_incarnation
    );
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn incarnation_initialization_is_atomic_and_immutable(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let error = sqlx::query!("UPDATE crm_email_consent SET consent_incarnation = $3, enabled = FALSE WHERE team_id = $1 AND user_id = $2", team, OWNER, Uuid::now_v7()).execute(&pool).await.unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55000")
    );
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Initialize {
                primary_link_id: None,
            },
        )
        .await?
        .expect("initialize");
    let generation = tx.state().generation;
    tx.commit().await?;
    for incarnation in [None, Some(Uuid::now_v7())] {
        let error = sqlx::query!("UPDATE crm_email_consent SET consent_incarnation = $3 WHERE team_id = $1 AND user_id = $2", team, OWNER, incarnation).execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("55000")
        );
    }
    let error = sqlx::query!(
        "UPDATE crm_email_consent SET team_id = $3 WHERE team_id = $1 AND user_id = $2",
        team,
        OWNER,
        Uuid::now_v7()
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().and_then(|e| e.code()).as_deref(),
        Some("55000")
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
    let tx = repo
        .open_email_policy(
            team,
            OWNER,
            OpenEmailPolicy::Existing {
                consent_incarnation: generation.consent_incarnation,
            },
        )
        .await?
        .expect("same lifetime");
    assert_eq!(
        tx.state().generation.policy_version,
        generation.policy_version + 1
    );
    assert!(!tx.state().enabled);
    tx.commit().await?;
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_initializers_share_one_identity(pool: PgPool) -> anyhow::Result<()> {
    let (team, link, repo) = setup(&pool).await?;
    let first = async {
        let tx = repo
            .open_email_policy(
                team,
                OWNER,
                OpenEmailPolicy::Initialize {
                    primary_link_id: Some(link),
                },
            )
            .await?
            .expect("first");
        let generation = tx.state().generation;
        tx.commit().await?;
        anyhow::Ok(generation)
    };
    let second = async {
        let tx = repo
            .open_email_policy(
                team,
                OWNER,
                OpenEmailPolicy::Initialize {
                    primary_link_id: Some(link),
                },
            )
            .await?
            .expect("second");
        let generation = tx.state().generation;
        tx.commit().await?;
        anyhow::Ok(generation)
    };
    let (first, second) = tokio::join!(first, second);
    assert_eq!(first?, second?);
    Ok(())
}
