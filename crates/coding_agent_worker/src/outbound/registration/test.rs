use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;

struct TestFile(PathBuf);

impl TestFile {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time after epoch")
            .as_nanos();
        Self(std::env::temp_dir().join(format!(
            "coding-agent-worker-feed-state-{}-{nonce}.json",
            std::process::id()
        )))
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn store(&self) -> FileFeedStateStore {
        FileFeedStateStore {
            path: self.0.clone(),
        }
    }
}

impl Drop for TestFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[test]
fn missing_feed_state_is_absent() {
    let file = TestFile::new();

    assert_eq!(file.store().load().expect("load state"), None);
}

#[test]
fn malformed_feed_state_is_absent() {
    let file = TestFile::new();
    std::fs::write(file.path(), "not json").expect("write malformed state");

    assert_eq!(file.store().load().expect("load state"), None);
}

#[test]
fn feed_state_round_trips() {
    let file = TestFile::new();
    let state = FeedState {
        webhook_id: "webhook-id".to_owned(),
        signing_secret: "signing-secret".to_owned(),
    };

    let store = file.store();
    store.save(&state).expect("save state");

    assert_eq!(store.load().expect("load state"), Some(state));
}

#[cfg(unix)]
#[test]
fn saved_feed_state_is_private() {
    use std::os::unix::fs::PermissionsExt as _;

    let file = TestFile::new();
    let state = FeedState {
        webhook_id: "webhook-id".to_owned(),
        signing_secret: "signing-secret".to_owned(),
    };

    file.store().save(&state).expect("save state");

    let mode = std::fs::metadata(file.path())
        .expect("state metadata")
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
}
