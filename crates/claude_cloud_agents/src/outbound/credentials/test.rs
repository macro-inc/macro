use super::*;
use crate::domain::auth::ConnectionStore;
use std::os::unix::fs::PermissionsExt;

async fn fixture() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = dir.path().join("credentials.json");
    let value = serde_json::json!({"users":{"macro|demo@example.com":{
        "access_token":"fixture-access", "refresh_token":"fixture-refresh", "expires_at":4_000_000_000u64,
        "organization_id":"00000000-0000-4000-8000-000000000001", "environment_id":"env_fixture"
    }}});
    tokio::fs::write(&path, serde_json::to_vec(&value).unwrap())
        .await
        .unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    (dir, path)
}

#[tokio::test]
async fn exact_owner_only_and_redacted_debug() {
    let (_dir, path) = fixture().await;
    let store = FileCredentials::open(path).await.unwrap();
    assert!(matches!(
        store.resolve("macro|other@example.com").await,
        Err(Error::NotConnected)
    ));
    let credentials = store.resolve("macro|demo@example.com").await.unwrap();
    assert_eq!(credentials.access_token.expose(), "fixture-access");
    let debug = format!("{credentials:?}");
    assert!(!debug.contains("fixture-access"));
    assert!(!debug.contains("fixture-refresh"));
}

#[tokio::test]
async fn refuses_group_readable_credential_file() {
    let (_dir, path) = fixture().await;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
    assert!(matches!(
        FileCredentials::open(path).await,
        Err(Error::Credentials)
    ));
}

#[tokio::test]
async fn refuses_symlink_credential_file() {
    let (dir, path) = fixture().await;
    let link = dir.path().join("link.json");
    std::os::unix::fs::symlink(path, &link).unwrap();
    assert!(matches!(
        FileCredentials::open(link).await,
        Err(Error::Credentials)
    ));
}

#[test]
fn rejects_header_injection_and_path_injection() {
    assert!(Secret::parse("abc\r\nAuthorization: injected".into()).is_err());
    assert!(crate::domain::model::SessionId::parse("cse_x/../../other").is_err());
}

#[tokio::test]
async fn memory_connection_is_owner_scoped_shared_and_forgotten_on_restart() {
    let store = AccountCredentials::memory().unwrap();
    let credentials = Credentials {
        access_token: Secret::parse("memory-access".into()).unwrap(),
        refresh_token: Some(Secret::parse("memory-refresh".into()).unwrap()),
        expires_at: 4_000_000_000,
        organization_id: "00000000-0000-4000-8000-000000000001".into(),
        environment_id: "env_fixture".into(),
    };
    store
        .save("macro|alice@example.com", credentials)
        .await
        .unwrap();
    assert!(store.clone().connected("macro|alice@example.com").await);
    assert!(!store.connected("macro|bob@example.com").await);
    assert!(matches!(
        store.resolve("macro|bob@example.com").await,
        Err(Error::NotConnected)
    ));
    assert_eq!(
        store
            .resolve("macro|alice@example.com")
            .await
            .unwrap()
            .access_token
            .expose(),
        "memory-access"
    );
    assert!(
        !AccountCredentials::memory()
            .unwrap()
            .connected("macro|alice@example.com")
            .await
    );
    store.remove("macro|bob@example.com").await.unwrap();
    assert!(store.connected("macro|alice@example.com").await);
    store.remove("macro|alice@example.com").await.unwrap();
    assert!(matches!(
        store.resolve("macro|alice@example.com").await,
        Err(Error::NotConnected)
    ));
}
