use super::*;
use codex_cloud_agents::domain::Secret;
use std::os::unix::fs::{PermissionsExt as _, symlink};

fn credentials() -> Credentials {
    Credentials {
        version: 1,
        access_token: Secret::new("test-access".to_owned()).unwrap(),
        refresh_token: Secret::new("test-refresh".to_owned()).unwrap(),
        expires_at: 12345,
        account_id: "account-test".to_owned(),
    }
}

#[test]
fn json_round_trip_private_permissions_atomic_replace_and_logout() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("state");
    let store = JsonStore::open(&directory).unwrap();
    assert!(store.load().unwrap().is_none());
    store.save(&credentials()).unwrap();
    let saved = store.load().unwrap().unwrap();
    assert_eq!(saved.refresh_token.expose(), "test-refresh");
    assert_eq!(
        std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        std::fs::metadata(directory.join(AUTH_FILE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    let mut next = credentials();
    next.refresh_token = Secret::new("rotated".to_owned()).unwrap();
    store.save(&next).unwrap();
    assert_eq!(
        store.load().unwrap().unwrap().refresh_token.expose(),
        "rotated"
    );
    assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 2);
    store.clear().unwrap();
    store.clear().unwrap();
    assert!(store.load().unwrap().is_none());
}

#[test]
fn lock_excludes_second_command_and_releases_on_drop() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("state");
    let first = JsonStore::open(&directory).unwrap();
    assert!(JsonStore::open(&directory).is_err());
    drop(first);
    JsonStore::open(&directory).expect("dropping the first store releases its lock immediately");
}

#[test]
fn refuses_symlink_and_public_directory_without_chmodding_it() {
    let root = tempfile::tempdir().unwrap();
    let public = root.path().join("public");
    std::fs::create_dir(&public).unwrap();
    std::fs::set_permissions(&public, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(JsonStore::open(&public).is_err());
    assert_eq!(
        std::fs::metadata(&public).unwrap().permissions().mode() & 0o777,
        0o755
    );
    let link = root.path().join("link");
    symlink(&public, &link).unwrap();
    assert!(JsonStore::open(&link).is_err());
}

#[test]
fn refuses_credential_symlink_and_withholds_corrupt_file_contents() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("state");
    let store = JsonStore::open(&directory).unwrap();
    let path = directory.join(AUTH_FILE);
    symlink(root.path().join("missing"), &path).unwrap();
    assert!(store.load().is_err());
    assert!(store.save(&credentials()).is_err());
    std::fs::remove_file(&path).unwrap();
    store.save(&credentials()).unwrap();
    std::fs::write(&path, "secret-marker invalid JSON").unwrap();
    let error = store.load().err().unwrap().to_string();
    assert!(!error.contains("secret-marker"));
}

#[test]
fn drop_releases_lock_even_while_a_duplicate_descriptor_survives() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("state");
    let first = JsonStore::open(&directory).unwrap();
    // A clone shares the open-file description just as fork inheritance does,
    // reproducing the lifetime race without forking a multithreaded test process.
    let inherited = first.lock.try_clone().unwrap();
    assert!(JsonStore::open(&directory).is_err());
    drop(first);
    let second =
        JsonStore::open(&directory).expect("store drop unlocks despite the surviving duplicate");
    drop(inherited);
    assert!(
        JsonStore::open(&directory).is_err(),
        "the old descriptor must not release the new owner's lock"
    );
    drop(second);
    JsonStore::open(&directory).expect("the second owner releases its lock");
}
