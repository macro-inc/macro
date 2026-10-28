use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::HarnessAuthorizationRepo as _;

const TOKEN: &str = "mhns_authorization_test_secret";
const USER_ID: &str = "macro|harness-authorization@example.com";
const USER_EMAIL: &str = "harness-authorization@example.com";
const FUSION_USER_ID: &str = "fusion-harness-authorization";

async fn insert_harness_token(
    pool: &PgPool,
    owner_user_id: Option<&str>,
    team_id: Option<Uuid>,
    revoked: bool,
) -> (Uuid, Uuid) {
    let harness_id = Uuid::new_v4();
    let token_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, team_id, created_by)
        VALUES ($1, 'macrod', 'Authorization harness', $2, $3, $4)
        "#,
        harness_id,
        owner_user_id,
        team_id,
        USER_ID,
    )
    .execute(pool)
    .await
    .unwrap();
    let hashed = harness_token::HashedHarnessToken::from_raw(TOKEN);
    sqlx::query!(
        r#"
        INSERT INTO harness_tokens (id, harness_id, token_hash, token_prefix, revoked_at)
        VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
        "#,
        token_id,
        harness_id,
        &hashed.hash[..],
        hashed.prefix,
        revoked,
    )
    .execute(pool)
    .await
    .unwrap();
    (harness_id, token_id)
}

async fn insert_user(pool: &PgPool) {
    let macro_user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $2, $3)
        "#,
        macro_user_id,
        USER_EMAIL,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO "User" (id, email, macro_user_id)
        VALUES ($1, $2, $3)
        "#,
        FUSION_USER_ID,
        USER_EMAIL,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finds_valid_token_owner_and_marks_usage(pool: PgPool) {
    let (harness_id, token_id) = insert_harness_token(&pool, Some(USER_ID), None, false).await;
    let repo = PgHarnessAuthorizationRepo::new(pool.clone());

    let token = repo
        .find_valid_harness_token(TOKEN)
        .await
        .unwrap()
        .expect("valid token");
    assert_eq!(token.harness_id.as_uuid(), harness_id);
    assert_eq!(token.token_id, token_id);
    assert_eq!(
        token.owner,
        HarnessAuthorizationOwner::User {
            user_id: USER_ID.to_string()
        }
    );
    assert_eq!(token.created_by, USER_ID);

    repo.mark_harness_token_used(token_id).await.unwrap();
    let last_used_at = sqlx::query_scalar!(
        r#"SELECT last_used_at FROM harness_tokens WHERE id = $1"#,
        token_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(last_used_at.is_some());
}

/// The token's last use as Unix seconds, so tests compare stored values exactly.
async fn last_used_at(pool: &PgPool, token_id: Uuid) -> Option<f64> {
    sqlx::query_scalar!(
        r#"SELECT EXTRACT(EPOCH FROM last_used_at)::float8 AS "last_used_at" FROM harness_tokens WHERE id = $1"#,
        token_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn set_last_used_ago(pool: &PgPool, token_id: Uuid, seconds: f64) {
    sqlx::query!(
        r#"
        UPDATE harness_tokens
        SET last_used_at = now() - make_interval(secs => $2)
        WHERE id = $1
        "#,
        token_id,
        seconds,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_use_within_the_last_minute_is_not_rewritten(pool: PgPool) {
    let (_, token_id) = insert_harness_token(&pool, Some(USER_ID), None, false).await;
    set_last_used_ago(&pool, token_id, 10.0).await;
    let before = last_used_at(&pool, token_id).await;
    let repo = PgHarnessAuthorizationRepo::new(pool.clone());

    repo.mark_harness_token_used(token_id).await.unwrap();

    assert_eq!(last_used_at(&pool, token_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_use_older_than_a_minute_is_refreshed(pool: PgPool) {
    let (_, token_id) = insert_harness_token(&pool, Some(USER_ID), None, false).await;
    set_last_used_ago(&pool, token_id, 120.0).await;
    let before = last_used_at(&pool, token_id)
        .await
        .expect("seeded timestamp");
    let repo = PgHarnessAuthorizationRepo::new(pool.clone());

    repo.mark_harness_token_used(token_id).await.unwrap();

    let after = last_used_at(&pool, token_id)
        .await
        .expect("refreshed timestamp");
    assert!(after > before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_token_row_another_request_is_updating_does_not_block_the_request(pool: PgPool) {
    let (_, token_id) = insert_harness_token(&pool, Some(USER_ID), None, false).await;
    // Another request's update holds the row lock until its transaction ends.
    let mut holder = pool.begin().await.unwrap();
    sqlx::query!(
        r#"SELECT id FROM harness_tokens WHERE id = $1 FOR UPDATE"#,
        token_id
    )
    .fetch_one(&mut *holder)
    .await
    .unwrap();
    // A waiting update fails after a second instead of hanging the test.
    let options = pool
        .connect_options()
        .as_ref()
        .clone()
        .options([("lock_timeout", "1s")]);
    let impatient = PgPool::connect_with(options).await.unwrap();
    let repo = PgHarnessAuthorizationRepo::new(impatient);

    repo.mark_harness_token_used(token_id)
        .await
        .expect("marking a token used must not wait for another request's row lock");

    holder.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_owned_harness_reports_its_team(pool: PgPool) {
    insert_user(&pool).await;
    let team_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Harness team', $2)"#,
        team_id,
        FUSION_USER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_harness_token(&pool, None, Some(team_id), false).await;

    let repo = PgHarnessAuthorizationRepo::new(pool);
    let token = repo
        .find_valid_harness_token(TOKEN)
        .await
        .unwrap()
        .expect("valid token");
    assert_eq!(token.owner, HarnessAuthorizationOwner::Team { team_id });
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejects_unknown_revoked_and_deleted_harness_tokens(pool: PgPool) {
    let repo = PgHarnessAuthorizationRepo::new(pool.clone());
    assert!(
        repo.find_valid_harness_token("unknown")
            .await
            .unwrap()
            .is_none()
    );

    insert_harness_token(&pool, Some(USER_ID), None, true).await;
    assert!(
        repo.find_valid_harness_token(TOKEN)
            .await
            .unwrap()
            .is_none()
    );

    sqlx::query!("UPDATE harness_tokens SET revoked_at = NULL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!("UPDATE harnesses SET deleted_at = now()")
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.find_valid_harness_token(TOKEN)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_users_by_macro_identifier(pool: PgPool) {
    insert_user(&pool).await;
    let repo = PgHarnessAuthorizationRepo::new(pool);

    let user = repo.find_user(USER_ID).await.unwrap().expect("user");
    assert_eq!(user.macro_user_id.as_ref(), USER_ID);
    assert_eq!(user.fusion_user_id, FUSION_USER_ID);

    assert!(repo.find_user("not-a-macro-id").await.unwrap().is_none());
    assert!(
        repo.find_user("macro|missing@example.com")
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checks_current_team_membership(pool: PgPool) {
    insert_user(&pool).await;
    let team_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Harness team', $2)"#,
        team_id,
        FUSION_USER_ID,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO team_user (user_id, team_id, team_role)
        VALUES ($1, $2, 'member'::team_role)
        "#,
        FUSION_USER_ID,
        team_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let repo = PgHarnessAuthorizationRepo::new(pool);
    assert!(repo.user_has_team(FUSION_USER_ID, team_id).await.unwrap());
    assert!(!repo.user_has_team("someone-else", team_id).await.unwrap());
}
