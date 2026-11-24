use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const OWNER: &str = "macro|owner@example.com";
const OTHER: &str = "macro|other@example.com";

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn sealed(tag: u8) -> EncryptedGrant {
    EncryptedGrant {
        ciphertext: vec![tag; 24],
        encrypted_data_key: vec![tag; 8],
        nonce: vec![tag; 12],
        encryption_version: 1,
        kms_key_id: "key".to_owned(),
    }
}

fn expiry() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2030-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc)
}

async fn store(repo: &ApiAppRepo, id: &str, app: &str, tag: u8) {
    repo.store(&NewGrant {
        user: &user(id),
        app,
        name: "Autodesk",
        access_expires_at: expiry(),
        grant: &sealed(tag),
    })
    .await
    .unwrap();
}

async fn add_other_user(pool: &PgPool) {
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ('019a0000-0000-7000-8000-000000000012', 'api-app-other', 'other@example.com', 'api-app-other')"#
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, 'other@example.com', '019a0000-0000-7000-8000-000000000012')"#,
        OTHER
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_stored_grant_reads_back_enabled(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 1).await;

    let row = repo.get(&user(OWNER), "autodesk").await.unwrap().unwrap();
    assert_eq!(row.name, "Autodesk");
    assert!(row.enabled);
    assert!(!row.needs_reauth);
    assert_eq!(row.access_expires_at, expiry());
    assert_eq!(row.grant, sealed(1));
    assert_eq!(repo.list(&user(OWNER)).await.unwrap(), vec![row]);
    assert_eq!(repo.get(&user(OWNER), "notion").await.unwrap(), None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn signing_in_again_replaces_the_grant_and_keeps_the_name(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 1).await;
    assert!(
        repo.rename(&user(OWNER), "autodesk", "Work Autodesk")
            .await
            .unwrap()
    );
    assert!(
        repo.set_enabled(&user(OWNER), "autodesk", false)
            .await
            .unwrap()
    );
    repo.lock(&user(OWNER), "autodesk")
        .await
        .unwrap()
        .unwrap()
        .mark_needs_reauth()
        .await
        .unwrap();

    store(&repo, OWNER, "autodesk", 2).await;

    let row = repo.get(&user(OWNER), "autodesk").await.unwrap().unwrap();
    assert_eq!(row.name, "Work Autodesk");
    assert!(row.enabled);
    assert!(!row.needs_reauth);
    assert_eq!(row.grant, sealed(2));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn holders_are_the_users_with_an_enabled_row(pool: PgPool) {
    add_other_user(&pool).await;
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 1).await;
    store(&repo, OTHER, "autodesk", 2).await;
    assert!(
        repo.set_enabled(&user(OTHER), "autodesk", false)
            .await
            .unwrap()
    );

    assert_eq!(repo.holders("autodesk").await.unwrap(), vec![user(OWNER)]);
    assert!(repo.holders("notion").await.unwrap().is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn changing_a_row_that_is_not_there_changes_nothing(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);

    assert!(
        !repo
            .set_enabled(&user(OWNER), "autodesk", false)
            .await
            .unwrap()
    );
    assert!(!repo.rename(&user(OWNER), "autodesk", "Name").await.unwrap());
    assert_eq!(repo.delete(&user(OWNER), "autodesk").await.unwrap(), None);
    assert!(repo.lock(&user(OWNER), "autodesk").await.unwrap().is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn deleting_answers_the_grant_it_removed(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 3).await;

    let removed = repo
        .delete(&user(OWNER), "autodesk")
        .await
        .unwrap()
        .unwrap();

    assert_eq!(removed.grant, sealed(3));
    assert_eq!(repo.get(&user(OWNER), "autodesk").await.unwrap(), None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_refresh_waits_for_the_one_holding_the_row_and_sees_its_grant(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 1).await;
    let first = repo.lock(&user(OWNER), "autodesk").await.unwrap().unwrap();

    let waiting = {
        let repo = repo.clone();
        tokio::spawn(async move { repo.lock(&user(OWNER), "autodesk").await })
    };
    let later = expiry() + chrono::Duration::hours(1);
    first.store(&sealed(2), later).await.unwrap();

    let second = waiting.await.unwrap().unwrap().unwrap();
    assert_eq!(second.row.grant, sealed(2));
    assert_eq!(second.row.access_expires_at, later);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_lock_dropped_without_storing_leaves_the_row(pool: PgPool) {
    let repo = ApiAppRepo::new(pool);
    store(&repo, OWNER, "autodesk", 1).await;

    drop(repo.lock(&user(OWNER), "autodesk").await.unwrap().unwrap());

    let row = repo.get(&user(OWNER), "autodesk").await.unwrap().unwrap();
    assert_eq!(row.grant, sealed(1));
    assert!(!row.needs_reauth);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("users"))
)]
async fn a_row_goes_with_its_user(pool: PgPool) {
    let repo = ApiAppRepo::new(pool.clone());
    store(&repo, OWNER, "autodesk", 1).await;

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, OWNER)
        .execute(&pool)
        .await
        .unwrap();

    assert!(repo.list(&user(OWNER)).await.unwrap().is_empty());
}
