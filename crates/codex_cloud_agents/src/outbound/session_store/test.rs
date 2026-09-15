use super::*;
use std::os::unix::fs::PermissionsExt as _;
#[test]
fn atomic_private_roundtrip_and_path_validation() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSessionStore::open(root.path()).unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let mut state = StoredSession {
        task: Some("task_1".into()),
        ..StoredSession::default()
    };
    store.save(&id, &state).unwrap();
    assert_eq!(
        store.load(&id).unwrap().unwrap().task,
        Some("task_1".into())
    );
    assert_eq!(
        std::fs::metadata(store.path(&id).unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o077,
        0
    );
    state.uncertain_write = true;
    store.save(&id, &state).unwrap();
    assert!(store.load(&id).unwrap().unwrap().uncertain_write);
    assert!(store.load("../../credentials").is_err());
    std::fs::write(store.path(&id).unwrap(), b"{ secret broken json").unwrap();
    let error = store.load(&id).err().unwrap().to_string();
    assert!(!error.contains("secret"));
}
#[test]
fn rejects_symlink_and_public_journals() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSessionStore::open(root.path()).unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    store.save(&id, &StoredSession::default()).unwrap();
    let path = store.path(&id).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(store.load(&id).is_err());
    std::fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(root.path().join("credentials.json"), &path).unwrap();
    assert!(store.load(&id).is_err());
}
