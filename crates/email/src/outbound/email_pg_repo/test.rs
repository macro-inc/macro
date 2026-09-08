mod crm_scope_dynamic_query;
mod draft;
mod dynamic_query;
mod importance_pagination;
mod labels;
mod link;
mod message;
mod preview;
mod project;
mod project_scope_dynamic_query;
mod settings;
mod signal_flag;
mod thread;
mod thread_labels;

use std::sync::Arc;

use entity_access_db_utils::{
    AccessLevel, EntityType,
    project_inheritance::synchronize_project_team_share,
    team_share::{acquire_guard, delete_direct, upsert_direct},
};

use super::*;
use crate::domain::models::{LabelType, PreviewView, PreviewViewStandardLabel};
use crate::domain::ports::EmailRepo;
use chrono::{TimeZone, Utc};
use filter_ast::Expr;
use item_filters::ast::date::DateLiteral;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const MOVE_ROOT: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000001);
const MOVE_CHILD: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000007);
const MOVE_THREAD: Uuid = Uuid::from_u128(0x20000000_0000_0000_0000_000000000004);
const MOVE_TEAM: Uuid = Uuid::from_u128(0x10000000_0000_0000_0000_000000000001);

async fn setup_thread_move(pool: &Pool<Postgres>) -> rootcause::Result<()> {
    let mut tx = pool.begin().await?;
    acquire_guard(&mut tx).await?;
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId", "parentId")
        VALUES ($1, 'Nested', 'macro|owner@example.com', $2)"#,
        MOVE_CHILD.to_string(),
        MOVE_ROOT.to_string(),
    )
    .execute(tx.as_mut())
    .await?;
    sqlx::query!(r#"INSERT INTO "SharePermission" (id) VALUES ('child')"#)
        .execute(tx.as_mut())
        .await?;
    sqlx::query!(
        r#"INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES ($1, 'child')"#,
        MOVE_CHILD.to_string(),
    )
    .execute(tx.as_mut())
    .await?;
    let permission_id =
        share_permission_db_utils::team_share::ensure_thread_share_permission_in_transaction(
            &mut tx,
            &MOVE_THREAD.to_string(),
        )
        .await?;
    for (entity_id, entity_type, permission_id, level) in [
        (MOVE_ROOT, EntityType::Project, "project", AccessLevel::Edit),
        (
            MOVE_CHILD,
            EntityType::Project,
            "child",
            AccessLevel::Comment,
        ),
        (
            MOVE_THREAD,
            EntityType::EmailThread,
            permission_id.as_str(),
            AccessLevel::View,
        ),
    ] {
        sqlx::query!(
            r#"UPDATE "SharePermission" SET team_share_access_level = $2,
            team_share_team_id = $3, team_share_revision = 1 WHERE id = $1"#,
            permission_id,
            level as _,
            MOVE_TEAM,
        )
        .execute(tx.as_mut())
        .await?;
        upsert_direct(tx.as_mut(), &entity_id, entity_type, MOVE_TEAM, level).await?;
    }
    tx.commit().await?;
    Ok(())
}

