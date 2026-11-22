use super::*;
use connectors::fake::{FakeConnection, FakeConnectors};
use macro_user_id::cowlike::CowLike;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@test.com"))
        .unwrap()
        .into_owned()
}

fn accounts(fake: &FakeConnectors) -> ConnectedAccounts<connectors::Connectors> {
    ConnectedAccounts(Arc::new(fake.build()))
}

#[tokio::test]
async fn a_granola_connection_with_api_access_syncs() {
    let fake = FakeConnectors::new()
        .with_connection(&user("a"), FakeConnection::app("granola"))
        .with_connection(&user("b"), FakeConnection::app("granola").disabled());
    let accounts = accounts(&fake);

    assert!(accounts.connected(&user("a")).await.unwrap());
    assert!(!accounts.connected(&user("b")).await.unwrap());
    assert!(!accounts.connected(&user("c")).await.unwrap());
    assert_eq!(accounts.holders().await.unwrap(), vec![user("a")]);
}

/// Macro Connect holds Granola as tools only, so a user on Connect has no
/// Granola API access and their sync is off.
#[tokio::test]
async fn granola_sync_is_off_for_users_on_macro_connect() {
    let flagged = user("flagged");
    let fake = FakeConnectors::new()
        .with_connect_app("granola", false)
        .with_flag_on(&flagged)
        .with_connection(&flagged, FakeConnection::app("granola"))
        .with_connection(&user("a"), FakeConnection::app("granola"));
    let accounts = accounts(&fake);

    assert!(!accounts.connected(&flagged).await.unwrap());
    assert_eq!(accounts.holders().await.unwrap(), vec![user("a")]);
}
