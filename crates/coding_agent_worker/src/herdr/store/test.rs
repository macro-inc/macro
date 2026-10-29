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
        window: None,
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
fn legacy_tabs_load_without_claiming_their_shared_workspace() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let store = Store(root.path().to_owned());
    std::fs::create_dir(root.path().join("sessions")).unwrap();
    std::fs::write(
        store.path(&id).unwrap(),
        serde_json::json!({
            "version":1,"id":id,"kind":"Codex","cwd":"/repo","model":"default",
            "native_id":null,"transcript":null,"started":1,
            "window":{"tab_id":"w1:t2","pane_id":"w1:p2"}
        })
        .to_string(),
    )
    .unwrap();
    let window = store.load(&id).unwrap().window.unwrap();
    assert_eq!(window.tab_id, "w1:t2");
    assert_eq!(window.workspace_id, None);
}
