use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const USER: &str = "macro|owner@example.com";

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER).unwrap().into_owned()
}

async fn insert(pool: &PgPool, slug: &str, account: &str, enabled: bool, provider: &str) {
    sqlx::query!(
        "INSERT INTO pipedream_mcp_connections (user_id, app_slug, server_name, account_id, enabled, provider) VALUES ($1, $2, $3, $4, $5, $6)",
        USER,
        slug,
        format!("{slug} name"),
        account,
        enabled,
        provider,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn stored(pool: &PgPool) -> Vec<(String, String, String, bool, String)> {
    sqlx::query!(
        "SELECT app_slug, server_name, account_id, enabled, provider FROM pipedream_mcp_connections WHERE user_id = $1 ORDER BY app_slug",
        USER,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.app_slug, row.server_name, row.account_id, row.enabled, row.provider))
    .collect()
}

fn slugs(rows: &[HostedRow]) -> Vec<&str> {
    rows.iter().map(|row| row.app_slug.as_str()).collect()
}

/// Each hosted source reads and changes only its own provider's rows.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn each_provider_sees_and_changes_only_its_own_rows(pool: PgPool) {
    insert(&pool, "linear", "apn_linear", true, "pipedream").await;
    insert(&pool, "slack_v2", "apn_slack", false, "pipedream").await;
    insert(&pool, "notion", "notion", true, "connect").await;
    let pipedream = HostedRepo::new(pool.clone(), Provider::Pipedream);
    let connect = HostedRepo::new(pool.clone(), Provider::Connect);

    assert_eq!(
        slugs(&pipedream.list(&user()).await.unwrap()),
        ["linear", "slack_v2"]
    );
    assert_eq!(slugs(&connect.list(&user()).await.unwrap()), ["notion"]);

    assert_eq!(pipedream.holders(&["notion"]).await.unwrap(), Vec::new());
    assert_eq!(connect.holders(&["notion"]).await.unwrap(), vec![user()]);
    // A disabled row holds nothing.
    assert_eq!(
        pipedream.holders(&["slack", "slack_v2"]).await.unwrap(),
        Vec::new()
    );

    assert_eq!(
        pipedream
            .set_enabled(&user(), &["notion"], false)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        pipedream
            .rename(&user(), &["notion"], "Mine")
            .await
            .unwrap(),
        0
    );
    pipedream.delete(&user(), &["notion"]).await.unwrap();
    assert_eq!(
        connect
            .set_enabled(&user(), &["linear"], false)
            .await
            .unwrap(),
        0
    );
    connect.delete(&user(), &["linear"]).await.unwrap();

    assert_eq!(
        stored(&pool).await,
        vec![
            (
                "linear".into(),
                "linear name".into(),
                "apn_linear".into(),
                true,
                "pipedream".into()
            ),
            (
                "notion".into(),
                "notion name".into(),
                "notion".into(),
                true,
                "connect".into()
            ),
            (
                "slack_v2".into(),
                "slack_v2 name".into(),
                "apn_slack".into(),
                false,
                "pipedream".into()
            ),
        ]
    );
}

/// The table is keyed by user and slug across both providers: completing an
/// app through Connect takes the row Pipedream held for it, under any of the
/// app's slugs, keeps the user's name for it and turns it on.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn completing_through_connect_replaces_the_pipedream_row(pool: PgPool) {
    insert(&pool, "slack_v2", "apn_slack", false, "pipedream").await;
    let connect = HostedRepo::new(pool.clone(), Provider::Connect);

    let replaced = connect
        .replace(
            &HostedRow {
                user: user(),
                app_slug: "slack".to_owned(),
                server_name: "Slack".to_owned(),
                account_id: "slack".to_owned(),
                enabled: true,
            },
            &["slack", "slack_v2"],
        )
        .await
        .unwrap();

    assert_eq!(
        replaced,
        vec![Grant {
            provider: Provider::Pipedream,
            account_id: "apn_slack".to_owned(),
        }]
    );
    assert_eq!(
        stored(&pool).await,
        vec![(
            "slack".into(),
            "slack_v2 name".into(),
            "slack".into(),
            true,
            "connect".into()
        )]
    );
}

/// The other way round: completing through Pipedream takes Connect's row.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn completing_through_pipedream_replaces_the_connect_row(pool: PgPool) {
    insert(&pool, "notion", "notion", true, "connect").await;
    insert(&pool, "linear", "apn_linear", true, "pipedream").await;
    let pipedream = HostedRepo::new(pool.clone(), Provider::Pipedream);

    let replaced = pipedream
        .replace(
            &HostedRow {
                user: user(),
                app_slug: "notion".to_owned(),
                server_name: "Notion".to_owned(),
                account_id: "apn_notion".to_owned(),
                enabled: true,
            },
            &["notion"],
        )
        .await
        .unwrap();

    assert_eq!(
        replaced,
        vec![Grant {
            provider: Provider::Connect,
            account_id: "notion".to_owned(),
        }]
    );
    assert_eq!(
        stored(&pool).await,
        vec![
            (
                "linear".into(),
                "linear name".into(),
                "apn_linear".into(),
                true,
                "pipedream".into()
            ),
            (
                "notion".into(),
                "notion name".into(),
                "apn_notion".into(),
                true,
                "pipedream".into()
            ),
        ]
    );
}

/// A first connection stores the name it was given.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn a_first_connection_is_stored_under_its_own_name(pool: PgPool) {
    let pipedream = HostedRepo::new(pool.clone(), Provider::Pipedream);

    let replaced = pipedream
        .replace(
            &HostedRow {
                user: user(),
                app_slug: "linear".to_owned(),
                server_name: "Linear".to_owned(),
                account_id: "apn_linear".to_owned(),
                enabled: true,
            },
            &["linear"],
        )
        .await
        .unwrap();

    assert!(replaced.is_empty());
    assert_eq!(
        stored(&pool).await,
        vec![(
            "linear".into(),
            "Linear".into(),
            "apn_linear".into(),
            true,
            "pipedream".into()
        )]
    );
}
