use super::*;
use crate::outbound::pg_access_repo::queries::get_user_source_ids;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

const OWNER: &str = "macro|owner@team.com";
const MEMBER: &str = "macro|member@team.com";
const MEMBER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn core_storage_does_not_become_an_entity_through_a_stray_grant(pool: PgPool) {
    use super::super::database_row_access::{
        get_database_row_access, get_database_row_database, get_database_rows_access,
    };
    let database = Uuid::now_v7();
    let table = Uuid::now_v7();
    let row = Uuid::now_v7();
    sqlx::query!("INSERT INTO databases (id) VALUES ($1)", database)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!("INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Contacts', '80')", table, database)
        .execute(&pool).await.unwrap();
    sqlx::query!(
        "INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, '80')",
        row,
        table
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'database', $2, 'user', 'owner')", database, OWNER)
        .execute(&pool).await.unwrap();
    let owner = source_ids(&pool, "owner@team.com").await;
    assert_eq!(
        get_database_access(&pool, &database, &owner).await.unwrap(),
        None
    );
    assert!(
        list_database_access(&pool, &owner)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        get_database_row_access(&pool, &row, &owner).await.unwrap(),
        None
    );
    assert!(
        get_database_rows_access(&pool, &[row], &owner)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(get_database_row_database(&pool, &row).await.unwrap(), None);
}

async fn insert_database(pool: &PgPool) -> Uuid {
    let database_id = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'db', $2 FROM storage"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    database_id
}

async fn source_ids(pool: &PgPool, email: &str) -> SourceIds {
    let user = MacroUserIdStr::try_from_email(email).unwrap();
    get_user_source_ids(pool, Some(&user)).await.unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn every_reachable_database_is_listed_at_its_highest_grant(pool: PgPool) {
    let shared = insert_database(&pool).await;
    let owned = insert_database(&pool).await;
    let unrelated = insert_database(&pool).await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $4, 'user', 'view'),
               ($1, 'database', $5, 'team', 'edit'),
               ($2, 'database', $4, 'user', 'owner'),
               ($2, 'chat', $4, 'user', 'view'),
               ($3, 'database', $6, 'user', 'owner')
        "#,
        shared,
        owned,
        unrelated,
        MEMBER,
        MEMBER_TEAM,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    let member = source_ids(&pool, "member@team.com").await;
    let mut expected = vec![(shared, AccessLevel::Edit), (owned, AccessLevel::Owner)];
    expected.sort();
    assert_eq!(
        list_database_access(&pool, &member).await.unwrap(),
        expected
    );

    let outsider = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        list_database_access(&pool, &outsider).await.unwrap(),
        Vec::new()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_channel_grant_reaches_its_active_participants(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let channel_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Chan', 'private', $2)"#,
        channel_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, 'macro|noteam@team.com', 'member')"#,
        channel_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $2, 'channel', 'view')
        "#,
        database_id,
        channel_id.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let participant = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        list_database_access(&pool, &participant).await.unwrap(),
        vec![(database_id, AccessLevel::View)]
    );
    let member = source_ids(&pool, "member@team.com").await;
    assert_eq!(
        list_database_access(&pool, &member).await.unwrap(),
        Vec::new()
    );
}
