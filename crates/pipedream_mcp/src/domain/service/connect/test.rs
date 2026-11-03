use super::*;
use crate::domain::models::{ConnectToken, ConnectorOverlay, PipedreamAccount};
use macro_user_id::cowlike::CowLike;
use std::collections::HashMap;
use std::sync::Mutex;

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

#[derive(Default)]
struct FakeStore {
    records: Mutex<HashMap<(String, String), PipedreamConnection>>,
}

impl ConnectionStore for FakeStore {
    type Err = anyhow::Error;

    async fn save(&self, record: &PipedreamConnection) -> Result<(), Self::Err> {
        self.records.lock().unwrap().insert(
            (record.user_id.to_string(), record.app_slug.clone()),
            record.clone(),
        );
        Ok(())
    }

    async fn load(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .get(&(user_id.to_string(), app_slug.to_owned()))
            .cloned())
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_slug: &str,
    ) -> Result<(), Self::Err> {
        self.records
            .lock()
            .unwrap()
            .remove(&(user_id.to_string(), app_slug.to_owned()));
        Ok(())
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        Ok(self
            .records
            .lock()
            .unwrap()
            .values()
            .filter(|r| &r.user_id == user_id)
            .cloned()
            .collect())
    }
}

#[derive(Default)]
struct FakePipedream {
    accounts: HashMap<String, PipedreamAccount>,
    deleted: Mutex<Vec<String>>,
    /// Connect apps by the Pipedream slug they replace.
    connect_apps: HashMap<String, ConnectApp>,
    /// `(user, app_id)` pairs Connect lists as connected.
    connect_connections: Mutex<Vec<(String, String)>>,
    connect_deleted: Mutex<Vec<(String, String)>>,
}

impl FakePipedream {
    fn with_connect_app(mut self, app_slug: &str, app_id: &str) -> Self {
        self.connect_apps.insert(
            app_slug.to_owned(),
            ConnectApp {
                app_id: app_id.to_owned(),
                app_slug: app_slug.to_owned(),
                name: "Linear".to_owned(),
            },
        );
        self
    }

    fn connected_on_connect(self, user_id: &str, app_id: &str) -> Self {
        self.connect_connections
            .lock()
            .unwrap()
            .push((user_id.to_owned(), app_id.to_owned()));
        self
    }
}

impl MacroConnect for FakePipedream {
    async fn app_for_slug(&self, app_slug: &str) -> anyhow::Result<Option<ConnectApp>> {
        Ok(self.connect_apps.get(app_slug).cloned())
    }

    async fn create_connect_session(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app: &ConnectApp,
    ) -> anyhow::Result<String> {
        Ok(format!(
            "https://connect.test/v1/connect/{}/{user_id}",
            app.app_id
        ))
    }

    async fn is_connected(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<bool> {
        Ok(self
            .connect_connections
            .lock()
            .unwrap()
            .contains(&(user_id.to_string(), app_id.to_owned())))
    }

    async fn delete_connection(
        &self,
        user_id: &MacroUserIdStr<'static>,
        app_id: &str,
    ) -> anyhow::Result<()> {
        self.connect_deleted
            .lock()
            .unwrap()
            .push((user_id.to_string(), app_id.to_owned()));
        Ok(())
    }
}

impl PipedreamConnect for FakePipedream {
    async fn create_connect_token(&self, _external_user_id: &str) -> anyhow::Result<ConnectToken> {
        Ok(ConnectToken {
            token: "ctok_test".into(),
            expires_at: "2099-01-01T00:00:00Z".into(),
            connect_link_url: "https://pipedream.com/_static/connect.html?token=ctok_test".into(),
        })
    }

    async fn get_account(&self, account_id: &str) -> anyhow::Result<Option<PipedreamAccount>> {
        Ok(self.accounts.get(account_id).cloned())
    }

    async fn list_accounts(
        &self,
        external_user_id: &str,
        app_slug: &str,
    ) -> anyhow::Result<Vec<PipedreamAccount>> {
        Ok(self
            .accounts
            .values()
            .filter(|a| {
                a.external_user_id.as_deref() == Some(external_user_id) && a.app_slug == app_slug
            })
            .cloned()
            .collect())
    }

