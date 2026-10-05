use super::*;
use crate::outbound::pg_access_repo::queries::get_user_source_ids;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

const OWNER: &str = "macro|owner@team.com";
const MEMBER: &str = "macro|member@team.com";
const MEMBER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";

/// A database with one table and one row; returns `(database_id, row_id)`.
async fn insert_row(pool: &PgPool) -> (Uuid, Uuid) {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let row_id = Uuid::now_v7();
    sqlx::query!(
        r#"WITH storage AS (INSERT INTO databases (id) VALUES ($1) RETURNING id)
           INSERT INTO database_entities (database_id, name, user_id) SELECT id, 'db', $2 FROM storage"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 't', 'a')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, 'a')"#,
        row_id,
        table_id,
    )
    .execute(pool)
    .await
    .unwrap();
    (database_id, row_id)
}

async fn source_ids(pool: &PgPool, email: &str) -> SourceIds {
    let user = MacroUserIdStr::try_from_email(email).unwrap();
    get_user_source_ids(pool, Some(&user)).await.unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn row_access_is_the_highest_grant_on_its_database(pool: PgPool) {
    let (database_id, row_id) = insert_row(&pool).await;
    let (other_database_id, other_row_id) = insert_row(&pool).await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $3, 'user', 'view'),
               ($1, 'database', $4, 'team', 'edit'),
               ($1, 'chat', $3, 'user', 'owner'),
               ($2, 'database', $3, 'user', 'owner')
        "#,
        database_id,
        other_database_id,
        MEMBER,
        MEMBER_TEAM,
    )
    .execute(&pool)
    .await
    .unwrap();

    let member = source_ids(&pool, "member@team.com").await;
    assert_eq!(
        get_database_row_access(&pool, &row_id, &member)
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );

    let missing_row_id = Uuid::now_v7();
    assert_eq!(
        get_database_rows_access(&pool, &[row_id, other_row_id, missing_row_id], &member)
            .await
            .unwrap(),
        std::collections::HashMap::from([
            (row_id, AccessLevel::Edit),
            (other_row_id, AccessLevel::Owner)
        ])
    );
    assert!(
        get_database_rows_access(&pool, &[], &member)
            .await
            .unwrap()
            .is_empty()
    );

    let outsider = source_ids(&pool, "noteam@team.com").await;
    assert!(
        get_database_rows_access(&pool, &[row_id, other_row_id], &outsider)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        get_database_row_access(&pool, &row_id, &outsider)
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn unknown_row_has_no_access(pool: PgPool) {
    let member = source_ids(&pool, "member@team.com").await;
    assert_eq!(
        get_database_row_access(&pool, &Uuid::now_v7(), &member)
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_row_belongs_to_the_database_of_its_table(pool: PgPool) {
    let (database_id, row_id) = insert_row(&pool).await;

    assert_eq!(
        get_database_row_database(&pool, &row_id).await.unwrap(),
        Some(database_id)
    );
    assert_eq!(
        get_database_row_database(&pool, &Uuid::now_v7())
            .await
            .unwrap(),
        None
    );
}
