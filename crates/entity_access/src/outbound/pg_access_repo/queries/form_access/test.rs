use super::*;
use crate::outbound::pg_access_repo::queries::get_user_source_ids;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

const OWNER: &str = "macro|owner@team.com";
const MEMBER: &str = "macro|member@team.com";
const MEMBER_TEAM: &str = "00000000-0000-0000-0000-0000000ea001";

/// A database with one table, and a form over that table.
async fn insert_form(pool: &PgPool, audience: &str) -> Uuid {
    let database_id = Uuid::now_v7();
    let table_id = Uuid::now_v7();
    let form_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO databases (id, name, owner_id) VALUES ($1, 'Responses', $2)"#,
        database_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO database_tables (id, database_id, name, position) VALUES ($1, $2, 'Responses', 'a0')"#,
        table_id,
        database_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO forms (id, name, owner_id, database_id, table_id, audience)
        VALUES ($1, 'RSVP', $2, $3, $4, $5)
        "#,
        form_id,
        OWNER,
        database_id,
        table_id,
        audience,
    )
    .execute(pool)
    .await
    .unwrap();
    form_id
}

async fn source_ids(pool: &PgPool, email: &str) -> SourceIds {
    let user = MacroUserIdStr::try_from_email(email).unwrap();
    get_user_source_ids(pool, Some(&user)).await.unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_members_form_answers_the_highest_grant_and_nothing_to_strangers(pool: PgPool) {
    let form_id = insert_form(&pool, "members").await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $2, 'user', 'view'),
               ($1, 'form', $3, 'team', 'edit'),
               ($1, 'database', $2, 'user', 'owner'),
               ($1, 'form', $4, 'user', 'owner')
        "#,
        form_id,
        MEMBER,
        MEMBER_TEAM,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    let member = source_ids(&pool, "member@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &member).await.unwrap(),
        Some(AccessLevel::Edit)
    );
    let owner = source_ids(&pool, "owner@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &owner).await.unwrap(),
        Some(AccessLevel::Owner)
    );
    let stranger = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &stranger).await.unwrap(),
        None
    );
    assert_eq!(
        get_form_access(&pool, &form_id, &SourceIds(Vec::new()))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_public_form_is_viewable_by_anyone_and_never_more(pool: PgPool) {
    let form_id = insert_form(&pool, "public").await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $2, 'user', 'owner')
        "#,
        form_id,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        get_form_access(&pool, &form_id, &SourceIds(Vec::new()))
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    let stranger = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &stranger).await.unwrap(),
        Some(AccessLevel::View)
    );
    let owner = source_ids(&pool, "owner@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &owner).await.unwrap(),
        Some(AccessLevel::Owner)
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_trashed_public_form_is_not_public(pool: PgPool) {
    let form_id = insert_form(&pool, "public").await;
    sqlx::query!(
        r#"UPDATE forms SET trashed_at = now() WHERE id = $1"#,
        form_id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        get_form_access(&pool, &form_id, &SourceIds(Vec::new()))
            .await
            .unwrap(),
        None
    );
    let stranger = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &stranger).await.unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_missing_form_has_no_public_access(pool: PgPool) {
    assert_eq!(
        get_form_access(&pool, &Uuid::now_v7(), &SourceIds(Vec::new()))
            .await
            .unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn a_channel_grant_on_a_form_reaches_its_active_participants(pool: PgPool) {
    let form_id = insert_form(&pool, "members").await;
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
        VALUES ($1, 'form', $2, 'channel', 'view')
        "#,
        form_id,
        channel_id.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let participant = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &participant)
            .await
            .unwrap(),
        Some(AccessLevel::View)
    );
    let member = source_ids(&pool, "member@team.com").await;
    assert_eq!(
        get_form_access(&pool, &form_id, &member).await.unwrap(),
        None
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn deleting_a_form_or_its_database_deletes_the_form_grants(pool: PgPool) {
    let kept = insert_form(&pool, "members").await;
    let deleted = insert_form(&pool, "members").await;
    let cascaded = insert_form(&pool, "members").await;
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $4, 'user', 'owner'),
               ($2, 'form', $4, 'user', 'owner'),
               ($3, 'form', $4, 'user', 'owner'),
               ($2, 'document', $4, 'user', 'owner')
        "#,
        kept,
        deleted,
        cascaded,
        OWNER,
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(r#"DELETE FROM forms WHERE id = $1"#, deleted)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        r#"DELETE FROM databases WHERE id = (SELECT database_id FROM forms WHERE id = $1)"#,
        cascaded,
    )
    .execute(&pool)
    .await
    .unwrap();

    let remaining = sqlx::query!(
        r#"
        SELECT entity_id, entity_type
        FROM entity_access
        WHERE entity_id = ANY($1)
        ORDER BY entity_id, entity_type
        "#,
        &[kept, deleted, cascaded],
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.entity_id, row.entity_type))
    .collect::<Vec<_>>();
    assert_eq!(
        remaining,
        vec![
            (kept, "form".to_string()),
            (deleted, "document".to_string())
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("user_team"))
)]
async fn every_live_form_granted_to_the_caller_is_listed_at_its_highest_grant(pool: PgPool) {
    let shared = insert_form(&pool, "members").await;
    let owned = insert_form(&pool, "public").await;
    let trashed = insert_form(&pool, "members").await;
    let public_only = insert_form(&pool, "public").await;
    let unrelated = insert_form(&pool, "members").await;
    let channel_shared = insert_form(&pool, "members").await;
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
        MEMBER,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'form', $4, 'user', 'view'),
               ($1, 'form', $5, 'team', 'edit'),
               ($2, 'form', $4, 'user', 'owner'),
               ($2, 'database', $4, 'user', 'view'),
               ($3, 'form', $4, 'user', 'owner'),
               ($6, 'form', $7, 'user', 'owner'),
               ($8, 'form', $9, 'channel', 'view')
        "#,
        shared,
        owned,
        trashed,
        MEMBER,
        MEMBER_TEAM,
        unrelated,
        OWNER,
        channel_shared,
        channel_id.to_string(),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE forms SET trashed_at = now() WHERE id = $1"#,
        trashed
    )
    .execute(&pool)
    .await
    .unwrap();

    let member = source_ids(&pool, "member@team.com").await;
    let mut expected = vec![
        (shared, AccessLevel::Edit),
        (owned, AccessLevel::Owner),
        (channel_shared, AccessLevel::View),
    ];
    expected.sort();
    assert_eq!(list_form_access(&pool, &member).await.unwrap(), expected);
    assert!(
        !expected.iter().any(|(form_id, _)| *form_id == public_only),
        "a public audience alone never lists a form"
    );

    let outsider = source_ids(&pool, "noteam@team.com").await;
    assert_eq!(
        list_form_access(&pool, &outsider).await.unwrap(),
        Vec::new()
    );
    assert_eq!(
        list_form_access(&pool, &SourceIds(Vec::new()))
            .await
            .unwrap(),
        Vec::new()
    );
}
