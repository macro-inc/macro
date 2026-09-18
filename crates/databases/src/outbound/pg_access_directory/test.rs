//! Postgres tests for the access directory.
//!
//! The point of interest is the source-id rule: a grant written against the
//! user, against one of their teams, or against a channel they are in must all
//! reach them, and nothing else may. That rule is `entity_access`'s and is
//! asked of it, so these tests are really checking that the directory asks
//! correctly and that the answer is bound into the query.
//!
//! `entity_access` memoizes a user's source ids for 30s, keyed by user id, and
//! that cache is process-wide while each `sqlx::test` gets its own database —
//! so every test here mints unique user ids rather than sharing a constant.

use entity_access_db_utils::{AccessLevel, EntityAccessSourceType};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::models::{CreateDatabase, Database};
use crate::domain::ports::DatabasesRepo;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;

/// A user id no other test in this process shares, so the source-id cache
/// cannot carry one test's answer into another's database.
fn unique_user() -> MacroUserIdStr<'static> {
    let id = format!("macro|databases-dir-{}@macro.com", Uuid::new_v4());
    MacroUserIdStr::parse_from_str(&id)
        .expect("valid user id")
        .into_owned()
}

async fn insert_user(pool: &PgPool, user_id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        user_id,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user_id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

async fn create_database(pool: &PgPool, owner: &MacroUserIdStr<'static>) -> Database {
    PgDatabasesRepo::new(pool.clone())
        .create_database(
            &CreateDatabase {
                name: "Offsite".to_string(),
                owner_id: owner.clone(),
            },
            "Table 1",
        )
        .await
        .expect("database should insert")
}

/// Write a grant the way sharing does, against an arbitrary source.
async fn grant(
    pool: &PgPool,
    database_id: Uuid,
    source_id: &str,
    source_type: EntityAccessSourceType,
    level: AccessLevel,
) {
    let mut transaction = pool.begin().await.expect("transaction should begin");
    entity_access_db_utils::insert_entity_access_row(
        &mut transaction,
        &database_id,
        model_entity::EntityType::Database,
        source_id,
        source_type,
        level,
    )
    .await
    .expect("grant should insert");
    transaction.commit().await.expect("commit should succeed");
}

async fn accessible(pool: &PgPool, user: &MacroUserIdStr<'static>) -> Vec<(Uuid, AccessGrant)> {
    PgAccessDirectory::new(pool.clone())
        .accessible_databases(&Viewer {
            user_id: user.clone(),
        })
        .await
        .expect("directory should answer")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_owner_sees_their_own_database_and_a_stranger_sees_nothing(pool: PgPool) {
    let owner = unique_user();
    let stranger = unique_user();
    insert_user(&pool, owner.as_ref()).await;
    insert_user(&pool, stranger.as_ref()).await;

    let database = create_database(&pool, &owner).await;

    assert_eq!(
        accessible(&pool, &owner).await,
        vec![(database.id, AccessGrant::Owner)]
    );
    assert!(accessible(&pool, &stranger).await.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_or_channel_grant_reaches_its_members(pool: PgPool) {
    let owner = unique_user();
    let teammate = unique_user();
    let channel_member = unique_user();
    for user in [&owner, &teammate, &channel_member] {
        insert_user(&pool, user.as_ref()).await;
    }

    let team_database = create_database(&pool, &owner).await;
    let channel_database = create_database(&pool, &owner).await;

    let team_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)"#,
        team_id,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .expect("team should insert");
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        teammate.as_ref(),
        team_id,
    )
    .execute(&pool)
    .await
    .expect("membership should insert");
    grant(
        &pool,
        team_database.id,
        &team_id.to_string(),
        EntityAccessSourceType::Team,
        AccessLevel::Edit,
    )
    .await;

    let channel_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Chan', 'private', $2)"#,
        channel_id,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .expect("channel should insert");
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')"#,
        channel_id,
        channel_member.as_ref(),
    )
    .execute(&pool)
    .await
    .expect("participant should insert");
    grant(
        &pool,
        channel_database.id,
        &channel_id.to_string(),
        EntityAccessSourceType::Channel,
        AccessLevel::View,
    )
    .await;

    assert_eq!(
        accessible(&pool, &teammate).await,
        vec![(team_database.id, AccessGrant::Edit)],
        "a team grant reaches a team member and nothing else"
    );
    assert_eq!(
        accessible(&pool, &channel_member).await,
        vec![(channel_database.id, AccessGrant::View)],
        "a channel grant reaches a participant and nothing else"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_highest_grant_wins_and_trashed_databases_drop_out(pool: PgPool) {
    let owner = unique_user();
    let teammate = unique_user();
    insert_user(&pool, owner.as_ref()).await;
    insert_user(&pool, teammate.as_ref()).await;

    let database = create_database(&pool, &owner).await;
    let trashed = create_database(&pool, &owner).await;

    let team_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Team', $2)"#,
        team_id,
        owner.as_ref(),
    )
    .execute(&pool)
    .await
    .expect("team should insert");
    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        teammate.as_ref(),
        team_id,
    )
    .execute(&pool)
    .await
    .expect("membership should insert");

    // Two grants on the same database through two different sources.
    grant(
        &pool,
        database.id,
        teammate.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::View,
    )
    .await;
    grant(
        &pool,
        database.id,
        &team_id.to_string(),
        EntityAccessSourceType::Team,
        AccessLevel::Edit,
    )
    .await;
    grant(
        &pool,
        trashed.id,
        teammate.as_ref(),
        EntityAccessSourceType::User,
        AccessLevel::Edit,
    )
    .await;

    PgDatabasesRepo::new(pool.clone())
        .trash_database(trashed.id, chrono::Utc::now())
        .await
        .expect("trash should succeed");

    assert_eq!(
        accessible(&pool, &teammate).await,
        vec![(database.id, AccessGrant::Edit)],
        "the strongest grant wins, and a trashed database is not listed"
    );
}
