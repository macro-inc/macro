//! Each source of connections, checked the same way on dev: list, connect
//! where consent is already given, load tools and call one through an agent,
//! call the API where the source provides one, disable, and remove where the
//! suite can restore what it removed. Plus the rules every answer follows.
//!
//! Every scenario skips, and passes, without the accounts' API keys; one
//! whose fixture is not set skips the same way (`AGENTS.md`).

use std::collections::HashSet;

use connectors_e2e::{
    Account, CONNECT_APP, ConnectStep, Connector, GITHUB_LINKED, MCP_SERVER_URL, NOTION_PAGE,
    PIPEDREAM_APP, Report, Status, Suite, Target, app_key, skip,
};
use rootcause::prelude::*;

/// The name the suite gives the server it adds by URL, and its rename.
const SERVER_NAME: &str = "Connectors e2e server";
const SERVER_RENAMED: &str = "Connectors e2e server (renamed)";
/// An app slug no catalog holds.
const NO_SUCH_APP: &str = "connectors-e2e-no-such-app";
/// Fields that would say which source holds a connection.
const SOURCE_FIELDS: [&str; 4] = ["provider", "source", "grantProvider", "backend"];
/// What importing a Notion page may answer when it worked or was not needed.
const IMPORT_OUTCOMES: [&str; 5] = [
    "imported",
    "already_imported",
    "already_imported_by_teammate",
    "previously_declined",
    "import_in_progress",
];

/// Both accounts' lists follow the rules every answer follows: no source
/// named, at most one connector per app, `slack_v2` folded into `slack`.
/// Malformed and unknown keys are refused.
#[tokio::test(flavor = "multi_thread")]
async fn every_list_follows_the_shared_rules() -> Result<(), Report> {
    let Some(suite) = Suite::from_env("every_list_follows_the_shared_rules")? else {
        return Ok(());
    };
    for account in [&suite.flagged, &suite.unflagged] {
        let raw = account.connectors_raw().await?;
        for connector in &raw {
            for field in SOURCE_FIELDS {
                if connector.get(field).is_some() {
                    bail!(
                        "{:?}: a connector names its source ({field}): {connector}",
                        account.kind()
                    );
                }
            }
        }
        let connectors = account.connectors().await?;
        let mut keys = HashSet::new();
        for connector in &connectors {
            if !keys.insert(connector.key.as_str()) {
                bail!("{:?}: {} is listed twice", account.kind(), connector.key);
            }
            if connector.key == app_key("slack_v2") {
                bail!("{:?}: slack_v2 is listed apart from slack", account.kind());
            }
            if let Target::App { slug } = &connector.target
                && connector.key != app_key(slug)
            {
                bail!(
                    "{:?}: {} is keyed apart from its slug {slug}",
                    account.kind(),
                    connector.key
                );
            }
        }

        let refused = account.start_connect_raw("nonsense/key").await?;
        assert_eq!(refused.status, 400, "a malformed key: {}", refused.body);
        let unknown = account.start_connect_raw(&app_key(NO_SUCH_APP)).await?;
        assert_eq!(unknown.status, 404, "an unknown app: {}", unknown.body);
        let not_held = account.remove_raw(&app_key(NO_SUCH_APP)).await?;
        assert_eq!(
            not_held.status, 404,
            "removing what is not held: {}",
            not_held.body
        );
    }
    Ok(())
}

/// Macro Connect, for the flagged account: an app it connected through
/// Connect is connected and usable, and its catalog entry and connect step
/// answer.
#[tokio::test(flavor = "multi_thread")]
async fn macro_connect_connection_works_end_to_end() -> Result<(), Report> {
    let scenario = "macro_connect_connection_works_end_to_end";
    let Some(suite) = Suite::from_env(scenario)? else {
        return Ok(());
    };
    let Some(app) = suite.fixtures.connect_app.clone() else {
        skip(scenario, CONNECT_APP);
        return Ok(());
    };
    let connector = hosted_app_cycle(&suite.flagged, &app).await?;
    assert!(
        connector.mcp,
        "a Connect connection provides MCP: {connector:?}"
    );
    Ok(())
}

/// Pipedream, for the unflagged account: an app it connected through
/// Pipedream is connected, provides MCP and the API, and is usable.
#[tokio::test(flavor = "multi_thread")]
async fn pipedream_connection_works_end_to_end() -> Result<(), Report> {
    let scenario = "pipedream_connection_works_end_to_end";
    let Some(suite) = Suite::from_env(scenario)? else {
        return Ok(());
    };
    let Some(app) = suite.fixtures.pipedream_app.clone() else {
        skip(scenario, PIPEDREAM_APP);
        return Ok(());
    };
    let connector = hosted_app_cycle(&suite.unflagged, &app).await?;
    assert!(
        connector.mcp,
        "a Pipedream connection provides MCP: {connector:?}"
    );
    assert!(
        connector.api,
        "a Pipedream connection provides the API: {connector:?}"
    );
    Ok(())
}

