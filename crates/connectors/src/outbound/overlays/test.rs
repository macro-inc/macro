use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

/// The seeded table comes back as the domain's overlays: `sentry` is at its
/// vendor's server, any spelling of that URL finds it, and an app the table
/// does not list is not overlaid.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_the_overlay_table(pool: PgPool) {
    let overlays = PgOverlayCatalog::new(pool).overlays().await.unwrap();

    let sentry = ConnectorId::parse("sentry").unwrap();
    assert!(overlays.is_overlaid(&sentry));
    assert!(!overlays.is_overlaid(&ConnectorId::parse("google_sheets").unwrap()));
    assert!(
        overlays
            .apps_at(&ServerUrl::parse("https://mcp.sentry.dev/mcp/").unwrap())
            .any(|app| *app == sentry)
    );
}
