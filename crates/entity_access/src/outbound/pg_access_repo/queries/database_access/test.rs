use super::*;
use crate::outbound::pg_access_repo::queries::{
    source_list_oracle,
    test_viewers::{assert_matrix_agrees, matrix_viewers},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

const OWNER: &str = "macro|owner@team.com";
const MEMBER: &str = "macro|member@team.com";
const MEMBER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";
/// In no team, and in no channel unless a test adds them to one.
const NO_TEAM: &str = "macro|database-no-team@example.com";

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
    assert_eq!(
        get_database_access(&pool, &database, Viewer::User(OWNER))
            .await
            .unwrap(),
        None
    );
    assert!(
        list_database_access(&pool, &user(OWNER))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        get_database_row_access(&pool, &row, Viewer::User(OWNER))
            .await
            .unwrap(),
        None
    );
    assert!(
        get_database_rows_access(&pool, &[row], Viewer::User(OWNER))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(get_database_row_database(&pool, &row).await.unwrap(), None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn core_storage_does_not_gain_database_access_through_a_form(pool: PgPool) {
    use super::super::database_row_access::{get_database_row_access, get_database_rows_access};
    let database = Uuid::now_v7();
    let table = Uuid::now_v7();
    let row = Uuid::now_v7();
    let form = Uuid::now_v7();
    sqlx::query!("INSERT INTO databases (id) VALUES ($1)", database)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Contacts', '80')",
        table,
        database
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO database_rows (id, table_id, position) VALUES ($1, $2, '80')",
        row,
        table
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO forms (id, name, owner_id, database_id, table_id) VALUES ($1, 'Intake', $2, $3, $4)",
        form,
        OWNER,
        database,
        table
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level) VALUES ($1, 'form', $2, 'user', 'edit')",
        form,
        MEMBER
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_database_access(&pool, &database, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert!(
        list_database_access(&pool, &user(MEMBER))
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        get_database_row_access(&pool, &row, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert!(
        get_database_rows_access(&pool, &[row], Viewer::User(MEMBER))
            .await
            .unwrap()
            .is_empty()
    );
    #[cfg(feature = "explain_binary")]
    assert!(
        explain_database_access(
            &pool,
            &database,
            &crate::outbound::pg_access_repo::queries::get_user_source_ids(
                &pool,
                Some(&user(MEMBER))
            )
            .await
            .unwrap()
        )
        .await
        .unwrap()
        .is_empty()
    );
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

fn user(user_id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(user_id).unwrap()
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
    let mut expected = vec![(shared, AccessLevel::Edit), (owned, AccessLevel::Owner)];
    expected.sort();
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        expected
    );
    assert_eq!(
        list_database_access(&pool, &user(NO_TEAM)).await.unwrap(),
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
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')"#,
        channel_id,
        NO_TEAM,
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
    assert_eq!(
        list_database_access(&pool, &user(NO_TEAM)).await.unwrap(),
        vec![(database_id, AccessLevel::View)]
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        Vec::new()
    );
}

/// A form over `database_id`'s first table, granted `level` to `source_id`.
async fn insert_form_over(
    pool: &PgPool,
    database_id: Uuid,
    source_id: &str,
    source_type: &str,
    level: &str,
) -> Uuid {
    let table_id = Uuid::now_v7();
    let form_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, $3, 'a0')"#,
        table_id,
        database_id,
        table_id.to_string(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id)
        VALUES ($1, 'RSVP', $2, $3, $4)
        "#,
        form_id,
        OWNER,
        database_id,
        table_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $2, ($3::text)::entity_access_source_type, ($4::text)::"AccessLevel")
        "#,
        form_id,
        source_id,
        source_type,
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
async fn editing_a_form_grants_edit_on_its_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    insert_form_over(&pool, database_id, MEMBER, "user", "edit").await;
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        vec![(database_id, AccessLevel::Edit)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn owning_a_form_grants_only_edit_on_its_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    insert_form_over(&pool, database_id, MEMBER_TEAM, "team", "owner").await;
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        vec![(database_id, AccessLevel::Edit)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn viewing_a_form_that_shares_responses_grants_view_on_its_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let form_id = insert_form_over(&pool, database_id, MEMBER, "user", "view").await;
    sqlx::query!(
        r#"UPDATE forms SET responses_visible = TRUE WHERE id = $1"#,
        form_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        vec![(database_id, AccessLevel::View)]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn viewing_a_form_grants_nothing_on_its_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    insert_form_over(&pool, database_id, MEMBER, "user", "view").await;
    insert_form_over(&pool, database_id, MEMBER_TEAM, "team", "comment").await;
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        Vec::new()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_trashed_form_grants_nothing_on_its_database(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let form_id = insert_form_over(&pool, database_id, MEMBER, "user", "owner").await;
    sqlx::query!(
        r#"UPDATE forms SET trashed_at = now() WHERE id = $1"#,
        form_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        Vec::new()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_direct_database_grant_above_edit_wins_over_a_form(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let viewed = insert_database(&pool).await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'database', $3, 'user', 'owner'),
               ($2, 'database', $3, 'user', 'view')
        "#,
        database_id,
        viewed,
        MEMBER,
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_form_over(&pool, database_id, MEMBER, "user", "edit").await;
    insert_form_over(&pool, viewed, MEMBER, "user", "edit").await;
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Owner)
    );
    assert_eq!(
        get_database_access(&pool, &viewed, Viewer::User(MEMBER))
            .await
            .unwrap(),
        Some(AccessLevel::Edit)
    );
    let mut expected = vec![
        (database_id, AccessLevel::Owner),
        (viewed, AccessLevel::Edit),
    ];
    expected.sort();
    assert_eq!(
        list_database_access(&pool, &user(MEMBER)).await.unwrap(),
        expected
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_form_over_another_database_grants_nothing_here(pool: PgPool) {
    let database_id = insert_database(&pool).await;
    let other = insert_database(&pool).await;
    insert_form_over(&pool, other, MEMBER, "user", "edit").await;
    assert_eq!(
        get_database_access(&pool, &database_id, Viewer::User(MEMBER))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../fixtures",
        scripts("viewer_matrix", "typed_owner_team", "viewer_matrix_database")
    )
)]
async fn database_access_matches_the_source_list_form(pool: PgPool) -> anyhow::Result<()> {
    let viewers = matrix_viewers(&pool).await?;
    let databases = sqlx::query_scalar!(r#"SELECT id FROM databases ORDER BY id"#)
        .fetch_all(&pool)
        .await?;

    assert_matrix_agrees(&viewers, &databases, async |viewer, database_id| {
        Ok((
            source_list_oracle::get_database_access(&pool, database_id, &viewer.sources).await?,
            get_database_access(&pool, database_id, viewer.viewer()).await?,
        ))
    })
    .await?;

    // Databases are listed for signed-in users only.
    let users: Vec<_> = viewers
        .into_iter()
        .filter(|viewer| viewer.user_id().is_some())
        .collect();
    assert_matrix_agrees(&users, &["every database"], async |viewer, _| {
        let user_id = viewer
            .user_id()
            .ok_or_else(|| anyhow::anyhow!("{} is not a user", viewer.label))?;
        Ok((
            source_list_oracle::list_database_access(&pool, &viewer.sources).await?,
            list_database_access(&pool, &user_id).await?,
        ))
    })
    .await
}