/// The GitHub account link, for the unflagged account: GitHub is connected,
/// provides MCP but not the API, and is usable.
#[tokio::test(flavor = "multi_thread")]
async fn github_link_works_end_to_end() -> Result<(), Report> {
    let scenario = "github_link_works_end_to_end";
    let Some(suite) = Suite::from_env(scenario)? else {
        return Ok(());
    };
    if !suite.fixtures.github_linked {
        skip(scenario, GITHUB_LINKED);
        return Ok(());
    }
    let connector = hosted_app_cycle(&suite.unflagged, "github").await?;
    assert!(connector.mcp, "the GitHub link provides MCP: {connector:?}");
    assert!(
        !connector.api,
        "the GitHub link never provides the API: {connector:?}"
    );
    Ok(())
}

/// A native MCP server added by URL, for both accounts (the flag does not
/// apply to it): added, connected, usable, renamed, disabled, removed.
#[tokio::test(flavor = "multi_thread")]
async fn server_added_by_url_works_end_to_end() -> Result<(), Report> {
    let scenario = "server_added_by_url_works_end_to_end";
    let Some(suite) = Suite::from_env(scenario)? else {
        return Ok(());
    };
    let Some(url) = suite.fixtures.mcp_server_url.clone() else {
        skip(scenario, MCP_SERVER_URL);
        return Ok(());
    };
    for account in [&suite.unflagged, &suite.flagged] {
        server_cycle(account, &url)
            .await
            .attach(format!("{:?} account", account.kind()))?;
    }
    Ok(())
}

/// The API from the same connection as MCP: importing a Notion page calls
/// Notion's API through the connection of each account that holds Notion
/// with API access.
#[tokio::test(flavor = "multi_thread")]
async fn api_is_reached_through_the_connection() -> Result<(), Report> {
    let scenario = "api_is_reached_through_the_connection";
    let Some(suite) = Suite::from_env(scenario)? else {
        return Ok(());
    };
    let Some(page) = suite.fixtures.notion_page.clone() else {
        skip(scenario, NOTION_PAGE);
        return Ok(());
    };
    let mut checked = 0;
    for account in [&suite.flagged, &suite.unflagged] {
        let Some(notion) = account.app("notion").await? else {
            continue;
        };
        if notion.status != Status::Connected || !notion.api {
            continue;
        }
        let outcome = account.import_notion_page(&page).await?;
        assert!(
            IMPORT_OUTCOMES.contains(&outcome.as_str()),
            "{:?}: importing a Notion page answered {outcome}",
            account.kind()
        );
        checked += 1;
    }
    if checked == 0 {
        bail!("{NOTION_PAGE} is set, but neither account holds Notion with API access");
    }
    Ok(())
}

/// Removing a connection a vendor holds revokes it there, so the suite
/// cannot restore it unattended: run by hand
/// (`--run-ignored only`), then reconnect each app in Settings. Removing
/// GitHub unlinks the account.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "removes real connections that a person has to reconnect"]
async fn removing_a_hosted_connection_disconnects_it() -> Result<(), Report> {
    let Some(suite) = Suite::from_env("removing_a_hosted_connection_disconnects_it")? else {
        return Ok(());
    };
    let mut removals = Vec::new();
    if let Some(app) = &suite.fixtures.connect_app {
        removals.push((&suite.flagged, app.clone()));
    }
    if let Some(app) = &suite.fixtures.pipedream_app {
        removals.push((&suite.unflagged, app.clone()));
    }
    if suite.fixtures.github_linked {
        removals.push((&suite.unflagged, "github".to_owned()));
    }
    for (account, app) in removals {
        let key = app_key(&app);
        account.remove(&key).await?;
        let after = account.connector(&key).await?;
        if let Some(after) = after {
            assert_eq!(
                after.status,
                Status::NotConnected,
                "{key} after removal: {after:?}"
            );
        }
        let again = account.remove_raw(&key).await?;
        assert_eq!(again.status, 404, "removing {key} twice: {}", again.body);
        eprintln!(
            "{:?}: removed {key}; reconnect it in Settings → Connections",
            account.kind()
        );
    }
    Ok(())
}

