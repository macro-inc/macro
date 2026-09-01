use super::*;
use harness_id::HarnessId;

fn credentials() -> HarnessCredentials {
    HarnessCredentials {
        harness_id: HarnessId::TEST_A,
        token: "mhns_abc_secret".to_owned(),
        scope: HarnessScope::Team,
    }
}

#[test]
fn round_trips_and_restricts_permissions() {
    let dir = std::env::temp_dir().join(format!("macrod-cred-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config_path = dir.join("macro.toml");
    let store = FileCredentialStore::for_config(&config_path);

    assert!(store.load().unwrap().is_none());

    store.save(&credentials()).unwrap();
    assert_eq!(store.load().unwrap(), Some(credentials()));
    assert_eq!(store.path(), dir.join("macro.credentials.json").as_path());

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = std::fs::metadata(store.path())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    // Unparseable state is treated as absent, sending the user to re-pair.
    std::fs::write(store.path(), "not json").unwrap();
    assert!(store.load().unwrap().is_none());

    let _ = std::fs::remove_dir_all(&dir);
}
