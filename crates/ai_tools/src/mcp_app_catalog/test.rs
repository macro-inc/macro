use super::*;
use pipedream_mcp::domain::models::ConnectorOverlay;

/// Overlays held in memory; `None` stands for a table that cannot be read.
struct Overlays(Option<Vec<&'static str>>);

impl ConnectorOverlays for Overlays {
    async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
        unreachable!("the catalog asks for one slug at a time")
    }

    async fn overlay(&self, app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
        let Some(slugs) = &self.0 else {
            anyhow::bail!("overlay table unreachable");
        };
        Ok(slugs
            .iter()
            .find(|slug| **slug == app_slug)
            .map(|slug| ConnectorOverlay {
                app_slug: (*slug).to_owned(),
                server_url: "https://api.githubcopilot.com/mcp".to_owned(),
            }))
    }
}

#[tokio::test]
async fn an_unconfigured_catalog_refuses_a_pipedream_app() {
    let catalog = PipedreamMcpAppCatalog::new(None, Overlays(Some(vec!["github"])));
    let error = catalog
        .is_connectable_app("linear")
        .await
        .expect_err("no directory");
    assert!(matches!(error, BotError::Unavailable(message) if message.contains("not configured")));
}

#[tokio::test]
async fn an_overlaid_app_is_connectable_without_pipedream() {
    let catalog = PipedreamMcpAppCatalog::new(None, Overlays(Some(vec!["github"])));
    assert!(
        catalog
            .is_connectable_app("github")
            .await
            .expect("an overlay needs no directory")
    );
}

#[tokio::test]
async fn an_unreadable_overlay_table_refuses_the_slug() {
    let catalog = PipedreamMcpAppCatalog::new(None, Overlays(None));
    let error = catalog
        .is_connectable_app("github")
        .await
        .expect_err("cannot tell whether it is overlaid");
    assert!(
        matches!(error, BotError::Unavailable(message) if message.contains("could not verify"))
    );
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn the_seeded_github_overlay_needs_no_pipedream(pool: sqlx::PgPool) {
    let catalog = PipedreamMcpAppCatalog::new(None, PgConnectionRepo::new(pool));
    assert!(
        catalog
            .is_connectable_app("github")
            .await
            .expect("github is an overlay")
    );
    assert!(matches!(
        catalog.is_connectable_app("linear").await,
        Err(BotError::Unavailable(_))
    ));
}