    async fn delete_account(&self, account_id: &str) -> anyhow::Result<()> {
        self.deleted.lock().unwrap().push(account_id.to_owned());
        Ok(())
    }
}

struct NoOverlays;

impl ConnectorOverlays for NoOverlays {
    async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
        Ok(Vec::new())
    }

    async fn overlay(&self, _app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
        Ok(None)
    }
}

struct SentryOverlay;

impl ConnectorOverlays for SentryOverlay {
    async fn overlays(&self) -> anyhow::Result<Vec<ConnectorOverlay>> {
        Ok(vec![sentry_overlay()])
    }

    async fn overlay(&self, app_slug: &str) -> anyhow::Result<Option<ConnectorOverlay>> {
        Ok((app_slug == "sentry").then(sentry_overlay))
    }
}

fn sentry_overlay() -> ConnectorOverlay {
    ConnectorOverlay {
        app_slug: "sentry".to_owned(),
        server_url: "https://mcp.sentry.dev/mcp".to_owned(),
    }
}

fn account(id: &str, external_user_id: Option<&str>, app_slug: &str) -> PipedreamAccount {
    PipedreamAccount {
        id: id.to_owned(),
        external_user_id: external_user_id.map(str::to_owned),
        app_slug: app_slug.to_owned(),
        app_name: "Linear".to_owned(),
        healthy: true,
        created_at: None,
    }
}

fn now() -> chrono::DateTime<chrono::Utc> {
    "2026-10-27T18:00:00Z".parse().unwrap()
}

fn created(id: &str, external_user_id: &str, minutes_ago: i64) -> PipedreamAccount {
    PipedreamAccount {
        created_at: Some(now() - chrono::TimeDelta::minutes(minutes_ago)),
        ..account(id, Some(external_user_id), "linear")
    }
}

#[tokio::test]
async fn completing_verifies_and_stores_the_connected_app() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        account("apn_1", Some("macro|user-1@example.com"), "linear"),
    );

    let record = complete_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_1",
        None,
    )
    .await
    .unwrap();

    assert_eq!(record.app_slug, "linear");
    assert_eq!(record.account_id, "apn_1");
    assert_eq!(record.server_name, "Linear");
    assert!(record.enabled);
    assert!(
        store
            .load(&user("macro|user-1@example.com"), "linear")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn completing_rejects_accounts_owned_by_someone_else() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        account("apn_1", Some("macro|user-2@example.com"), "linear"),
    );

    let err = complete_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_1",
        None,
    )
    .await
    .unwrap_err();

    assert!(matches!(err, PipedreamConnectError::NotFound));
    assert!(store.records.lock().unwrap().is_empty(), "nothing stored");
}

#[tokio::test]
async fn completing_rejects_unknown_accounts() {
    let store = FakeStore::default();
    let pd = FakePipedream::default();

    let err = complete_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_missing",
        None,
    )
    .await
    .unwrap_err();

    assert!(matches!(err, PipedreamConnectError::NotFound));
}

#[tokio::test]
async fn reconnecting_keeps_name_and_enabled_state_but_swaps_the_account() {
    let store = FakeStore::default();
    store
        .save(&PipedreamConnection {
            user_id: user("macro|user-1@example.com"),
            app_slug: "linear".into(),
            server_name: "My Linear".into(),
            account_id: "apn_old".into(),
            enabled: false,
            provider: ConnectionProvider::Pipedream,
        })
        .await
        .unwrap();

    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_new".into(),
        account("apn_new", Some("macro|user-1@example.com"), "linear"),
    );

    let record = complete_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_new",
        None,
    )
    .await
    .unwrap();

    assert_eq!(record.server_name, "My Linear", "explicit name preserved");
    assert_eq!(record.account_id, "apn_new");
    assert!(!record.enabled, "user's disabled state preserved");
}

#[tokio::test]
async fn explicit_server_name_wins() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        account("apn_1", Some("macro|user-1@example.com"), "linear"),
    );

    let record = complete_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_1",
        Some("Work Linear"),
    )
    .await
    .unwrap();

    assert_eq!(record.server_name, "Work Linear");
}

