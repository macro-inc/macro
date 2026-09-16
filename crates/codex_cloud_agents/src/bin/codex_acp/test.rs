use super::*;
use std::os::unix::fs::PermissionsExt as _;
#[tokio::test]
async fn atomic_private_roundtrip_and_path_validation() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSessionStore::open(root.path()).unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    let mut state = StoredSession {
        task: Some("task_1".into()),
        ..StoredSession::default()
    };
    store.save(&id, &state).await.unwrap();
    store
        .append(&id, 0, None, &JournalInput::HistoryComplete)
        .await
        .unwrap();
    assert_eq!(
        store.load(&id).await.unwrap().unwrap().task,
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
    store.save(&id, &state).await.unwrap();
    assert!(store.load(&id).await.unwrap().unwrap().uncertain_write);
    assert_eq!(
        store.read(&id).await.unwrap().len(),
        1,
        "metadata saves retain native history"
    );
    assert!(
        store
            .append(&id, 0, None, &JournalInput::HistoryComplete)
            .await
            .is_err()
    );
    assert!(store.load("../../credentials").await.is_err());
    std::fs::write(store.path(&id).unwrap(), b"{ secret broken json").unwrap();
    let error = store.load(&id).await.err().unwrap().to_string();
    assert!(!error.contains("secret"));
}

#[tokio::test]
async fn missing_input_journal_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSessionStore::open(root.path()).unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    store.save(&id, &StoredSession::default()).await.unwrap();
    std::fs::write(
        store.path(&id).unwrap(),
        serde_json::to_vec(&StoredSession::default()).unwrap(),
    )
    .unwrap();
    assert!(
        store
            .load(&id)
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("invalid demo journal")
    );
}
#[tokio::test]
async fn rejects_symlink_and_public_journals() {
    let root = tempfile::tempdir().unwrap();
    let store = JsonSessionStore::open(root.path()).unwrap();
    let id = uuid::Uuid::now_v7().to_string();
    store.save(&id, &StoredSession::default()).await.unwrap();
    let path = store.path(&id).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(store.load(&id).await.is_err());
    std::fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(root.path().join("credentials.json"), &path).unwrap();
    assert!(store.load(&id).await.is_err());
}

#[test]
fn cli_requires_explicit_state_environment_and_branch() {
    use clap::CommandFactory as _;
    Args::command().debug_assert();
    let invocation = [
        "codex_acp",
        "--state-dir",
        "/tmp/probe",
        "--environment",
        "env-test",
        "--branch",
        "test-branch",
    ];
    let args = Args::try_parse_from(invocation).unwrap();
    assert_eq!(args.state_dir, PathBuf::from("/tmp/probe"));
    assert_eq!(args.environment, "env-test");
    assert_eq!(args.branch, "test-branch");
    for missing in [1, 3, 5] {
        let incomplete: Vec<_> = invocation
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != missing && *index != missing + 1)
            .map(|(_, value)| *value)
            .collect();
        assert_eq!(
            Args::try_parse_from(incomplete).err().unwrap().kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }
}
