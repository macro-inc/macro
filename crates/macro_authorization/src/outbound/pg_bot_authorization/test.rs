use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::ports::BotAuthorizationRepo as _;

const TOKEN: &str = "mbot_authorization_test_secret";
const USER_ID: &str = "macro|bot-authorization@example.com";
const USER_EMAIL: &str = "bot-authorization@example.com";
const FUSION_USER_ID: &str = "fusion-bot-authorization";

async fn insert_bot_token(
    pool: &PgPool,
    owner_user_id: Option<&str>,
    revoked: bool,
) -> (Uuid, Uuid) {
    let bot_id = Uuid::new_v4();
    let token_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO bots (id, kind, owner_user_id, name, handle)
        VALUES ($1, 'owned', $2, 'Authorization bot', $3)
        "#,
        bot_id,
        owner_user_id,
        format!("authorization-{bot_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO bot_tokens (id, bot_id, token, revoked_at)
        VALUES ($1, $2, $3, CASE WHEN $4 THEN now() ELSE NULL END)
        "#,
        token_id,
        bot_id,
        TOKEN,
        revoked,
    )
    .execute(pool)
    .await
    .unwrap();
    (bot_id, token_id)
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
    let (bot_id, token_id) = insert_bot_token(&pool, Some(USER_ID), false).await;
    let repo = PgBotAuthorizationRepo::new(pool.clone());

    let token = repo
        .find_valid_bot_token(TOKEN)
        .await
        .unwrap()
        .expect("valid token");
    assert_eq!(token.bot_id.as_uuid(), bot_id);
    assert_eq!(token.token_id, token_id);
    assert_eq!(
        token.owner,
        BotAuthorizationOwner::User {
            user_id: USER_ID.to_string()
        }
    );

    repo.mark_token_used(token_id).await.unwrap();
    let last_used_at = sqlx::query_scalar!(
        r#"SELECT last_used_at FROM bot_tokens WHERE id = $1"#,
        token_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(last_used_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejects_unknown_revoked_expired_and_deleted_bot_tokens(pool: PgPool) {
    let repo = PgBotAuthorizationRepo::new(pool.clone());
    assert!(
        repo.find_valid_bot_token("unknown")
            .await
            .unwrap()
            .is_none()
    );

    insert_bot_token(&pool, Some(USER_ID), true).await;
    assert!(repo.find_valid_bot_token(TOKEN).await.unwrap().is_none());

    sqlx::query!(
        "UPDATE bot_tokens SET revoked_at = NULL, expires_at = now() - interval '1 minute'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo.find_valid_bot_token(TOKEN).await.unwrap().is_none());

    sqlx::query!("UPDATE bot_tokens SET expires_at = NULL")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!("UPDATE bots SET deleted_at = now()")
        .execute(&pool)
        .await
        .unwrap();
    assert!(repo.find_valid_bot_token(TOKEN).await.unwrap().is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolves_acting_users_by_macro_or_fusion_identifier(pool: PgPool) {
    insert_user(&pool).await;
    let repo = PgBotAuthorizationRepo::new(pool);

    for claims in [
        BotActingUserClaims {
            user_id: Some(USER_ID.to_string()),
            fusion_user_id: Some("ignored-by-lookup".to_string()),
            organization_id: None,
        },
        BotActingUserClaims {
            user_id: None,
            fusion_user_id: Some(FUSION_USER_ID.to_string()),
            organization_id: None,
        },
    ] {
        let user = repo
            .find_acting_user(&claims)
            .await
            .unwrap()
            .expect("acting user");
        assert_eq!(user.macro_user_id.as_ref(), USER_ID);
        assert_eq!(user.fusion_user_id, FUSION_USER_ID);
        assert_eq!(user.organization_id, None);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn checks_current_team_membership(pool: PgPool) {
    insert_user(&pool).await;
    let team_id = Uuid::new_v4();
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Authorization team', $2)"#,
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

    let repo = PgBotAuthorizationRepo::new(pool);
    assert!(repo.user_has_team(FUSION_USER_ID, team_id).await.unwrap());
}
