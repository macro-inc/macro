use std::time::Duration;

use super::*;

#[tokio::test]
async fn an_append_to_a_watched_file_arrives_without_any_timer() {
    let dir = tempfile::tempdir().expect("tempdir");
    let nested = dir.path().join("a").join("b");
    std::fs::create_dir_all(&nested).expect("mkdir");
    let path = nested.join("t.jsonl");
    std::fs::write(&path, "one\n").expect("write");

    let mut watch = Watch::new().expect("watcher");
    watch.add(dir.path(), true).expect("watch");
    std::fs::write(&path, "one\ntwo\n").expect("append");

    let changes = tokio::time::timeout(Duration::from_secs(1), watch.next())
        .await
        .expect("a change within a second")
        .expect("watcher alive");
    assert!(changes.paths.contains(&path), "{changes:?}");
}