/// The checks every hosted source shares, on an app `account` connected
/// with consent already given: it lists as connected, completing again
/// keeps it connected, the catalog and the connect step answer, an agent
/// loads and calls its tools, and disabling turns it off until enabled.
async fn hosted_app_cycle(account: &Account, slug: &str) -> Result<Connector, Report> {
    let key = app_key(slug);
    let listed = account
        .connector(&key)
        .await?
        .ok_or_else(|| report!("{key} is not listed for the {:?} account", account.kind()))?;
    // A run that failed midway may have left it disabled.
    if listed.status == Status::Disabled {
        account.set_enabled(&key, true).await?;
    }

    let completed = account.complete_connect(&key).await?;
    assert_eq!(
        completed.status,
        Status::Connected,
        "{key} after completing: {completed:?}"
    );
    assert!(
        completed.connectable,
        "{key} can be connected: {completed:?}"
    );

    let listed = account
        .connector(&key)
        .await?
        .ok_or_else(|| report!("{key} is not listed after completing"))?;
    assert_eq!(listed.status, Status::Connected, "{key} listed: {listed:?}");

    let catalog = account.catalog_keys(slug).await?;
    assert!(
        catalog.contains(&key),
        "searching the catalog for {slug} found {catalog:?}"
    );

    expect_a_step(account.start_connect(&key).await?)?;

    let report = account.use_app_through_agent(&listed.name).await?;
    expect_a_working_call(&key, &report)?;

    disable_then_enable(account, &key).await?;
    Ok(listed)
}

/// Add the server at `url`, use it, rename it, disable it and remove it.
async fn server_cycle(account: &Account, url: &str) -> Result<(), Report> {
    // A run that failed midway may have left it behind.
    for connector in account.connectors().await? {
        if matches!(&connector.target, Target::Server { url: held } if held == url)
            || connector.name == SERVER_NAME
            || connector.name == SERVER_RENAMED
        {
            account.remove(&connector.key).await?;
        }
    }

    let added = account.add_server(url, SERVER_NAME).await?;
    let key = added.key.clone();
    let outcome = server_checks(account, &added).await;
    // Remove it whatever happened, so the next run starts clean.
    let removed = account.remove(&key).await;
    outcome?;
    removed?;

    if account
        .connector(&key)
        .await?
        .is_some_and(|held| held.status != Status::NotConnected)
    {
        bail!("{key} is still held after removal");
    }
    let again = account.remove_raw(&key).await?;
    assert_eq!(again.status, 404, "removing {key} twice: {}", again.body);
    Ok(())
}

async fn server_checks(account: &Account, added: &Connector) -> Result<(), Report> {
    let key = &added.key;
    assert_eq!(
        added.status,
        Status::Connected,
        "a server that needs no sign-in: {added:?}"
    );
    assert!(added.mcp, "a server provides MCP: {added:?}");
    assert!(
        !added.api,
        "a native server never provides the API: {added:?}"
    );

    let listed = account
        .connector(key)
        .await?
        .ok_or_else(|| report!("{key} is not listed after adding it"))?;
    assert_eq!(listed.status, Status::Connected, "{key} listed: {listed:?}");

    let report = account.use_app_through_agent(&listed.name).await?;
    expect_a_working_call(key, &report)?;

    if let Target::Server { .. } = listed.target {
        account.rename(key, SERVER_RENAMED).await?;
        let renamed = account
            .connector(key)
            .await?
            .ok_or_else(|| report!("{key} is not listed after renaming it"))?;
        assert_eq!(
            renamed.name, SERVER_RENAMED,
            "{key} after renaming: {renamed:?}"
        );
    }

    disable_then_enable(account, key).await
}

/// Disabling `key` lists it as disabled; enabling it lists it as connected
/// again. It is enabled again whatever happened in between.
async fn disable_then_enable(account: &Account, key: &str) -> Result<(), Report> {
    account.set_enabled(key, false).await?;
    let disabled = account.connector(key).await;
    let enabled = account.set_enabled(key, true).await;
    let disabled = disabled?.ok_or_else(|| report!("{key} is not listed once disabled"))?;
    enabled?;
    assert_eq!(
        disabled.status,
        Status::Disabled,
        "{key} once disabled: {disabled:?}"
    );

    let enabled = account
        .connector(key)
        .await?
        .ok_or_else(|| report!("{key} is not listed once enabled again"))?;
    assert_eq!(
        enabled.status,
        Status::Connected,
        "{key} once enabled again: {enabled:?}"
    );
    Ok(())
}

fn expect_a_step(step: ConnectStep) -> Result<(), Report> {
    let page = match &step {
        ConnectStep::OpenUrl { url } => url,
        ConnectStep::EmbeddedDialog { token, link, .. } => {
            if token.is_empty() {
                bail!("the connect dialog has no token: {step:?}");
            }
            link
        }
    };
    if !page.starts_with("https://") {
        bail!("the connect step opens no https page: {step:?}");
    }
    Ok(())
}

fn expect_a_working_call(key: &str, report: &connectors_e2e::AgentReport) -> Result<(), Report> {
    if report.tools == 0 || !report.ok || report.tool_calls < 2 {
        bail!("an agent could not use {key}: {report:?}");
    }
    Ok(())
}
