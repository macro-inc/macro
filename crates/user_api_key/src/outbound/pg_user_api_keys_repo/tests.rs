use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use super::PgUserApiKeysRepo;
use crate::domain::models::UserApiKey;
use crate::domain::models::UserApiKeyId;
use crate::domain::ports::UserApiKeysRepo;

const USER_A: &str = "macro|user-a@macro.com";
const USER_B: &str = "macro|user-b@macro.com";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_and_list_return_id_name_and_created_at_scoped_per_user(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgUserApiKeysRepo::new(pool.clone());
    let key = UserApiKey::from_raw(
        "mak_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    let id = UserApiKeyId::generate();

    let inserted = repo
        .insert_key(&user(USER_A), id, "Laptop", &key.hash())
        .await
        .expect("insert should succeed");
    assert_eq!(inserted.id, id);
    assert_eq!(inserted.name, "Laptop");
    assert!(inserted.created_at <= chrono::Utc::now());

    let a_keys = repo.list_keys(&user(USER_A)).await.expect("list A");
    let b_keys = repo.list_keys(&user(USER_B)).await.expect("list B");
    assert_eq!(a_keys.len(), 1);
    assert_eq!(a_keys[0].id, id);
    assert_eq!(a_keys[0].name, "Laptop");
    assert_eq!(a_keys[0].created_at, inserted.created_at);
    assert!(b_keys.is_empty());

    let stored_hash: Vec<u8> = sqlx::query_scalar(r#"SELECT hash FROM "UserApiKey" WHERE id = $1"#)
        .bind(id.as_uuid())
        .fetch_one(&pool)
        .await
        .expect("hash should persist");
    assert_eq!(stored_hash, key.hash());

    let key_column_exists: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'UserApiKey' AND column_name = 'key'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .expect("column probe should run");
    assert!(!key_column_exists);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn count_keys_counts_only_caller_rows(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgUserApiKeysRepo::new(pool);

    repo.insert_key(
        &user(USER_A),
        UserApiKeyId::generate(),
        "a-1",
        &UserApiKey::from_raw("key-a-1").hash(),
    )
    .await
    .expect("insert A");
    repo.insert_key(
        &user(USER_A),
        UserApiKeyId::generate(),
        "a-2",
        &UserApiKey::from_raw("key-a-2").hash(),
    )
    .await
    .expect("insert A again");
    repo.insert_key(
        &user(USER_B),
        UserApiKeyId::generate(),
        "b-1",
        &UserApiKey::from_raw("key-b-1").hash(),
    )
    .await
    .expect("insert B");

    assert_eq!(
        repo.count_keys(&user(USER_A))
            .await
            .expect("count A should run"),
        2
    );
    assert_eq!(
        repo.count_keys(&user(USER_B))
            .await
            .expect("count B should run"),
        1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_key_is_scoped_to_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgUserApiKeysRepo::new(pool);
    let key = UserApiKey::from_raw("shared-looking-but-owned-by-a");
    let id = UserApiKeyId::generate();

    repo.insert_key(&user(USER_A), id, "owned", &key.hash())
        .await
        .expect("insert should succeed");

    assert!(
        !repo
            .delete_key(&user(USER_B), id)
            .await
            .expect("delete as B should run")
    );
    assert!(
        !repo
            .delete_key(&user(USER_A), UserApiKeyId::generate())
            .await
            .expect("delete unknown should run")
    );
    assert!(
        repo.delete_key(&user(USER_A), id)
            .await
            .expect("delete as A should run")
    );
    assert!(
        repo.list_keys(&user(USER_A))
            .await
            .expect("list A")
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn find_user_id_by_key_looks_up_hash(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgUserApiKeysRepo::new(pool);
    let key = UserApiKey::from_raw("lookup-key");

    repo.insert_key(
        &user(USER_A),
        UserApiKeyId::generate(),
        "lookup",
        &key.hash(),
    )
    .await
    .expect("insert should succeed");

    let owner = repo
        .find_user_id_by_key(&key)
        .await
        .expect("lookup should run")
        .expect("owner should exist");
    assert_eq!(owner.as_ref(), USER_A);

    assert!(
        repo.find_user_id_by_key(&UserApiKey::from_raw("missing"))
            .await
            .expect("missing lookup should run")
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn insert_same_hash_for_second_user_is_rejected(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgUserApiKeysRepo::new(pool);
    let key = UserApiKey::from_raw("globally-unique-key");
    let hash = key.hash();

    repo.insert_key(&user(USER_A), UserApiKeyId::generate(), "a", &hash)
        .await
        .expect("first insert should succeed");
    let err = repo
        .insert_key(&user(USER_B), UserApiKeyId::generate(), "b", &hash)
        .await
        .expect_err("duplicate hash should fail");
    assert!(matches!(err, super::UserApiKeysRepoErr::Db(_)));
}
