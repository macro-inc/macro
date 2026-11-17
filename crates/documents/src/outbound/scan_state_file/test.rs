use super::*;
use crate::domain::released_attachments::orphans::ScanCounts;

/// A path of its own under the system temp directory, removed on drop.
struct TempPath(PathBuf);

impl TempPath {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!("orphan-scan-{}.json", uuid::Uuid::now_v7())))
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[tokio::test]
async fn saved_progress_loads_back_and_replaces_the_previous_save() {
    let path = TempPath::new();
    let file = ScanStateFile::new(path.0.clone());
    assert!(file.load().expect("load").is_none());

    let first = ScanProgress::start(true, None);
    let second = ScanProgress {
        apply: true,
        after: Some("0d000000-0000-0000-0000-000000000007".to_string()),
        pages: 12,
        finished: false,
        counts: ScanCounts {
            orphans: 40,
            mailbox_gone: 30,
            thread_gone: 10,
            enqueued: 39,
            already_queued: 1,
            ..ScanCounts::default()
        },
    };
    file.save(&first).await.expect("save first");
    file.save(&second).await.expect("save second");

    assert_eq!(file.load().expect("load"), Some(second));
    let mut written = OsString::from(path.0.as_os_str());
    written.push(".tmp");
    assert!(!PathBuf::from(written).exists());
}

#[test]
fn a_file_that_is_not_scan_progress_is_refused() {
    let path = TempPath::new();
    std::fs::write(&path.0, b"{\"cursor\": 3}").expect("write");

    let loaded = ScanStateFile::new(path.0.clone()).load();

    assert!(matches!(loaded, Err(ScanStateFileError::Invalid { .. })));
}
