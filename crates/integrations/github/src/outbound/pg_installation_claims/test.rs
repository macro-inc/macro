use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::PgGithubInstallationClaims;
use crate::domain::ports::GithubInstallationClaims;

const SOLO: &str = "macro|solo@user.com";
const SOLO_GITHUB: &str = "67890";

async fn install(pool: &Pool<Postgres>, installation_id: &str, source_id: &str, source_type: &str) {
    sqlx::query!(
        r#"
        INSERT INTO github_app_installation (id, source_id, source_type)
        VALUES ($1, $2, $3::text::github_app_installation_source_type)
        "#,
        installation_id,
        source_id,
        source_type,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn installed_by(pool: &Pool<Postgres>, installation_id: &str, github_user_id: &str) {
    sqlx::query!(
        "INSERT INTO github_app_installation_installer (installation_id, github_user_id) VALUES ($1, $2)",
        installation_id,
        github_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// Disconnects `user`'s GitHub, then optionally links another account.
async fn relink(pool: &Pool<Postgres>, user: &str, github_user_id: Option<&str>) {
    sqlx::query!("DELETE FROM github_links WHERE macro_id = $1", user)
        .execute(pool)
        .await
        .unwrap();
    if let Some(github_user_id) = github_user_id {
        sqlx::query!(
            r#"
            INSERT INTO github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
            VALUES (gen_random_uuid(), $1, gen_random_uuid(), 'other', $2)
            "#,
            user,
            github_user_id,
        )
        .execute(pool)
        .await
        .unwrap();
    }
}

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn a_claim_comes_from_installing_or_from_a_team(pool: Pool<Postgres>) {
    install(&pool, "100", SOLO, "user").await;
    install(&pool, "200", "dddddddd-dddd-dddd-dddd-dddddddddddd", "team").await;
    let claims = PgGithubInstallationClaims::new(pool);
    let solo = user(SOLO);
    let alpha_member = user("macro|user@user.com");
    let beta_member = user("macro|user2@user.com");

    assert!(claims.has_claim(&solo, 100).await.unwrap());
    assert!(!claims.has_claim(&solo, 200).await.unwrap());
    assert!(claims.has_claim(&alpha_member, 200).await.unwrap());
    assert!(!claims.has_claim(&alpha_member, 100).await.unwrap());
    assert!(!claims.has_claim(&beta_member, 200).await.unwrap());
    assert!(!claims.has_claim(&solo, 300).await.unwrap());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn linking_is_per_user(pool: Pool<Postgres>) {
    let claims = PgGithubInstallationClaims::new(pool);

    assert!(claims.is_linked(&user(SOLO)).await.unwrap());
    assert!(
        !claims
            .is_linked(&user("macro|user2@user.com"))
            .await
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn nothing_is_claimed_while_github_is_disconnected(pool: Pool<Postgres>) {
    install(&pool, "100", SOLO, "user").await;
    installed_by(&pool, "100", SOLO_GITHUB).await;
    install(&pool, "200", "dddddddd-dddd-dddd-dddd-dddddddddddd", "team").await;
    relink(&pool, SOLO, None).await;
    relink(&pool, "macro|user@user.com", None).await;
    let claims = PgGithubInstallationClaims::new(pool);

    assert!(!claims.has_claim(&user(SOLO), 100).await.unwrap());
    assert!(
        !claims
            .has_claim(&user("macro|user@user.com"), 200)
            .await
            .unwrap()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn a_personal_installation_follows_the_linked_account(pool: Pool<Postgres>) {
    install(&pool, "100", SOLO, "user").await;
    installed_by(&pool, "100", SOLO_GITHUB).await;
    install(&pool, "101", SOLO, "user").await;
    installed_by(&pool, "101", "55555").await;
    install(&pool, "200", "dddddddd-dddd-dddd-dddd-dddddddddddd", "team").await;
    relink(&pool, SOLO, Some("55555")).await;
    relink(&pool, "macro|user@user.com", Some("55555")).await;
    let claims = PgGithubInstallationClaims::new(pool);

    // Made with the account solo disconnected; made with the one linked now.
    assert!(!claims.has_claim(&user(SOLO), 100).await.unwrap());
    assert!(claims.has_claim(&user(SOLO), 101).await.unwrap());
    // A team's installation stays whichever account a member links.
    assert!(
        claims
            .has_claim(&user("macro|user@user.com"), 200)
            .await
            .unwrap()
    );
}
