#[cfg(target_os = "ios")]
use super::PendingShareFilesState;
use std::path::Path;
use std::time::{Duration, SystemTime};
use url::Url;

pub(super) const STAGED_SHARED_FILE_NOT_FOUND_ERROR: &str = "staged shared file not found";

pub(super) fn is_staged_shared_file_not_found_error(error: &str) -> bool {
    error == STAGED_SHARED_FILE_NOT_FOUND_ERROR
}

pub(super) fn sanitize_shared_filename(name: &str) -> Option<&str> {
    let path = std::path::Path::new(name);
    match path.file_name().and_then(|file_name| file_name.to_str()) {
        Some(file_name) if file_name == name && file_name.starts_with("share_") => Some(file_name),
        _ => None,
    }
}

/// How long a file the Share Extension saved stays claimable. A share that
/// never reached the app (iOS refused to open it) shows the next time Macro is
/// opened within this window; anything older is deleted unseen.
pub(super) const UNCLAIMED_SHARE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Shared files in the App Group container that no open app has taken yet,
/// oldest first. The Share Extension stamps each file's modification time when
/// it saves it; files older than `max_age` are removed instead of returned.
pub(super) fn collect_unclaimed_shared_files(
    container: &Path,
    now: SystemTime,
    max_age: Duration,
) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(container) else {
        return Vec::new();
    };
    let mut files: Vec<(SystemTime, String)> = Vec::new();
    for entry in entries.flatten() {
        let Some(name) = entry
            .file_name()
            .to_str()
            .and_then(sanitize_shared_filename)
            .map(str::to_owned)
        else {
            continue;
        };
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let saved_at = metadata.modified().unwrap_or(now);
        let expired = now.duration_since(saved_at).is_ok_and(|age| age > max_age);
        if expired {
            if let Err(error) = std::fs::remove_file(entry.path())
                && error.kind() != std::io::ErrorKind::NotFound
            {
                tracing::warn!(error = %error, "failed to delete expired shared file");
            }
            continue;
        }
        files.push((saved_at, name));
    }
    files.sort();
    files.into_iter().map(|(_, name)| name).collect()
}

/// The link's files first, in the link's order, then any other unclaimed files.
pub(super) fn merge_pending_share_filenames(
    linked: Vec<String>,
    unclaimed: Vec<String>,
) -> Vec<String> {
    let mut merged = linked;
    for name in unclaimed {
        if !merged.contains(&name) {
            merged.push(name);
        }
    }
    merged
}

pub(super) fn share_filenames_from_url(url: &Url) -> Vec<String> {
    url.query_pairs()
        .filter(|(key, _)| key == "files")
        .flat_map(|(_, value)| {
            value
                .split(',')
                .filter_map(|name| sanitize_shared_filename(name).map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_filenames_from_url_preserves_order() {
        let url = Url::parse("macro://share?files=share_one.jpg,share_two.mp4").unwrap();

        assert_eq!(
            share_filenames_from_url(&url),
            vec!["share_one.jpg".to_string(), "share_two.mp4".to_string()]
        );
    }

    #[test]
    fn share_filenames_from_url_rejects_invalid_names() {
        let url = Url::parse(
            "macro://share?files=share_ok.png,../bad.mov,not_shared.jpg,share_nested%2Fbad.mp4",
        )
        .unwrap();

        assert_eq!(
            share_filenames_from_url(&url),
            vec!["share_ok.png".to_string()]
        );
    }

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("share-target-test-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn write(&self, name: &str, modified: SystemTime) {
            let file = std::fs::File::create(self.0.join(name)).unwrap();
            file.set_modified(modified).unwrap();
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn collect_unclaimed_shared_files_returns_recent_shares_oldest_first() {
        let dir = TempDir::new();
        let now = SystemTime::now();
        dir.write("share_newer.png", now - Duration::from_secs(10));
        dir.write("share_older.jpg", now - Duration::from_secs(60));
        dir.write("not_shared.png", now);
        std::fs::create_dir(dir.0.join("share_directory")).unwrap();

        assert_eq!(
            collect_unclaimed_shared_files(&dir.0, now, UNCLAIMED_SHARE_MAX_AGE),
            vec!["share_older.jpg".to_string(), "share_newer.png".to_string()]
        );
    }

    #[test]
    fn collect_unclaimed_shared_files_deletes_expired_shares() {
        let dir = TempDir::new();
        let now = SystemTime::now();
        dir.write(
            "share_stale.png",
            now - UNCLAIMED_SHARE_MAX_AGE - Duration::from_secs(1),
        );
        dir.write("share_fresh.png", now);

        assert_eq!(
            collect_unclaimed_shared_files(&dir.0, now, UNCLAIMED_SHARE_MAX_AGE),
            vec!["share_fresh.png".to_string()]
        );
        assert!(!dir.0.join("share_stale.png").exists());
    }

    #[test]
    fn collect_unclaimed_shared_files_tolerates_missing_container() {
        let missing = std::env::temp_dir().join("share-target-test-missing-container");
        assert!(
            collect_unclaimed_shared_files(&missing, SystemTime::now(), UNCLAIMED_SHARE_MAX_AGE)
                .is_empty()
        );
    }

    #[test]
    fn merge_pending_share_filenames_keeps_link_order_then_adds_unclaimed() {
        assert_eq!(
            merge_pending_share_filenames(
                vec!["share_b.png".to_string(), "share_a.png".to_string()],
                vec![
                    "share_old.jpg".to_string(),
                    "share_a.png".to_string(),
                    "share_b.png".to_string(),
                ],
            ),
            vec![
                "share_b.png".to_string(),
                "share_a.png".to_string(),
                "share_old.jpg".to_string(),
            ]
        );
    }

    #[test]
    fn staged_shared_file_not_found_error_matches_helper() {
        assert!(is_staged_shared_file_not_found_error(
            STAGED_SHARED_FILE_NOT_FOUND_ERROR
        ));
        assert!(!is_staged_shared_file_not_found_error(
            "failed to read shared file staging directory"
        ));
    }
}