#[tokio::test]
async fn disconnect_revokes_the_pipedream_account_and_deletes_the_row() {
    let store = FakeStore::default();
    store
        .save(&PipedreamConnection {
            user_id: user("macro|user-1@example.com"),
            app_slug: "linear".into(),
            server_name: "Linear".into(),
            account_id: "apn_1".into(),
            enabled: true,
            provider: ConnectionProvider::Pipedream,
        })
        .await
        .unwrap();
    let pd = FakePipedream::default();

    let removed = disconnect_mcp_server(&store, &pd, &user("macro|user-1@example.com"), "linear")
        .await
        .unwrap();

    assert_eq!(
        removed.map(|connection| connection.account_id),
        Some("apn_1".to_owned())
    );
    assert_eq!(*pd.deleted.lock().unwrap(), vec!["apn_1".to_owned()]);
    assert!(store.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disconnect_of_unknown_app_is_a_quiet_noop() {
    let store = FakeStore::default();
    let pd = FakePipedream::default();

    let removed = disconnect_mcp_server(&store, &pd, &user("macro|user-1@example.com"), "linear")
        .await
        .unwrap();

    assert!(removed.is_none());
    assert!(pd.deleted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn completing_an_overlaid_app_is_refused_and_its_account_deleted() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        account("apn_1", Some("macro|user-1@example.com"), "sentry"),
    );

    let err = complete_pipedream_connection(
        &store,
        &SentryOverlay,
        &pd,
        &user("macro|user-1@example.com"),
        "apn_1",
        None,
    )
    .await
    .unwrap_err();

    assert!(matches!(
        err,
        PipedreamConnectError::Overlaid { ref server_url, .. }
            if server_url == "https://mcp.sentry.dev/mcp"
    ));
    assert_eq!(*pd.deleted.lock().unwrap(), vec!["apn_1".to_owned()]);
    assert!(
        store
            .list(&user("macro|user-1@example.com"))
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn recovery_stores_the_newest_recent_account_the_ui_never_reported() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    for account in [
        created("apn_older", "macro|user-1@example.com", 5),
        created("apn_newest", "macro|user-1@example.com", 1),
    ] {
        pd.accounts.insert(account.id.clone(), account);
    }

    let record = recover_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
        None,
        now(),
    )
    .await
    .unwrap()
    .expect("recovered");

    assert_eq!(record.account_id, "apn_newest");
    assert!(
        store
            .load(&user("macro|user-1@example.com"), "linear")
            .await
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn recovery_ignores_accounts_outside_the_window_and_other_users() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    for account in [
        created("apn_stale", "macro|user-1@example.com", 60),
        created("apn_theirs", "macro|user-2@example.com", 1),
    ] {
        pd.accounts.insert(account.id.clone(), account);
    }

    let recovered = recover_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
        None,
        now(),
    )
    .await
    .unwrap();

    assert!(recovered.is_none());
    assert!(store.records.lock().unwrap().is_empty(), "nothing stored");
}

#[tokio::test]
async fn recovery_does_not_report_the_already_stored_account_as_new() {
    let store = FakeStore::default();
    store
        .save(&PipedreamConnection {
            user_id: user("macro|user-1@example.com"),
            app_slug: "linear".into(),
            server_name: "Linear".into(),
            account_id: "apn_1".into(),
            enabled: true,
            provider: ConnectionProvider::Pipedream,
        })
        .await
        .unwrap();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        created("apn_1", "macro|user-1@example.com", 1),
    );

    let recovered = recover_pipedream_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
        None,
        now(),
    )
    .await
    .unwrap();

    assert!(recovered.is_none());
}

#[tokio::test]
async fn recovering_an_overlaid_app_is_refused_and_its_account_deleted() {
    let store = FakeStore::default();
    let mut pd = FakePipedream::default();
    pd.accounts.insert(
        "apn_1".into(),
        PipedreamAccount {
            app_slug: "sentry".into(),
            ..created("apn_1", "macro|user-1@example.com", 1)
        },
    );

    let err = recover_pipedream_connection(
        &store,
        &SentryOverlay,
        &pd,
        &user("macro|user-1@example.com"),
        "sentry",
        None,
        now(),
    )
    .await
    .unwrap_err();

    assert!(matches!(err, PipedreamConnectError::Overlaid { .. }));
    assert_eq!(*pd.deleted.lock().unwrap(), vec!["apn_1".to_owned()]);
    assert!(store.records.lock().unwrap().is_empty(), "nothing stored");
}