async fn thread_team_grants(
    pool: &Pool<Postgres>,
) -> rootcause::Result<Vec<(Option<String>, AccessLevel)>> {
    Ok(sqlx::query!(
        r#"SELECT granted_from_project_id, access_level AS "access_level: AccessLevel"
        FROM entity_access WHERE entity_id = $1 AND entity_type = 'email_thread'
        AND source_type = 'team' AND source_id = $2
        ORDER BY granted_from_project_id NULLS FIRST"#,
        MOVE_THREAD,
        MOVE_TEAM.to_string(),
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| (row.granted_from_project_id, row.access_level))
    .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../share_permission_db_utils/fixtures",
        scripts("team_share")
    )
)]
async fn thread_move_preserves_direct_share_and_current_ancestor_grants(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_thread_move(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    for _ in 0..2 {
        assert!(
            repo.update_thread_project(MOVE_THREAD, Some(&MOVE_CHILD.to_string()))
                .await?
        );
        assert_eq!(
            thread_team_grants(&pool).await?,
            vec![
                (None, AccessLevel::View),
                (Some(MOVE_ROOT.to_string()), AccessLevel::Edit),
                (Some(MOVE_CHILD.to_string()), AccessLevel::Comment),
            ]
        );
    }
    assert!(
        repo.update_thread_project(MOVE_THREAD, Some(&MOVE_ROOT.to_string()))
            .await?
    );
    assert_eq!(
        thread_team_grants(&pool).await?,
        vec![
            (None, AccessLevel::View),
            (Some(MOVE_ROOT.to_string()), AccessLevel::Edit),
        ]
    );
    assert!(repo.update_thread_project(MOVE_THREAD, None).await?);
    assert_eq!(
        thread_team_grants(&pool).await?,
        vec![(None, AccessLevel::View)]
    );
    let state = sqlx::query!(
        r#"SELECT sp.team_share_access_level AS "level: AccessLevel",
        sp.team_share_team_id, sp.team_share_revision
        FROM "SharePermission" sp JOIN "EmailThreadPermission" tp ON tp."sharePermissionId" = sp.id
        WHERE tp."threadId" = $1"#,
        MOVE_THREAD.to_string(),
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(state.level, Some(AccessLevel::View));
    assert_eq!(state.team_share_team_id, Some(MOVE_TEAM));
    assert_eq!(state.team_share_revision, 1);
    assert!(!repo.update_thread_project(Uuid::now_v7(), None).await?);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../share_permission_db_utils/fixtures",
        scripts("team_share")
    )
)]
async fn thread_move_rolls_back_assignment_and_grants_on_inheritance_failure(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_thread_move(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    assert!(
        repo.update_thread_project(MOVE_THREAD, Some(&MOVE_ROOT.to_string()))
            .await?
    );
    let before = repo.thread_by_id(MOVE_THREAD).await?.unwrap();
    let grants = thread_team_grants(&pool).await?;
    // Force only the new child's inherited contribution to fail.
    sqlx::raw_sql(
        "ALTER TABLE entity_access ADD CONSTRAINT reject_thread_inheritance CHECK (
        entity_type != 'email_thread' OR granted_from_project_id IS DISTINCT FROM
        '20000000-0000-0000-0000-000000000007')",
    )
    .execute(&pool)
    .await?;
    assert!(
        repo.update_thread_project(MOVE_THREAD, Some(&MOVE_CHILD.to_string()))
            .await
            .is_err()
    );
    let after = repo.thread_by_id(MOVE_THREAD).await?.unwrap();
    assert_eq!(after.project_id, before.project_id);
    assert_eq!(after.updated_at, before.updated_at);
    assert_eq!(thread_team_grants(&pool).await?, grants);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../share_permission_db_utils/fixtures",
        scripts("team_share")
    )
)]
async fn thread_move_waits_for_project_revoke_before_changing_assignment(
    pool: Pool<Postgres>,
) -> rootcause::Result<()> {
    setup_thread_move(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let mut revoke = pool.begin().await?;
    acquire_guard(&mut revoke).await?;
    delete_direct(revoke.as_mut(), &MOVE_ROOT, EntityType::Project, MOVE_TEAM).await?;
    sqlx::query!(
        r#"UPDATE "SharePermission" SET team_share_access_level = NULL,
        team_share_team_id = NULL, team_share_revision = team_share_revision + 1 WHERE id = 'project'"#,
    )
    .execute(revoke.as_mut())
    .await?;
    synchronize_project_team_share(&mut revoke, &MOVE_ROOT, MOVE_TEAM, None).await?;

    let barrier = Arc::new(tokio::sync::Barrier::new(2));
    let contender_barrier = barrier.clone();
    let contender = tokio::spawn(async move {
        contender_barrier.wait().await;
        repo.update_thread_project(MOVE_THREAD, Some(&MOVE_CHILD.to_string()))
            .await
    });
    barrier.wait().await;
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            assert!(!contender.is_finished(), "move must wait for the shared guard");
            let waiting = sqlx::query_scalar!(
                "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
                AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database()))"
            )
            .fetch_one(revoke.as_mut())
            .await?;
            if waiting == Some(true) {
                break;
            }
            tokio::task::yield_now().await;
        }
        Ok::<_, sqlx::Error>(())
    }).await??;
    assert_eq!(
        super::thread::get_thread_project_id(&pool, MOVE_THREAD).await?,
        None
    );
    revoke.commit().await?;
    assert!(contender.await??);
    assert_eq!(
        thread_team_grants(&pool).await?,
        vec![
            (None, AccessLevel::View),
            (Some(MOVE_CHILD.to_string()), AccessLevel::Comment),
        ]
    );
    Ok(())
}

/// Recomputes `is_signal` for every fixture thread via the real sync
/// function, so importance tests exercise the heuristic → flag → query chain
/// end-to-end instead of trusting hand-written fixture verdicts.
async fn sync_all_signal_flags(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    let thread_ids: Vec<Uuid> = sqlx::query_scalar!("SELECT id FROM email_threads")
        .fetch_all(pool)
        .await?;
    let mut conn = pool.acquire().await?;
    for id in thread_ids {
        super::thread::sync_thread_signal_flag(&mut conn, id).await?;
    }
    Ok(())
}
