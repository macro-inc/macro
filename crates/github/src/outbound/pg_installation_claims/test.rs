use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::PgGithubInstallationClaims;
use crate::domain::ports::GithubInstallationClaims;

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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("github_installation_test_data"))
)]
async fn a_claim_comes_from_installing_or_from_a_team(pool: Pool<Postgres>) {
    install(&pool, "100", "macro|solo@user.com", "user").await;
    install(&pool, "200", "dddddddd-dddd-dddd-dddd-dddddddddddd", "team").await;
    let claims = PgGithubInstallationClaims::new(pool);
    let solo = MacroUserIdStr::parse_from_str("macro|solo@user.com").unwrap();
    let alpha_member = MacroUserIdStr::parse_from_str("macro|user@user.com").unwrap();
    let beta_member = MacroUserIdStr::parse_from_str("macro|user2@user.com").unwrap();

    assert!(claims.has_claim(&solo, 100).await.unwrap());
    assert!(!claims.has_claim(&solo, 200).await.unwrap());
    assert!(claims.has_claim(&alpha_member, 200).await.unwrap());
    assert!(!claims.has_claim(&alpha_member, 100).await.unwrap());
    assert!(!claims.has_claim(&beta_member, 200).await.unwrap());
    assert!(!claims.has_claim(&solo, 300).await.unwrap());
}