#[tokio::test]
async fn connect_session_starts_for_an_app_connect_serves() {
    let pd = FakePipedream::default().with_connect_app("linear", "linear");

    let url = start_connect_session(
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
    )
    .await
    .unwrap();

    assert_eq!(
        url.as_deref(),
        Some("https://connect.test/v1/connect/linear/macro|user-1@example.com")
    );
}

#[tokio::test]
async fn apps_connect_lacks_overlaid_or_pipedream_only_stay_on_pipedream() {
    let pd = FakePipedream::default()
        .with_connect_app("sentry", "sentry")
        .with_connect_app("granola", "granola");
    let user = user("macro|user-1@example.com");

    for (overlays, slug) in [(false, "notion"), (true, "sentry"), (false, "granola")] {
        let url = if overlays {
            start_connect_session(&SentryOverlay, &pd, &user, slug).await
        } else {
            start_connect_session(&NoOverlays, &pd, &user, slug).await
        };
        assert_eq!(url.unwrap(), None, "{slug}");
    }
}

#[tokio::test]
async fn completing_through_connect_stores_a_connect_record() {
    let store = FakeStore::default();
    let pd = FakePipedream::default()
        .with_connect_app("airtable_oauth", "airtable")
        .connected_on_connect("macro|user-1@example.com", "airtable");

    let record = complete_connect_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "airtable_oauth",
        None,
    )
    .await
    .unwrap();

    assert_eq!(record.app_slug, "airtable_oauth");
    assert_eq!(record.account_id, "airtable");
    assert_eq!(record.provider, ConnectionProvider::Connect);
    assert!(record.enabled);
    assert_eq!(
        store
            .load(&user("macro|user-1@example.com"), "airtable_oauth")
            .await
            .unwrap(),
        Some(record)
    );
}

#[tokio::test]
async fn completing_through_connect_before_connect_confirms_is_not_found() {
    let store = FakeStore::default();
    // Connected for someone else: the caller cannot claim it.
    let pd = FakePipedream::default()
        .with_connect_app("linear", "linear")
        .connected_on_connect("macro|user-2@example.com", "linear");

    let err = complete_connect_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
        None,
    )
    .await
    .unwrap_err();

    assert!(matches!(err, PipedreamConnectError::NotFound));
    assert!(store.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn completing_through_connect_revokes_the_pipedream_grant_it_replaces() {
    let store = FakeStore::default();
    store
        .save(&PipedreamConnection {
            user_id: user("macro|user-1@example.com"),
            app_slug: "linear".into(),
            server_name: "My Linear".into(),
            account_id: "apn_1".into(),
            enabled: false,
            provider: ConnectionProvider::Pipedream,
        })
        .await
        .unwrap();
    let pd = FakePipedream::default()
        .with_connect_app("linear", "linear")
        .connected_on_connect("macro|user-1@example.com", "linear");

    let record = complete_connect_connection(
        &store,
        &NoOverlays,
        &pd,
        &user("macro|user-1@example.com"),
        "linear",
        None,
    )
    .await
    .unwrap();

    assert_eq!(record.server_name, "My Linear");
    assert!(!record.enabled);
    assert_eq!(record.provider, ConnectionProvider::Connect);
    assert_eq!(*pd.deleted.lock().unwrap(), vec!["apn_1".to_owned()]);
}

#[tokio::test]
async fn disconnecting_a_connect_app_deletes_it_from_connect() {
    let store = FakeStore::default();
    store
        .save(&PipedreamConnection {
            user_id: user("macro|user-1@example.com"),
            app_slug: "airtable_oauth".into(),
            server_name: "Airtable".into(),
            account_id: "airtable".into(),
            enabled: true,
            provider: ConnectionProvider::Connect,
        })
        .await
        .unwrap();
    let pd = FakePipedream::default();

    disconnect_mcp_server(
        &store,
        &pd,
        &user("macro|user-1@example.com"),
        "airtable_oauth",
    )
    .await
    .unwrap();

    assert_eq!(
        *pd.connect_deleted.lock().unwrap(),
        vec![("macro|user-1@example.com".to_owned(), "airtable".to_owned())]
    );
    assert!(pd.deleted.lock().unwrap().is_empty());
    assert!(store.records.lock().unwrap().is_empty());
}
