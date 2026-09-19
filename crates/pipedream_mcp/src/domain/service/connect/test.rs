use super::*;
use crate::domain::models::{ConnectToken, PipedreamAccount};
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

    async fn delete_account(&self, account_id: &str) -> anyhow::Result<()> {
        self.deleted.lock().unwrap().push(account_id.to_owned());
        Ok(())
    }
}

fn account(id: &str, external_user_id: Option<&str>, app_slug: &str) -> PipedreamAccount {
    PipedreamAccount {
        id: id.to_owned(),
        external_user_id: external_user_id.map(str::to_owned),
        app_slug: app_slug.to_owned(),
        app_name: "Linear".to_owned(),
        healthy: true,
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
        })
        .await
        .unwrap();
    let pd = FakePipedream::default();

    disconnect_mcp_server(&store, &pd, &user("macro|user-1@example.com"), "linear")
        .await
        .unwrap();

    assert_eq!(*pd.deleted.lock().unwrap(), vec!["apn_1".to_owned()]);
    assert!(store.records.lock().unwrap().is_empty());
}

#[tokio::test]
async fn disconnect_of_unknown_app_is_a_quiet_noop() {
    let store = FakeStore::default();
    let pd = FakePipedream::default();

    disconnect_mcp_server(&store, &pd, &user("macro|user-1@example.com"), "linear")
        .await
        .unwrap();

    assert!(pd.deleted.lock().unwrap().is_empty());
}
