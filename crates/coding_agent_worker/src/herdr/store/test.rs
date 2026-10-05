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
