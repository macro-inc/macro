use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn connection(app_slug: &str) -> PipedreamConnection {
    PipedreamConnection {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.com")
            .unwrap()
            .into_owned(),
        app_slug: app_slug.to_owned(),
        server_name: app_slug.to_owned(),
        account_id: format!("apn_{app_slug}"),
        enabled: true,
    }
}

/// `sentry` is overlaid by the seed and `google_sheets` is not: a Pipedream
/// row for an overlaid app is invisible to every read, so no consumer can
/// reach the app through Pipedream.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
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
