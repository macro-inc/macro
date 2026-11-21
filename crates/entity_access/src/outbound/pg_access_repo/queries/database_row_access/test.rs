use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use std::collections::BTreeMap;
use uuid::Uuid;

const OWNER: &str = "macro|owner@team.com";
const MEMBER: &str = "macro|member@team.com";
const MEMBER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";
/// In no team, and in no channel unless a test adds them to one.
const NO_TEAM: &str = "macro|database-row-no-team@example.com";

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
    assert_eq!(
        get_database_row_access(&pool, &row_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );

    let missing_row_id = Uuid::now_v7();
    assert_eq!(
        get_database_rows_access(
            &pool,
            &[row_id, other_row_id, missing_row_id],
            Viewer::User(MEMBER)
        )
        .await
        .unwrap(),
        std::collections::HashMap::from([
            (row_id, AccessLevel::Edit),
            (other_row_id, AccessLevel::Owner)
        ])
    );
    assert!(
        get_database_rows_access(&pool, &[], Viewer::User(MEMBER))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        get_database_rows_access(&pool, &[row_id, other_row_id], Viewer::User(NO_TEAM))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        get_database_row_access(&pool, &row_id, Viewer::User(NO_TEAM))
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
    assert_eq!(
        get_database_row_access(&pool, &Uuid::now_v7(), Viewer::User(MEMBER))
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

/// A form over the table holding `row_id`, granting `MEMBER` `level` on it.
async fn insert_form_over_row(pool: &PgPool, row_id: Uuid, level: &str, trashed: bool) -> Uuid {
    let form_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id, trashed_at)
        SELECT $1, 'RSVP', $2, t.database_id, t.id, CASE WHEN $3 THEN now() END
        FROM database_rows r
        JOIN database_tables t ON t.id = r.table_id
        WHERE r.id = $4
        "#,
        form_id,
        OWNER,
        trashed,
        row_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $2, 'user', ($3::text)::"AccessLevel")
        "#,
        form_id,
        MEMBER,
        level,
    )
    .execute(pool)
    .await
    .unwrap();
    form_id
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_form_editor_edits_the_rows_of_its_database(pool: PgPool) {
    let (_, edited) = insert_row(&pool).await;
    let (_, viewed) = insert_row(&pool).await;
    let (_, trashed) = insert_row(&pool).await;
    insert_form_over_row(&pool, edited, "edit", false).await;
    insert_form_over_row(&pool, viewed, "view", false).await;
    insert_form_over_row(&pool, trashed, "owner", true).await;
    assert_eq!(
        get_database_row_access(&pool, &edited, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        get_database_row_access(&pool, &viewed, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        get_database_row_access(&pool, &trashed, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        get_database_rows_access(&pool, &[edited, viewed, trashed], Viewer::User(MEMBER))
            .await
            .unwrap(),
        HashMap::from([(edited, AccessLevel::Edit)])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_direct_database_grant_above_edit_wins_over_a_form_on_rows(pool: PgPool) {
    let (database_id, row_id) = insert_row(&pool).await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $2, 'user', 'owner')
        "#,
        database_id,
        MEMBER,
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_form_over_row(&pool, row_id, "edit", false).await;
    assert_eq!(
        get_database_row_access(&pool, &row_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        get_database_rows_access(&pool, &[row_id], Viewer::User(MEMBER))
            .await
            .unwrap(),
        HashMap::from([(row_id, AccessLevel::Owner)])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn viewing_a_form_that_shares_responses_views_the_rows_of_its_database(pool: PgPool) {
    let (_, shared) = insert_row(&pool).await;
    let (_, hidden) = insert_row(&pool).await;
    let form_id = insert_form_over_row(&pool, shared, "view", false).await;
    insert_form_over_row(&pool, hidden, "view", false).await;
    sqlx::query!(
        r#"UPDATE forms SET responses_visible = TRUE WHERE id = $1"#,
        form_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_database_row_access(&pool, &shared, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    assert_eq!(
        get_database_row_access(&pool, &hidden, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        get_database_rows_access(&pool, &[shared, hidden], Viewer::User(MEMBER))
            .await
            .unwrap(),
        HashMap::from([(shared, AccessLevel::View)])
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_database")
    )
)]
async fn database_row_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let rows = sqlx::query_scalar!(r#"SELECT id FROM database_rows ORDER BY id"#)
        .fetch_all(&pool)
        .await?;

    assert_matrix_agrees(&viewers, &rows, async |viewer, row_id| {
        Ok((
            source_list_oracle::get_database_row_access(&pool, row_id, &viewer.sources).await?,
            get_database_row_access(&pool, row_id, viewer.viewer()).await?,
        ))
    })
    .await?;

    // The batch check answers every row in one statement.
    assert_matrix_agrees(&viewers, &["every row"], async |viewer, _| {
        let old =
            source_list_oracle::get_database_rows_access(&pool, &rows, &viewer.sources).await?;
        let new = get_database_rows_access(&pool, &rows, viewer.viewer()).await?;
        Ok((
            old.into_iter().collect::<BTreeMap<_, _>>(),
            new.into_iter().collect::<BTreeMap<_, _>>(),
        ))
    })
    .await
}
