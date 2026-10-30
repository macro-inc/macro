use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const USER: &str = "macro|owner@example.com";

fn connection(app_slug: &str) -> PipedreamConnection {
    PipedreamConnection {
        user_id: MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
        app_slug: app_slug.to_owned(),
        server_name: app_slug.to_owned(),
        account_id: format!("apn_{app_slug}"),
        enabled: true,
    }
}

/// `sentry` is overlaid by the seed and `google_sheets` is not: a Pipedream
/// row for an overlaid app is invisible to every read, so no consumer can
/// reach the app through Pipedream.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn reads_never_return_connections_to_overlaid_apps(pool: PgPool) {
    let repo = PgConnectionRepo::new(pool);
    let user = connection("sentry").user_id;
    repo.save(&connection("sentry")).await.unwrap();
    repo.save(&connection("google_sheets")).await.unwrap();

    let listed: Vec<String> = repo
        .list(&user)
        .await
        .unwrap()
        .into_iter()
        .map(|c| c.app_slug)
        .collect();
    assert_eq!(listed, ["google_sheets"]);
    assert!(repo.load(&user, "sentry").await.unwrap().is_none());
    assert!(repo.load(&user, "google_sheets").await.unwrap().is_some());
    assert!(
        repo.list_enabled_for_app("sentry")
            .await
            .unwrap()
            .is_empty()
    );

    assert_eq!(
        repo.overlay("sentry").await.unwrap().map(|o| o.server_url),
        Some("https://mcp.sentry.dev/mcp".to_owned())
    );
    assert!(repo.overlay("google_sheets").await.unwrap().is_none());
    assert!(
        repo.overlays()
            .await
            .unwrap()
            .iter()
            .any(|o| o.app_slug == "sentry")
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn connections_are_deleted_with_their_user(pool: PgPool) {
    let repo = PgConnectionRepo::new(pool.clone());
    repo.save(&connection("granola")).await.unwrap();
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, USER)
        .execute(&pool)
        .await
        .unwrap();
    // Background sync lists enabled connections; an orphan would be set up forever.
    assert!(
        repo.list_enabled_for_app("granola")
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn connections_follow_a_renamed_user(pool: PgPool) {
    let repo = PgConnectionRepo::new(pool.clone());
    repo.save(&connection("granola")).await.unwrap();
    let renamed = "macro|renamed@example.com";
    sqlx::query!(r#"UPDATE "User" SET id = $1 WHERE id = $2"#, renamed, USER)
        .execute(&pool)
        .await
        .unwrap();
    let listed = repo.list_enabled_for_app("granola").await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].user_id.as_ref(), renamed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn connections_require_an_existing_user(pool: PgPool) {
    let repo = PgConnectionRepo::new(pool);
    assert!(repo.save(&connection("granola")).await.is_err());
}
