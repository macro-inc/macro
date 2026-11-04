use super::*;

#[test]
fn records_survive_a_new_store_without_exposing_credentials() {
    use std::os::unix::fs::PermissionsExt as _;
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let record = Record {
        version: 1,
        id: id.clone(),
        kind: TuiAgent::Claude,
        cwd: PathBuf::from("/repo"),
        model: "sonnet".into(),
        native_id: Some(id.clone()),
        transcript: Some(PathBuf::from("/log.jsonl")),
        started: 1,
    };
    Store(root.path().to_owned()).save(&record).unwrap();
    let reopened = Store(root.path().to_owned());
    assert_eq!(reopened.load(&id).unwrap().native_id, Some(id.clone()));
    assert_eq!(
        std::fs::metadata(reopened.path(&id).unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(reopened.load("../other").is_err());
}

#[test]
fn list_returns_every_valid_record_and_skips_the_rest() {
    let root = tempfile::tempdir().unwrap();
    let store = Store(root.path().to_owned());
    assert!(store.list().is_empty());
    let id = uuid::Uuid::now_v7().to_string();
    store
        .save(&Record {
            version: 1,
            id: id.clone(),
            kind: TuiAgent::Codex,
            cwd: PathBuf::from("/repo"),
            model: "gpt-5".into(),
            native_id: None,
            transcript: None,
            started: 1,
        })
        .unwrap();
    let sessions = root.path().join("sessions");
    std::fs::write(sessions.join("garbage.json"), "{").unwrap();
    std::fs::write(
        sessions.join(format!("{}.json", uuid::Uuid::now_v7())),
        serde_json::to_vec(&Record {
            version: 1,
            id: uuid::Uuid::now_v7().to_string(),
            kind: TuiAgent::Codex,
            cwd: PathBuf::from("/repo"),
            model: "gpt-5".into(),
            native_id: None,
            transcript: None,
            started: 2,
        })
        .unwrap(),
    )
    .unwrap();
    std::fs::write(sessions.join("notes.txt"), "").unwrap();
    let listed = store.list();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
}
